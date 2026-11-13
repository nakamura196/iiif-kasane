import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { manifestAtom, manifestUrlAtom, shownManifestAtom } from '../atoms';
import { loadContent } from '../useManifest';
import { goBack, openManifest, openWithTargets, trailAtom } from './structureState';
import { compareAtom, focusAtom, pickedPageAtom } from '../internalState';

// Moves inside a Collection (openManifest) and the first load (loadContent), checked on a jotai store alone.
// fetch is replaced, and each test decides the order of the answers.

const manifestJson = (id: string) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Manifest',
  label: { en: [id] },
  items: [{ id: `${id}/canvas/1`, type: 'Canvas', width: 10, height: 10, items: [] }],
});

let run = 0;
let pending: Map<string, () => void>;
let requested: string[];
// a unique URL per test: fetchManifest keeps answers for a minute
const url = (name: string) => `https://example.org/t${run}/${name}.json`;

beforeEach(() => {
  run += 1;
  pending = new Map();
  requested = [];
  vi.stubGlobal('fetch', (input: string) => {
    requested.push(input);
    return new Promise((resolve) => {
      pending.set(input, () =>
        resolve({ ok: true, json: async () => manifestJson(input) } as unknown as Response),
      );
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answer the request for the URL, and let the promise chains after it run. */
async function answer(u: string) {
  for (let i = 0; i < 20 && !pending.has(u); i++) await new Promise((r) => setTimeout(r, 0));
  const reply = pending.get(u);
  if (!reply) throw new Error(`no request for ${u}`);
  reply();
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

const locale = () => 'en';

describe('openManifest', () => {
  it('shows only the last of two entries opened quickly, even when the first answers last', async () => {
    const store = createStore();
    const a = openManifest(store, url('a'), true, locale);
    const b = openManifest(store, url('b'), true, locale);
    await answer(url('b'));
    await answer(url('a'));
    await Promise.all([a, b]);
    expect(store.get(shownManifestAtom)?.url).toBe(url('b'));
    expect(store.get(manifestAtom)?.id).toBe(url('b'));
    // the dropped request is neither shown nor a failure (the entry can stop showing "opening")
    expect(await a).toBe('stale');
    expect(await b).toBe('shown');
  });

  it('is dropped when a new iiif-content starts loading meanwhile', async () => {
    const store = createStore();
    const entry = openManifest(store, url('entry'), true, locale);
    const top = loadContent(store, url('other-top'), locale);
    await answer(url('other-top'));
    await answer(url('entry'));
    expect(await top).toBe('shown');
    await entry;
    expect(store.get(shownManifestAtom)?.url).toBe(url('other-top'));
  });

  it('lets a new iiif-content still being read win over an entry opened meanwhile', async () => {
    const store = createStore();
    const top = loadContent(store, url('top'), locale);
    const entry = openManifest(store, url('entry'), false, locale);
    expect(await entry).toBe('stale');
    await answer(url('top'));
    expect(await top).toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(url('top'));
  });

  it('keeps the served JSON with the shown manifest, and puts the one being left on the trail', async () => {
    const store = createStore();
    store.set(manifestUrlAtom, url('collection'));
    const top = loadContent(store, url('collection'), locale);
    await answer(url('collection'));
    await top;
    const entry = openManifest(store, url('entry'), true, locale);
    await answer(url('entry'));
    expect(await entry).toBe('shown');

    const shown = store.get(shownManifestAtom);
    expect(shown?.url).toBe(url('entry'));
    expect((shown?.raw as { id: string }).id).toBe(url('entry'));
    // the trail step is the Collection (its own URL, not the entry's), with its JSON
    const trail = store.get(trailAtom);
    expect(trail.items.map((i) => i.url)).toEqual([url('collection')]);
    expect((trail.items[0].raw as { id: string }).id).toBe(url('collection'));

    // back: the Collection is shown again from the trail, with its JSON, and nothing is fetched
    const before = requested.length;
    expect(goBack(store, 'en')).toBe(true);
    expect(store.get(shownManifestAtom)?.url).toBe(url('collection'));
    expect((store.get(shownManifestAtom)?.raw as { id: string }).id).toBe(url('collection'));
    expect(requested.length).toBe(before);
  });

  it('drops an entry still loading when the reader goes back', async () => {
    const store = createStore();
    store.set(manifestUrlAtom, url('collection'));
    const top = loadContent(store, url('collection'), locale);
    await answer(url('collection'));
    await top;
    const first = openManifest(store, url('first'), true, locale);
    await answer(url('first'));
    await first;
    const second = openManifest(store, url('second'), true, locale);
    goBack(store, 'en');
    await answer(url('second'));
    await second;
    expect(store.get(shownManifestAtom)?.url).toBe(url('collection'));
  });

  it('counts each shown manifest, also the same one shown again', async () => {
    const store = createStore();
    store.set(manifestUrlAtom, url('collection'));
    const top = loadContent(store, url('collection'), locale);
    await answer(url('collection'));
    await top;
    const s1 = store.get(shownManifestAtom)!.seq;
    const entry = openManifest(store, url('entry'), true, locale);
    await answer(url('entry'));
    await entry;
    goBack(store, 'en');
    expect(store.get(shownManifestAtom)!.seq).toBe(s1 + 2);
  });

  it('goes back to the page the reader was on', async () => {
    const store = createStore();
    store.set(manifestUrlAtom, url('top'));
    const top = loadContent(store, url('top'), locale);
    await answer(url('top'));
    await top;
    // the reader is on the third page of what is shown
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)!.seq, index: 2 });
    const entry = openManifest(store, url('entry'), true, locale);
    await answer(url('entry'));
    await entry;
    expect(store.get(trailAtom).items[0].index).toBe(2);
    // the entry starts from its first page (the picked page belonged to the one left)
    expect(store.get(pickedPageAtom).shown).not.toBe(store.get(shownManifestAtom)!.seq);
    goBack(store, 'en');
    expect(store.get(pickedPageAtom)).toEqual({ shown: store.get(shownManifestAtom)!.seq, index: 2 });
  });

  it('clears the focus and compare of the manifest left before the new one is shown', async () => {
    const store = createStore();
    store.set(focusAtom, { seq: 1, target: { canvasId: 'x' } });
    store.set(compareAtom, [1, 2]);
    // what is set right when the new manifest is shown (as a content state target would be) stays
    const unsub = store.sub(manifestAtom, () => store.set(compareAtom, [0, 1]));
    const entry = openManifest(store, url('entry'), false, locale);
    await answer(url('entry'));
    await entry;
    unsub();
    expect(store.get(focusAtom)).toBeNull();
    expect(store.get(compareAtom)).toEqual([0, 1]);
  });

  it('records how each manifest came to be shown', async () => {
    const store = createStore();
    const top = loadContent(store, url('collection'), locale);
    await answer(url('collection'));
    await top;
    expect(store.get(shownManifestAtom)?.origin).toBe('content');
    const entry = openManifest(store, url('entry'), true, locale);
    await answer(url('entry'));
    await entry;
    expect(store.get(shownManifestAtom)?.origin).toBe('move');
    goBack(store, 'en');
    expect(store.get(shownManifestAtom)?.origin).toBe('back');
  });

  it('does not go back while a new iiif-content is read, and forgets the old trail', async () => {
    const store = createStore();
    const top = loadContent(store, url('collection'), locale);
    await answer(url('collection'));
    await top;
    const entry = openManifest(store, url('entry'), true, locale);
    await answer(url('entry'));
    await entry;
    expect(store.get(trailAtom).items).toHaveLength(1);

    const other = loadContent(store, url('other'), locale);
    // no stale "back" into the old iiif-content, and its JSON is not kept
    expect(store.get(trailAtom).items).toEqual([]);
    expect(goBack(store, 'en')).toBe(false);
    await answer(url('other'));
    expect(await other).toBe('shown');
    expect(store.get(shownManifestAtom)?.url).toBe(url('other'));
  });
});

describe('openWithTargets', () => {
  it('forgets the targets when the manifest is not shown', async () => {
    const pending: { current: string[] | null } = { current: null };
    expect(await openWithTargets(async () => 'stale', pending, 'u', ['t'], 'move')).toBe('stale');
    expect(pending.current).toBeNull();
    expect(await openWithTargets(async () => 'failed', pending, 'u', ['t'], 'move')).toBe('failed');
    expect(pending.current).toBeNull();
  });
  it('keeps them for the manifest that is shown', async () => {
    const pending: { current: string[] | null } = { current: null };
    const targets = ['t'];
    // the shown manifest takes them (ContainerList empties pending when it applies them)
    await openWithTargets(async () => 'shown', pending, 'u', targets, 'content');
    expect(pending.current).toBe(targets);
  });
});
