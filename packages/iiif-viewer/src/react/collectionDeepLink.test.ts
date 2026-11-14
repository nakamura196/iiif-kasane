import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { manifestUrlAtom, shownManifestAtom } from './atoms';
import { pickedPageAtom } from './internalState';
import { loadContent, shownLocation, takeOverContent } from './useManifest';
import { goBack, openManifest, trailAtom } from './displays/structureState';

// A deep link into a Collection: ?iiif-content=<manifest>&collection=<top>&collection=<sub>

const collectionJson = (id: string, entries: string[]) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Collection',
  label: { en: [id] },
  items: entries.map((e) => ({ id: e, type: 'Manifest', label: { en: [e] } })),
});
const manifestJson = (id: string, pages = 3) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Manifest',
  label: { en: [id] },
  items: Array.from({ length: pages }, (_, i) => ({
    id: `${id}/canvas/${i + 1}`,
    type: 'Canvas',
    width: 100,
    height: 100,
    items: [],
  })),
});

let run = 0;
let top = '';
let sub = '';
let m1 = '';
let m2 = '';
let served: Record<string, unknown> = {};
let fetched: string[] = [];
beforeEach(() => {
  run += 1;
  const u = (n: string) => `https://example.org/deep${run}/${n}.json`;
  top = u('top');
  sub = u('sub');
  m1 = u('m1');
  m2 = u('m2');
  // top lists: [m2, sub]; sub lists: [m2, m1]  (so the position of the next step is not always 0)
  served = {
    [top]: collectionJson(top, [m2, sub]),
    [sub]: collectionJson(sub, [m2, m1]),
    [m1]: manifestJson(m1),
    [m2]: manifestJson(m2),
  };
  fetched = [];
  vi.stubGlobal('fetch', async (target: string) => {
    fetched.push(target);
    return { ok: target in served, json: async () => served[target] } as unknown as Response;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const trailUrls = (store: ReturnType<typeof createStore>) => store.get(trailAtom).items.map((i) => i.url);

describe('loading a manifest with the Collections it was reached through', () => {
  it('shows the manifest as the iiif-content and fills the trail, top first', async () => {
    const store = createStore();
    await expect(loadContent(store, m1, () => 'en', [top, sub])).resolves.toBe('shown');
    const shown = store.get(shownManifestAtom);
    expect(shown?.url).toBe(m1);
    expect(shown?.origin).toBe('content');
    expect(store.get(manifestUrlAtom)).toBe(m1);
    expect(store.get(trailAtom).owner).toBe(m1);
    expect(trailUrls(store)).toEqual([top, sub]);
  });

  it('gives each Collection the position of the next step in it', async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    // top lists sub second; sub lists m1 second
    expect(store.get(trailAtom).items.map((i) => i.index)).toEqual([1, 1]);
  });

  it('goes back through the Collections one step at a time, to the position that was opened', async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    expect(goBack(store, 'en')).toBe(true);
    expect(store.get(shownManifestAtom)?.url).toBe(sub);
    expect(store.get(shownManifestAtom)?.origin).toBe('back');
    expect(store.get(pickedPageAtom).index).toBe(1);
    expect(goBack(store, 'en')).toBe(true);
    expect(store.get(shownManifestAtom)?.url).toBe(top);
    expect(goBack(store, 'en')).toBe(false);
  });

  it('uses 0 when the next step is not in the Collection', async () => {
    const store = createStore();
    served[top] = collectionJson(top, [m2]);
    await loadContent(store, m1, () => 'en', [top]);
    expect(store.get(trailAtom).items.map((i) => i.index)).toEqual([0]);
  });

  it('leaves out a Collection that cannot be read and still shows the manifest', async () => {
    const store = createStore();
    delete served[sub];
    await expect(loadContent(store, m1, () => 'en', [top, sub])).resolves.toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(m1);
    expect(trailUrls(store)).toEqual([top]);
  });

  it('fails when the manifest itself cannot be read', async () => {
    const store = createStore();
    delete served[m1];
    await expect(loadContent(store, m1, () => 'en', [top])).resolves.toBe('failed');
    expect(store.get(shownManifestAtom)).toBeNull();
  });

  it('reads the manifest and the Collections together, each once', async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    expect([...fetched].sort()).toEqual([m1, sub, top].sort());
  });

  it('drops the load when a newer iiif-content was asked for meanwhile', async () => {
    const store = createStore();
    const slow = loadContent(store, m1, () => 'en', [top]);
    const newer = loadContent(store, m2, () => 'en');
    await expect(slow).resolves.toBe('stale');
    await expect(newer).resolves.toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(m2);
    expect(trailUrls(store)).toEqual([]);
  });

  it('keeps the content-state rules: the shown manifest counts as the iiif-content', async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top]);
    // ContainerList applies canvas= / pos= only for this origin
    expect(store.get(shownManifestAtom)?.origin).toBe('content');
  });
});

describe('taking over the location without reading again', () => {
  const openFromTop = async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    return store;
  };

  it('only makes the new iiif-content the owner, and keeps the trail, the page and the shown manifest', async () => {
    const store = await openFromTop();
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)!.seq, index: 2 });
    const before = store.get(shownManifestAtom);
    fetched = [];
    expect(takeOverContent(store, m1, [top])).toBe(true);
    expect(fetched).toEqual([]);
    expect(store.get(shownManifestAtom)).toBe(before);
    expect(store.get(pickedPageAtom).index).toBe(2);
    expect(store.get(manifestUrlAtom)).toBe(m1);
    expect(store.get(trailAtom).owner).toBe(m1);
    expect(trailUrls(store)).toEqual([top]);
    // Back still works after the takeover
    expect(goBack(store, 'en')).toBe(true);
    expect(store.get(shownManifestAtom)?.url).toBe(top);
  });

  it('takes over after going back too (the trail is shorter)', async () => {
    const store = await openFromTop();
    goBack(store, 'en');
    expect(takeOverContent(store, top, [])).toBe(true);
    expect(store.get(manifestUrlAtom)).toBe(top);
  });

  it('does not take over a different Collection list', async () => {
    const store = await openFromTop();
    expect(takeOverContent(store, m1, [sub])).toBe(false);
    expect(takeOverContent(store, m1, [])).toBe(false);
    expect(takeOverContent(store, m1, [top, sub])).toBe(false);
    expect(store.get(manifestUrlAtom)).toBe(top);
  });

  it('does not take over a different url', async () => {
    const store = await openFromTop();
    expect(takeOverContent(store, m2, [top])).toBe(false);
  });

  it('does not take over while an iiif-content is being read, or when nothing is shown', async () => {
    expect(takeOverContent(createStore(), m1, [])).toBe(false);
    const store = await openFromTop();
    const loading = loadContent(store, m2, () => 'en');
    expect(takeOverContent(store, m1, [top])).toBe(false);
    await loading;
  });
});

describe('what onShownChange reports', () => {
  const report = (store: ReturnType<typeof createStore>) =>
    shownLocation(store.get(shownManifestAtom)!, store.get(trailAtom), store.get(manifestUrlAtom));

  it("'content' for the iiif-content, with the Collections it was reached through", async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    expect(report(store)).toEqual({ url: m1, collections: [top, sub], origin: 'content' });
  });

  it("'move' for an entry opened from a Collection, with the way taken", async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, sub, true, () => 'en');
    expect(report(store)).toEqual({ url: sub, collections: [top], origin: 'move' });
    await openManifest(store, m1, true, () => 'en');
    expect(report(store)).toEqual({ url: m1, collections: [top, sub], origin: 'move' });
  });

  it("'back' after going back one step", async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    goBack(store, 'en');
    expect(report(store)).toEqual({ url: sub, collections: [top], origin: 'back' });
  });

  it('shows nothing new on a takeover: the number of what is shown does not change', async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    const seq = store.get(shownManifestAtom)!.seq;
    takeOverContent(store, m1, [top]);
    expect(store.get(shownManifestAtom)!.seq).toBe(seq);
  });
});
