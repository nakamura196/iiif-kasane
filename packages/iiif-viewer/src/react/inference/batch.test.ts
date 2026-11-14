import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerInfo, InferenceOutput } from '../../core';
import type { InferenceModel } from './models/types';

// The model and the image loading are replaced: these tests look at how a run reports its progress.
const run = vi.hoisted(() => ({
  fail: new Set<string>(),
  gate: null as Promise<void> | null,
  /**
   * Per page, the image server's answers in order (a status; 'network' for a refusal seen without CORS; 'decode' for
   * an image that cannot be read); then 200.
   */
  refusals: new Map<string, (number | 'network' | 'decode')[]>(),
  /** Every image request, by page. */
  requests: [] as string[],
}));
vi.mock('./client', () => ({
  runModel: async (_model: string, bitmap: { id: string }) => {
    if (run.gate) await run.gate;
    if (run.fail.has(bitmap.id)) throw new Error('model failed');
    const output: InferenceOutput = {
      kind: 'lines',
      items: [{ x: 1, y: 1, w: 10, h: 10, score: 1, text: 'a' }],
      imageWidth: 100,
      imageHeight: 100,
    };
    return { output, backends: [], ms: 1 };
  },
}));
vi.mock('./sourceImage', async (importActual) => {
  const actual = await importActual<typeof import('./sourceImage')>();
  return {
    ...actual,
    baseImageLayerOf: () => ({}),
    loadSourceImage: async (_layer: unknown, c: { id: string }) => {
      run.requests.push(c.id);
      const answer = run.refusals.get(c.id)?.shift();
      if (answer !== undefined) {
        throw new actual.SourceImageError(
          'fetch',
          answer === 'network' ? { network: true } : answer === 'decode' ? {} : { status: answer },
        );
      }
      return { bitmap: { id: c.id, close: () => {} }, map: { x: 0, y: 0, scale: 1 } };
    },
  };
});

const { MAX_FAILED_IN_ROW, RETRIES, batchStateAtom, readingPageAtom, retryDelayMs, startBatch, stopBatch } = await import('./batch');
const { SourceImageError, retryAfterMsOf } = await import('./sourceImage');
const { inferenceResultsAtom, resultKey } = await import('./state');

const page = (id: string): ContainerInfo =>
  ({
    id,
    kind: 'Canvas',
    label: {},
    width: 100,
    height: 100,
    painting: [{ id: `${id}/p`, options: [{ url: `${id}.jpg`, kind: 'Image' }] }],
    supplementing: [],
  }) as unknown as ContainerInfo;
const model = { id: 'm1', homepage: 'https://example.org/m1', imageLongSide: 100 } as unknown as InferenceModel;
const start = (store: ReturnType<typeof createStore>, pages: ContainerInfo[]) =>
  startBatch(store, { model, manifest: null, pages, generatorName: 'test' });

describe('a run over every page', () => {
  beforeEach(() => {
    run.fail.clear();
    run.gate = null;
    run.refusals.clear();
    run.requests = [];
  });
  afterEach(() => vi.useRealTimers());

  it('reports the page being read while running, and none afterwards', async () => {
    const store = createStore();
    let release!: () => void;
    run.gate = new Promise((r) => (release = r));
    const done = start(store, [page('a'), page('b')]);
    await vi.waitFor(() => expect(store.get(readingPageAtom)).toBe('a'));
    release();
    await done;
    expect(store.get(readingPageAtom)).toBeNull();
    expect(store.get(batchStateAtom)).toMatchObject({ running: false, done: 2, failed: 0, stopped: false });
  });

  it('marks a page as just read when its result arrives, and clears that a moment later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const store = createStore();
    await start(store, [page('a')]);
    expect(store.get(batchStateAtom)?.lastRead).toBe('a');
    vi.advanceTimersByTime(1000);
    // A thumbnail shown later (the grid opened again) must not flash
    expect(store.get(batchStateAtom)?.lastRead).toBeNull();
  });

  it('does not mark a page that failed as just read', async () => {
    const store = createStore();
    run.fail.add('b');
    await start(store, [page('a'), page('b')]);
    expect(store.get(batchStateAtom)).toMatchObject({ done: 2, failed: 1, lastRead: 'a' });
    expect(Object.keys(store.get(inferenceResultsAtom))).toEqual([resultKey('a', 'm1')]);
  });

  it('skips pages that already have a result', async () => {
    const store = createStore();
    await start(store, [page('a')]);
    await start(store, [page('a'), page('b')]);
    expect(store.get(batchStateAtom)).toMatchObject({ total: 1, done: 1, lastRead: 'b' });
  });

  it('stops when asked, and then no page counts as being read', async () => {
    const store = createStore();
    let release!: () => void;
    run.gate = new Promise((r) => (release = r));
    const done = start(store, [page('a'), page('b')]);
    await vi.waitFor(() => expect(store.get(readingPageAtom)).toBe('a'));
    stopBatch(store);
    release();
    await done;
    expect(store.get(readingPageAtom)).toBeNull();
    expect(store.get(batchStateAtom)).toMatchObject({ running: false, stopped: true });
    expect(store.get(inferenceResultsAtom)).toEqual({});
  });

  it('waits and asks again when the image server is busy, then reads the page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    run.refusals.set('a', [429, 'network']);
    const done = start(store, [page('a')]);
    await vi.waitFor(() => expect(store.get(batchStateAtom)?.waiting).toBe(true));
    // Nothing is asked again before the wait is over
    expect(run.requests).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await done;
    expect(run.requests).toEqual(['a', 'a', 'a']);
    expect(store.get(batchStateAtom)).toMatchObject({ done: 1, failed: 0, waiting: false, stopped: false, blocked: false });
    expect(Object.keys(store.get(inferenceResultsAtom))).toEqual([resultKey('a', 'm1')]);
  });

  it('stops by itself when the image server keeps refusing, instead of asking for every page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    const pages = Array.from({ length: 50 }, (_, i) => page(`p${i}`));
    // As the national library answered: refusals without CORS headers, seen as network errors
    for (const p of pages) run.refusals.set(p.id, Array(RETRIES + 1).fill('network'));
    const done = start(store, pages);
    await vi.runAllTimersAsync();
    await done;
    expect(store.get(batchStateAtom)).toMatchObject({
      running: false,
      done: MAX_FAILED_IN_ROW,
      failed: MAX_FAILED_IN_ROW,
      stopped: true,
      blocked: true,
    });
    // Before, every one of the 50 pages was asked for within moments. Now: the pages tried, each with its retries, and the two fetched ahead
    const asked = new Set(run.requests);
    expect(asked.size).toBeLessThanOrEqual(MAX_FAILED_IN_ROW + 2);
    expect(run.requests.length).toBeLessThanOrEqual(MAX_FAILED_IN_ROW * (RETRIES + 1) + 2);
  });

  it('counts only failures in a row: a page read in between starts the count again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    const refuse = () => Array(RETRIES + 1).fill(503);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ['a', 'b', 'd', 'e']) run.refusals.set(id, refuse());
    const done = start(store, ids.map(page));
    await vi.runAllTimersAsync();
    await done;
    expect(store.get(batchStateAtom)).toMatchObject({ done: 5, failed: 4, stopped: false, blocked: false });
  });

  it('does not ask again for an image that is not there, and goes on', async () => {
    const store = createStore();
    run.refusals.set('a', [404]);
    await start(store, [page('a'), page('b')]);
    expect(run.requests.filter((id) => id === 'a')).toHaveLength(1);
    expect(store.get(batchStateAtom)).toMatchObject({ done: 2, failed: 1, stopped: false, blocked: false });
  });

  it('stops at once when asked while waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    run.refusals.set('a', [429]);
    const done = start(store, [page('a'), page('b')]);
    await vi.waitFor(() => expect(store.get(batchStateAtom)?.waiting).toBe(true));
    stopBatch(store);
    await done;
    expect(store.get(batchStateAtom)).toMatchObject({ running: false, waiting: false, stopped: true, blocked: false });
    expect(run.requests.filter((id) => id === 'a')).toHaveLength(1);
  });

  it('does not ask again for answers that will not change: a restricted image, or one that cannot be decoded', async () => {
    const store = createStore();
    run.refusals.set('a', [403]);
    run.refusals.set('b', ['decode']);
    run.refusals.set('c', [403]);
    await start(store, ['a', 'b', 'c', 'd'].map(page));
    expect(run.requests).toEqual(['a', 'b', 'c', 'd']);
    expect(store.get(batchStateAtom)).toMatchObject({ done: 4, failed: 3, stopped: false, blocked: false });
  });

  it('a page that fails for good breaks the row of refusals', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    const refuse = () => Array(RETRIES + 1).fill(503);
    run.refusals.set('a', refuse());
    run.refusals.set('b', [404]);
    run.refusals.set('c', refuse());
    run.refusals.set('d', refuse());
    const done = start(store, ['a', 'b', 'c', 'd', 'e'].map(page));
    await vi.runAllTimersAsync();
    await done;
    expect(store.get(batchStateAtom)).toMatchObject({ done: 5, failed: 4, blocked: false });
  });

  it('a stop pressed while waiting is the user\'s, even after refusals in a row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = createStore();
    const refuse = () => Array(RETRIES + 1).fill(429);
    for (const id of ['a', 'b', 'c']) run.refusals.set(id, refuse());
    const done = start(store, ['a', 'b', 'c', 'd'].map(page));
    // a and b fail with all their retries (2 + 4 + 8 s each); then stop while c waits for its first retry
    await vi.advanceTimersByTimeAsync(29_000);
    expect(store.get(batchStateAtom)).toMatchObject({ failed: 2, current: 'c', waiting: true });
    stopBatch(store);
    await done;
    expect(store.get(batchStateAtom)).toMatchObject({ stopped: true, blocked: false });
  });
});

describe('waiting before asking again', () => {
  it('doubles the wait from 2 seconds, and takes what the server asks for, up to a minute', () => {
    const busy = new SourceImageError('fetch', { status: 429 });
    expect([0, 1, 2].map((a) => retryDelayMs(a, busy))).toEqual([2000, 4000, 8000]);
    expect(retryDelayMs(0, new SourceImageError('fetch', { status: 503, retryAfterMs: 10_000 }))).toBe(10_000);
    expect(retryDelayMs(0, new SourceImageError('fetch', { status: 503, retryAfterMs: 3_600_000 }))).toBe(60_000);
    // Retry-After: 0 (or a date already past) does not send the tries back to back
    expect(retryDelayMs(1, new SourceImageError('fetch', { status: 429, retryAfterMs: 0 }))).toBe(4000);
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterMsOf('120')).toBe(120_000);
    const now = Date.parse('2026-11-14T00:00:00Z');
    expect(retryAfterMsOf('Sat, 14 Nov 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(retryAfterMsOf(null)).toBeUndefined();
    expect(retryAfterMsOf('soon')).toBeUndefined();
  });
});
