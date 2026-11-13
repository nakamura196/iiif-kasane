'use client';

// ページ一覧から、1 つのモデルを全ページに順にかける。結果は 1 ページずつ、推論タブで 1 枚ずつ実行したときと
// 同じ形（inferenceResultsAtom と、画像に重ねる localAnnotationPagesAtom）に入れる。
// 実行は Viewer の store に結び付け、画面の部品（パネル）を閉じても止まらない。止めるのは stopBatch だけ。
// Worker は 1 つなので推論は 1 枚ずつ。画像は先の PREFETCH 枚だけ並行して取り、画像サーバに負荷をかけすぎない。
// 既に結果のあるページは飛ばす（止めたあと続きから再開できる。やり直すときは推論タブで結果を捨てる）。
import { atom, type useStore } from 'jotai';
import { imageLayerCount, toAnnotationPage, type ContainerInfo, type ManifestV4 } from '../../core';
import { localAnnotationPagesAtom } from '../overlays/canvasAnnotationState';
import { runModel } from './client';
import type { InferenceModel } from './models/types';
import { SourceImageError, baseImageLayerOf, loadSourceImage } from './sourceImage';
import { inferenceResultsAtom, resultKey, type InferenceResult } from './state';

type Store = ReturnType<typeof useStore>;

export interface BatchState {
  modelId: string;
  /** Pages to read in this run (pages that already had a result are left out). */
  total: number;
  /** Pages finished (read or failed). */
  done: number;
  failed: number;
  /** The page being read. */
  current: string | null;
  running: boolean;
  /** Whether the run was stopped before the end. */
  stopped: boolean;
}

export const batchStateAtom = atom<BatchState | null>(null);

/** Images fetched ahead of the page being read. */
const PREFETCH = 2;

const controllers = new WeakMap<Store, AbortController>();

/** Pages the model can read: Canvases with an image. */
export const batchTargetsOf = (containers: ContainerInfo[]): ContainerInfo[] =>
  containers.filter((c) => c.kind === 'Canvas' && imageLayerCount(c.painting) > 0);

export const stopBatch = (store: Store) => controllers.get(store)?.abort();

export const startBatch = async (
  store: Store,
  o: { model: InferenceModel; manifest: ManifestV4 | null | undefined; pages: ContainerInfo[]; generatorName: string },
): Promise<void> => {
  const { model } = o;
  controllers.get(store)?.abort();
  const ac = new AbortController();
  controllers.set(store, ac);
  const existing = store.get(inferenceResultsAtom);
  const todo = batchTargetsOf(o.pages).filter((c) => !existing[resultKey(c.id, model.id)]);
  store.set(batchStateAtom, { modelId: model.id, total: todo.length, done: 0, failed: 0, current: null, running: true, stopped: false });

  const load = (c: ContainerInfo) => {
    const layer = baseImageLayerOf(o.manifest, c);
    return layer ? loadSourceImage(layer, c, model.imageLongSide) : Promise.reject(new SourceImageError('unsupported'));
  };
  const loads = new Map<number, ReturnType<typeof load>>();
  const ensure = (i: number) => {
    if (i >= todo.length || loads.has(i)) return;
    const p = load(todo[i]);
    p.catch(() => {}); // the failure is seen when the page's turn comes
    loads.set(i, p);
  };
  const source = `inference:${model.id}`;
  // 止めたあと・別の実行に替わったあとに届いた結果や進み具合は、書き込まない
  const mine = () => controllers.get(store) === ac && !ac.signal.aborted;

  for (let i = 0; i < todo.length && !ac.signal.aborted; i++) {
    for (let k = i; k <= i + PREFETCH; k++) ensure(k);
    const c = todo[i];
    if (mine()) store.set(batchStateAtom, (s) => s && { ...s, current: c.id });
    let failed = false;
    try {
      const src = await loads.get(i)!;
      loads.delete(i);
      if (ac.signal.aborted) {
        src.bitmap.close();
        break;
      }
      const r = await runModel(model.id, src.bitmap, () => {});
      if (!mine()) break;
      const page = toAnnotationPage(r.output, {
        canvasId: c.id,
        map: src.map,
        newId: () => `urn:uuid:${crypto.randomUUID()}`,
        generator: { id: model.homepage, name: o.generatorName },
      });
      const res: InferenceResult = {
        canvasId: c.id,
        modelId: model.id,
        output: r.output,
        page,
        backends: r.backends,
        ms: r.ms,
        created: new Date().toISOString(),
      };
      // 推論タブで捨てた・別の実行で入ったものは上書きしない（入っていれば先のものを残す）
      if (store.get(inferenceResultsAtom)[resultKey(c.id, model.id)]) continue;
      store.set(inferenceResultsAtom, (rs) => ({ ...rs, [resultKey(c.id, model.id)]: res }));
      store.set(localAnnotationPagesAtom, (ls) => [
        ...ls.filter((l) => !(l.source === source && l.canvasId === c.id)),
        { source, canvasId: c.id, page },
      ]);
    } catch {
      loads.delete(i);
      failed = true;
    } finally {
      if (mine()) store.set(batchStateAtom, (s) => s && { ...s, done: s.done + 1, failed: s.failed + (failed ? 1 : 0) });
    }
  }

  for (const p of loads.values()) p.then((s) => s.bitmap.close(), () => {});
  // 別の実行に替わっていたら、その実行の状態に触らない
  if (controllers.get(store) !== ac) return;
  controllers.delete(store);
  store.set(batchStateAtom, (s) => s && { ...s, running: false, current: null, stopped: ac.signal.aborted });
};
