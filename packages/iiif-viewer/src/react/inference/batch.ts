'use client';

// From the pages tab, run one model over every page in turn. Each page's result is stored the same way as when the
// inference tab reads one page (inferenceResultsAtom, and localAnnotationPagesAtom for the marks over the image).
// A run belongs to the Viewer's store and goes on when the panel is closed; only stopBatch stops it.
// There is one Worker, so pages are read one at a time. Only the next PREFETCH images are fetched ahead, so the
// image server is not loaded too much. When the image server refuses (too many requests, or a refusal the browser
// only sees as a network error), the run waits and asks again; when pages keep failing that way, it stops rather
// than send the server more requests. Pages that already have a result are skipped (a stopped run can go on from
// where it stopped; to read a page again, discard its result in the inference tab).
import { atom, type useStore } from 'jotai';
import { imageLayerCount, toAnnotationPage, type ContainerInfo, type ManifestV4 } from '../../core';
import { localAnnotationPagesAtom } from '../overlays/canvasAnnotationState';
import { runModel } from './client';
import type { InferenceModel } from './models/types';
import { SourceImageError, baseImageLayerOf, isBusyStatus, loadSourceImage } from './sourceImage';
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
   * The page whose result has just arrived (the pages tab flashes it once). Cleared again after JUST_READ_MS, so a
   * thumbnail shown later does not flash.
   */
  lastRead?: string | null;
  running: boolean;
  /** Whether the run was stopped before the end. */
  stopped: boolean;
  /** Waiting before asking the image server again, after it refused. */
  waiting?: boolean;
  /** Stopped by itself because the image server kept refusing (stopped is true too). */
  blocked?: boolean;
}

export const batchStateAtom = atom<BatchState | null>(null);

/** The page being read during a run over every page (null when no run is going on). */
export const readingPageAtom = atom((get) => {
  const b = get(batchStateAtom);
  return b?.running ? b.current : null;
});

/** How long a page counts as just read (a little longer than the flash in the pages tab). */
const JUST_READ_MS = 1000;

/** Images fetched ahead of the page being read. */
const PREFETCH = 2;

/** Times one page's image is asked for again after a refusal. */
export const RETRIES = 3;

/** Pages in a row whose image could not be fetched (after their retries) before the run stops by itself. */
export const MAX_FAILED_IN_ROW = 3;

/** The longest wait between two tries, even when the server asks for more (the run can be resumed later). */
const MAX_WAIT_MS = 60_000;

/**
 * Whether a failure is worth asking again: the image server was busy (408, 429, 5xx), or the request failed. A refusal
 * without CORS headers reaches the page as such a network error, so it counts too. An answer that will not change
 * (403 for a restricted image, 404, an image that cannot be decoded) does not.
 */
export const isRetryable = (e: unknown): boolean => {
  if (!(e instanceof SourceImageError) || e.reason !== 'fetch') return false;
  const { status, network } = e.detail;
  if (status === undefined) return !!network;
  return status === 408 || isBusyStatus(status) || status >= 500;
};

/**
 * How long to wait before try `attempt` + 1 (0-based): 2 s, 4 s, 8 s ..., or longer when the server asked for more
 * (Retry-After never shortens the wait, so `0` or a date already past does not send the tries back to back).
 */
export const retryDelayMs = (attempt: number, e: unknown): number => {
  const asked = e instanceof SourceImageError ? (e.detail.retryAfterMs ?? 0) : 0;
  return Math.min(MAX_WAIT_MS, Math.max(asked, 2000 * 2 ** attempt));
};

/** Resolves after `ms`, or as soon as `signal` is aborted. */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(done, ms);
    function done() {
      clearTimeout(id);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });

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
    return layer ? loadSourceImage(layer, c, model.imageLongSide, { busyFails: true }) : Promise.reject(new SourceImageError('unsupported'));
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
  let failedInRow = 0;
  let blocked = false;

  /** The page's image, asked for again (after a wait) while the server refuses, up to RETRIES times. */
  const fetchPage = async (i: number) => {
    let pending = loads.get(i)!;
    for (let attempt = 0; ; attempt++) {
      try {
        return await pending;
      } catch (e) {
        if (attempt >= RETRIES || !isRetryable(e) || ac.signal.aborted) throw e;
        if (mine()) store.set(batchStateAtom, (s) => s && { ...s, waiting: true });
        await sleep(retryDelayMs(attempt, e), ac.signal);
        if (mine()) store.set(batchStateAtom, (s) => s && { ...s, waiting: false });
        if (ac.signal.aborted) throw e;
        pending = load(todo[i]);
        loads.set(i, pending);
      }
    }
  };

  for (let i = 0; i < todo.length && !ac.signal.aborted && !blocked; i++) {
    for (let k = i; k <= i + PREFETCH; k++) ensure(k);
    const c = todo[i];
    if (mine()) store.set(batchStateAtom, (s) => s && { ...s, current: c.id });
    let failed = false;
    let read = false;
    try {
      const src = await fetchPage(i);
      loads.delete(i);
      failedInRow = 0;
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
    } catch (e) {
      loads.delete(i);
      failed = true;
      // The image server keeps refusing: stop instead of asking it for every remaining page
      // A stop pressed during a wait is the user's, not the server's. Any other failure breaks the row.
      if (!ac.signal.aborted) {
        if (!isRetryable(e)) failedInRow = 0;
        else if (++failedInRow >= MAX_FAILED_IN_ROW) blocked = true;
      }
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
  store.set(batchStateAtom, (s) => s && { ...s, running: false, current: null, waiting: false, stopped: ac.signal.aborted || blocked, blocked });
};
