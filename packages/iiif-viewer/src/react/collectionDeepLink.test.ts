import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { manifestUrlAtom, shownManifestAtom } from './atoms';
import { pickedPageAtom } from './internalState';
import { collectionsFromParams, encodeContentState, sameUrlList } from '../core';
import { loadContent, openContent, pendingCollectionsAtom, shownLocation, takeOverContent } from './useManifest';
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

// the Collections are attached after the manifest is shown, when they have arrived
const settled = async (store: ReturnType<typeof createStore>, count: number) =>
  vi.waitFor(() => expect(store.get(trailAtom).items).toHaveLength(count));
const trailUrls = (store: ReturnType<typeof createStore>) => store.get(trailAtom).items.map((i) => i.url);

describe('loading a manifest with the Collections it was reached through', () => {
  it('shows the manifest as the iiif-content and fills the trail, top first', async () => {
    const store = createStore();
    await expect(loadContent(store, m1, () => 'en', [top, sub])).resolves.toBe('shown');
    await settled(store, 2);
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
    await settled(store, 2);
    // top lists sub second; sub lists m1 second
    expect(store.get(trailAtom).items.map((i) => i.index)).toEqual([1, 1]);
  });

  it('goes back through the Collections one step at a time, to the position that was opened', async () => {
    const store = createStore();
    await loadContent(store, m1, () => 'en', [top, sub]);
    await settled(store, 2);
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
    await settled(store, 1);
    expect(store.get(trailAtom).items.map((i) => i.index)).toEqual([0]);
  });

  it('leaves out a Collection that cannot be read and still shows the manifest', async () => {
    const store = createStore();
    delete served[sub];
    await expect(loadContent(store, m1, () => 'en', [top, sub])).resolves.toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(m1);
    await settled(store, 1);
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
    await settled(store, 2);
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

describe('a Collection that is slow or never answers', () => {
  // fetch that answers `held` URLs only when released
  const hold = (held: string[]) => {
    const release: Record<string, () => void> = {};
    const waits = Object.fromEntries(held.map((h) => [h, new Promise<void>((r) => (release[h] = r))]));
    vi.stubGlobal('fetch', async (target: string) => {
      await waits[target];
      return { ok: target in served, json: async () => served[target] } as unknown as Response;
    });
    return release;
  };

  it('does not hold back the manifest, and the trail is attached when it arrives', async () => {
    const store = createStore();
    const release = hold([top]);
    await expect(loadContent(store, m1, () => 'en', [top])).resolves.toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(m1);
    expect(trailUrls(store)).toEqual([]);
    release[top]();
    await settled(store, 1);
    expect(trailUrls(store)).toEqual([top]);
  });

  it('is put in front of the trail when the reader moved on before it arrived', async () => {
    const store = createStore();
    const release = hold([top]);
    await loadContent(store, sub, () => 'en', [top]);
    await openManifest(store, m1, true, () => 'en');
    expect(trailUrls(store)).toEqual([sub]);
    release[top]();
    await settled(store, 2);
    expect(trailUrls(store)).toEqual([top, sub]);
    // and it arrives after the host took the new place over too
    expect(takeOverContent(store, m1, [top, sub])).toBe(true);
  });

  it('is dropped when a new iiif-content came meanwhile', async () => {
    const store = createStore();
    const release = hold([top]);
    await loadContent(store, m1, () => 'en', [top]);
    await loadContent(store, m2, () => 'en');
    release[top]();
    await new Promise((r) => setTimeout(r, 20));
    expect(trailUrls(store)).toEqual([]);
  });

  it('is not read at all when the manifest cannot be read', async () => {
    const store = createStore();
    delete served[m1];
    await loadContent(store, m1, () => 'en', [top]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetched).toEqual([m1]);
  });
});

describe('the Collections the host gives', () => {
  it('go through the rules of iiif-content: content states are decoded, bad values are dropped', () => {
    expect(
      collectionsFromParams([top, encodeContentState(sub), '//evil.example/x.json', 'not a url', '/local/c.json']),
    ).toEqual([top, sub, '/local/c.json']);
    expect(collectionsFromParams(undefined)).toEqual([]);
  });
});

describe('a new location from the host', () => {
  it('a takeover does not cancel a move still in flight; a real new load does', async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    // the reader clicks m2 (not answered yet), then the host gives back the location shown
    let answer = () => {};
    const wait = new Promise<void>((r) => (answer = r));
    vi.stubGlobal('fetch', async (target: string) => {
      await wait;
      return { ok: target in served, json: async () => served[target] } as unknown as Response;
    });
    const move = openManifest(store, m2, true, () => 'en');
    expect(openContent(store, m1, () => 'en', [top])).toBe('taken');
    answer();
    await expect(move).resolves.toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(m2);

    // a real new iiif-content drops a move in flight
    const move2 = openManifest(store, m1, true, () => 'en');
    const load = openContent(store, top, () => 'en', []);
    await expect(move2).resolves.toBe('stale');
    await load;
  });
});

describe('a manifest the host is not told about', () => {
  it('a dropped link and a map panel open are shown but flagged quiet; a move from a Collection is not', async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, m1, false, () => 'en', 'move');
    expect(store.get(shownManifestAtom)?.quiet).toBe(true);
    await openManifest(store, m2, true, () => 'en', 'move', true);
    expect(store.get(shownManifestAtom)?.quiet).toBe(true);
    await openManifest(store, m1, true, () => 'en');
    expect(store.get(shownManifestAtom)?.quiet).toBeUndefined();
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

  it('browser Back to the place before is the viewer Back: the entry position is restored, nothing is read', async () => {
    const store = createStore();
    await loadContent(store, sub, () => 'en', [top]);
    await settled(store, 1);
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)!.seq, index: 1 });
    await openManifest(store, m1, true, () => 'en');
    fetched = [];
    // the host gives the place before: the Collection, with the Collections above it
    expect(takeOverContent(store, sub, [top])).toBe(true);
    expect(fetched).toEqual([]);
    expect(store.get(shownManifestAtom)?.url).toBe(sub);
    expect(store.get(shownManifestAtom)?.origin).toBe('back');
    expect(store.get(pickedPageAtom).index).toBe(1);
    expect(store.get(manifestUrlAtom)).toBe(sub);
    expect(store.get(trailAtom).owner).toBe(sub);
    expect(trailUrls(store)).toEqual([top]);
  });

  it('does not take over a place that is not one step back', async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, sub, true, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    expect(takeOverContent(store, top, [])).toBe(false);
    expect(takeOverContent(store, sub, [])).toBe(false);
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
    await settled(store, 2);
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
    await settled(store, 2);
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

describe('round 3', () => {
  const where = (store: ReturnType<typeof createStore>) =>
    shownLocation(
      store.get(shownManifestAtom)!,
      store.get(trailAtom),
      store.get(manifestUrlAtom),
      store.get(pendingCollectionsAtom),
    );

  it('counts the Collections still loading as part of the location', async () => {
    const store = createStore();
    let answer = () => {};
    const wait = new Promise<void>((r) => (answer = r));
    vi.stubGlobal('fetch', async (target: string) => {
      if (target === top) await wait;
      return { ok: target in served, json: async () => served[target] } as unknown as Response;
    });
    await loadContent(store, sub, () => 'en', [top]);
    await openManifest(store, m1, true, () => 'en');
    // the move is reported with the Collection above, though it has not arrived
    expect(where(store)).toEqual({ url: m1, collections: [top, sub], origin: 'move' });
    expect(takeOverContent(store, m1, [top, sub])).toBe(true);
    answer();
    await settled(store, 2);
    expect(where(store).collections).toEqual([top, sub]);
    expect(store.get(pendingCollectionsAtom)).toEqual([]);
    expect(takeOverContent(store, m1, [top, sub])).toBe(true);
  });

  it('keeps the resolved URL on the trail when the iiif-content is a content state', async () => {
    const store = createStore();
    const state = encodeContentState(top);
    served[state] = served[top];
    await loadContent(store, state, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    expect(trailUrls(store)).toEqual([top]);
    expect(where(store).collections).toEqual([top]);
    expect(takeOverContent(store, m1, [top])).toBe(true);
  });

  it('finds the entry to go back to by the manifest shown when the iiif-content is a content state', async () => {
    const state = encodeContentState(m1);
    served[state] = served[m1];
    const other = createStore();
    // sub lists m1 second
    await loadContent(other, state, () => 'en', [sub]);
    await settled(other, 1);
    expect(other.get(trailAtom).items[0].index).toBe(1);
  });

  it('a takeover that goes back is quiet: the host has set the place already', async () => {
    const store = createStore();
    await loadContent(store, top, () => 'en');
    await openManifest(store, m1, true, () => 'en');
    expect(store.get(shownManifestAtom)?.quiet).toBeUndefined();
    expect(takeOverContent(store, top, [])).toBe(true);
    expect(store.get(shownManifestAtom)?.quiet).toBe(true);
    // the viewer's own Back is not quiet
    await openManifest(store, m2, true, () => 'en');
    goBack(store, 'en');
    expect(store.get(shownManifestAtom)?.quiet).toBeUndefined();
  });

  it('compares lists of URLs element by element', () => {
    expect(sameUrlList(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameUrlList(['a\nb'], ['a', 'b'])).toBe(false);
    expect(sameUrlList(['a'], ['a', 'b'])).toBe(false);
  });
});
