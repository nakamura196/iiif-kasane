'use client';

// From the pages grid, run one model over every page in turn. Each page's result is stored the same way as when the
// inference tab reads one page (inferenceResultsAtom, and localAnnotationPagesAtom for the marks over the image).
// A run belongs to the Viewer's store and goes on when the panel is closed; only stopBatch stops it.
// There is one Worker, so pages are read one at a time. Only the next PREFETCH images are fetched ahead, so the
// image server is not loaded too much. Pages that already have a result are skipped (a stopped run can go on from
// where it stopped; to read a page again, discard its result in the inference tab).
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
  /**
   * The page whose result has just arrived (the pages grid flashes it once). Cleared again after JUST_READ_MS, so a
   * thumbnail shown later does not flash.
   */
  lastRead?: string | null;
  running: boolean;
  /** Whether the run was stopped before the end. */
  stopped: boolean;
}

export const batchStateAtom = atom<BatchState | null>(null);

/** The page being read during a run over every page (null when no run is going on). */
export const readingPageAtom = atom((get) => {
  const b = get(batchStateAtom);
  return b?.running ? b.current : null;
});

/** How long a page counts as just read (a little longer than the flash in the pages grid). */
const JUST_READ_MS = 1000;

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
  // Results and progress that arrive after a stop, or after another run took over, are not written
  const mine = () => controllers.get(store) === ac && !ac.signal.aborted;

  for (let i = 0; i < todo.length && !ac.signal.aborted; i++) {
    for (let k = i; k <= i + PREFETCH; k++) ensure(k);
    const c = todo[i];
    if (mine()) store.set(batchStateAtom, (s) => s && { ...s, current: c.id });
    let failed = false;
    let read = false;
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
      // A result put there meanwhile (by the inference tab or another run) is kept, not overwritten
      if (store.get(inferenceResultsAtom)[resultKey(c.id, model.id)]) continue;
      store.set(inferenceResultsAtom, (rs) => ({ ...rs, [resultKey(c.id, model.id)]: res }));
      store.set(localAnnotationPagesAtom, (ls) => [
        ...ls.filter((l) => !(l.source === source && l.canvasId === c.id)),
        { source, canvasId: c.id, page },
      ]);
      read = true;
    } catch {
      loads.delete(i);
      failed = true;
    } finally {
      if (mine()) {
        store.set(batchStateAtom, (s) =>
          s && { ...s, done: s.done + 1, failed: s.failed + (failed ? 1 : 0), ...(read ? { lastRead: c.id } : {}) },
        );
        if (read) {
          setTimeout(() => store.set(batchStateAtom, (s) => (s?.lastRead === c.id ? { ...s, lastRead: null } : s)), JUST_READ_MS);
        }
      }
    }
  }

  for (const p of loads.values()) p.then((s) => s.bitmap.close(), () => {});
  // If another run took over, its state is left alone
  if (controllers.get(store) !== ac) return;
  controllers.delete(store);
  store.set(batchStateAtom, (s) => s && { ...s, running: false, current: null, stopped: ac.signal.aborted });
};
