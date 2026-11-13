import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerInfo, InferenceOutput } from '../../core';
import type { InferenceModel } from './models/types';

// The model and the image loading are replaced: these tests look at how a run reports its progress.
const run = vi.hoisted(() => ({ fail: new Set<string>(), gate: null as Promise<void> | null }));
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
vi.mock('./sourceImage', () => ({
  SourceImageError: class extends Error {},
  baseImageLayerOf: () => ({}),
  loadSourceImage: async (_layer: unknown, c: { id: string }) => ({
    bitmap: { id: c.id, close: () => {} },
    map: { x: 0, y: 0, scale: 1 },
  }),
}));

const { batchStateAtom, readingPageAtom, startBatch, stopBatch } = await import('./batch');
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
});
