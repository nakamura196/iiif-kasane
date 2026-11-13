/// <reference lib="webworker" />
// 推論の Worker。モデルの部品（models/）を読み込み、保存済みのファイルからセッションを作って実行する。
// セッションは作り直さずに持っておく（同じモデルで別の画像を読むとき速い）。
import { modelById } from './models/registry';
import type { ModelFile } from './models/types';
import { readModelFile } from './modelStore';
import { hasWebGpu, loadOrt, type Backend, type OrtModule, type OrtSession } from './ort';
import type { FromWorker, ToWorker } from './protocol';
import { serial } from './serial';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

const sessions = new Map<string, Promise<{ session: OrtSession; backend: Backend }>>();
let gpu: Promise<boolean> | null = null;

/** Stands in for onnxruntime-web for the models that do not use it (engine `transformers`). */
const noOrt = new Proxy({} as OrtModule, {
  // then は Promise.all が「待つ物か」を確かめに見るので、無いと答える
  get: (_, key) => {
    if (key === 'then') return undefined;
    throw new Error('onnxruntime-web is not loaded for this model');
  },
});

const sessionOf = (file: ModelFile, prefer: Backend) => {
  const key = `${file.url}|${prefer}`;
  let s = sessions.get(key);
  if (!s) {
    s = (async () => {
      const ort = await loadOrt();
      const bytes = await readModelFile(file);
      const externalData = file.data ? [{ path: file.data.path, data: await readModelFile(file.data) }] : undefined;
      if (prefer === 'webgpu' && (await (gpu ??= hasWebGpu()))) {
        try {
          const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all', externalData });
          return { session, backend: 'webgpu' as const };
        } catch {
          // WebGPU で落ちる演算のある端末では、wasm で作り直す
        }
      }
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', externalData });
      return { session, backend: 'wasm' as const };
    })();
    s.catch(() => sessions.delete(key));
    sessions.set(key, s);
  }
  return s;
};

const run = async ({ job, modelId, bitmap, prompt, imageKey }: ToWorker) => {
  try {
    const model = modelById(modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    post({ type: 'progress', job, stage: 'load', done: 0, total: 1 });
    // transformers.js のモデルは、自前の onnxruntime-web を持つので、こちらの分は読まない
    const [{ run: runner }, ort] = await Promise.all([model.load(), model.engine === 'transformers' ? noOrt : loadOrt()]);
    const backends = new Set<Backend>();
    const t0 = performance.now();
    const output = await runner({
      ort,
      bitmap,
      session: async (name, prefer) => {
        const file = model.files.find((f) => f.name === name);
        if (!file) throw new Error(`No file "${name}" in ${modelId}`);
        post({ type: 'progress', job, stage: 'load', done: 0, total: 1 });
        const s = await sessionOf(file, prefer);
        backends.add(s.backend);
        return s;
      },
      usedBackend: (b) => backends.add(b),
      progress: (stage, done, total) => post({ type: 'progress', job, stage, done, total }),
      prompt,
      imageKey,
    });
    post({ type: 'result', job, output, backends: [...backends], ms: performance.now() - t0 });
  } finally {
    bitmap.close();
  }
};

// 仕事は 1 つずつ順に行う。同じセッションを 2 つの仕事が同時に使うと、止まったり失敗したりする
// （ページ一覧の全ページ実行の途中に、推論タブで 1 枚を実行したときなど）
const queue = serial();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  queue(() => run(m)).catch((err: unknown) => post({ type: 'error', job: m.job, message: String((err as Error)?.message ?? err) }));
};
