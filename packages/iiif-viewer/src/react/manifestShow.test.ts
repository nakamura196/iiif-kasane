import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { annotationsAtom, manifestAtom, manifestUrlAtom, pickedPageAtom, sceneIdAtom, shownManifestAtom } from './atoms';
import { readScene } from './displays/readScene';
import { loadContent, prepareShow, reparseAnnotations, showManifest, tryPrepareShow } from './useManifest';
import { goBack, openManifest, trailAtom, focusAtom } from './displays/structureState';
import { convertToV4 } from '../core';

// A Presentation 4 manifest with Scenes; each carries one note labelled after the Scene
// (the label has a Japanese and an English form, to see which locale is read).
const note = (scene: string, selector: object) => ({
  type: 'AnnotationPage',
  id: `${scene}/notes`,
  items: [
    {
      id: `${scene}/note/1`,
      type: 'Annotation',
      motivation: ['commenting'],
      label: { ja: [`${scene} (ja)`], en: [`${scene} note`] },
      body: { type: 'TextualBody', value: scene, format: 'text/plain' },
      target: { type: 'SpecificResource', source: { id: scene, type: 'Scene' }, selector: [selector] },
    },
  ],
});
const manifestJson = (id: string, selector: object = { type: 'PointSelector', x: 0, y: 0, z: 0 }, scenes = 2) => ({
  '@context': 'http://iiif.io/api/presentation/4/context.json',
  id,
  type: 'Manifest',
  label: { en: [id] },
  items: Array.from({ length: scenes }, (_, i) => {
    const scene = `${id}/scene/${i + 1}`;
    return { id: scene, type: 'Scene', items: [], annotations: [note(scene, selector)] };
  }),
});
// a Scene note whose WKTSelector has no string value: the parser throws on it
const broken = (id: string) => manifestJson(id, { type: 'WKTSelector' });

let run = 0;
const url = (name: string) => `https://example.org/s${run}/${name}.json`;
beforeEach(() => {
  run += 1;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const stubFetch = (served: Record<string, unknown>) =>
  vi.stubGlobal('fetch', async (u: string) => ({ ok: u in served, json: async () => served[u] }) as unknown as Response);

describe('reparseAnnotations (a new locale)', () => {
  const showTwoScenes = (id: string) => {
    const store = createStore();
    const manifest = convertToV4(manifestJson(id));
    showManifest(store, id, { raw: manifestJson(id), manifest }, 'content', prepareShow(manifest, 'ja'));
    return store;
  };

  it('leaves the notes alone when a Scene is on display (SceneDisplay reads that Scene for the locale)', () => {
    const id = url('two');
    const store = showTwoScenes(id);
    // the reader is on Scene 2 (the second page); SceneDisplay put its notes there
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)?.seq ?? 0, index: 1 });
    store.set(annotationsAtom, []);
    reparseAnnotations(store, 'en');
    expect(store.get(annotationsAtom)).toEqual([]);
  });

  it('reads the first Scene again when an image page is on display', () => {
    const id = url('img');
    const raw = manifestJson(id);
    const withCanvas = { ...raw, items: [{ id: `${id}/canvas/1`, type: 'Canvas', width: 10, height: 10, items: [] }, ...raw.items] };
    const store = createStore();
    const manifest = convertToV4(withCanvas);
    showManifest(store, id, { raw: withCanvas, manifest }, 'content', prepareShow(manifest, 'ja'));
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)?.seq ?? 0, index: 0 });
    reparseAnnotations(store, 'en');
    expect(store.get(annotationsAtom).map((a) => a.title)).toEqual([`${id}/scene/1 note`]);
  });

  it('keeps the Scene id when the same manifest is shown again (SceneDisplay does not set it again)', () => {
    const id = url('again');
    const store = showTwoScenes(id);
    store.set(sceneIdAtom, `${id}/scene/2`);
    const shown = store.get(shownManifestAtom)!;
    showManifest(store, id, { raw: shown.raw, manifest: shown.manifest }, 'content', prepareShow(shown.manifest, 'ja'));
    expect(store.get(sceneIdAtom)).toBe(`${id}/scene/2`);
  });
});

describe('readScene', () => {
  it('reads a Scene of the manifest, and gives null (not a throw) for a Scene that cannot be parsed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = url('rs');
    const raw = manifestJson(id);
    // Scene 1 is good, Scene 2 has a note that cannot be parsed
    raw.items[1] = broken(id).items[1];
    const manifest = convertToV4(raw);
    expect(readScene(manifest, `${id}/scene/1`, 'en')?.annotations).toHaveLength(1);
    expect(() => prepareShow(manifest, 'en')).not.toThrow();
    expect(readScene(manifest, `${id}/scene/2`, 'en')).toBeNull();
  });
});

describe('a manifest that cannot be parsed', () => {
  it('is reported as failed for the iiif-content, and nothing is shown', async () => {
    const store = createStore();
    const id = url('bad');
    stubFetch({ [id]: broken(id) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadContent(store, id, () => 'en')).resolves.toBe('failed');
    expect(store.get(shownManifestAtom)).toBeNull();
  });

  it('is reported as failed for an entry opened from a Collection, and the trail and view are unchanged', async () => {
    const store = createStore();
    const first = url('first');
    const bad = url('bad');
    stubFetch({ [first]: manifestJson(first), [bad]: broken(bad) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadContent(store, first, () => 'en')).resolves.toBe('shown');
    store.set(focusAtom, { seq: 1, target: { canvasId: 'x' } } as never);
    const before = store.get(shownManifestAtom);
    await expect(openManifest(store, bad, true, () => 'en')).resolves.toBe('failed');
    expect(store.get(trailAtom).items).toEqual([]);
    expect(store.get(focusAtom)).not.toBeNull();
    expect(store.get(shownManifestAtom)).toBe(before);
  });

  it('drops a trail item that cannot be parsed and goes back to the one before it', () => {
    const store = createStore();
    const good = url('bgood');
    const bad = url('bbad');
    const mg = convertToV4(manifestJson(good));
    const mb = convertToV4(broken(bad));
    store.set(manifestUrlAtom, 'https://example.org/top');
    store.set(trailAtom, {
      owner: 'https://example.org/top',
      items: [
        { url: good, manifest: mg, raw: manifestJson(good), index: 0 },
        { url: bad, manifest: mb, raw: broken(bad), index: 0 },
      ],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(goBack(store, 'en')).toBe(true);
    expect(store.get(shownManifestAtom)?.url).toBe(good);
    expect(store.get(trailAtom).items).toEqual([]);
  });

  it('does not go back to a trail item that cannot be parsed, and drops it from the trail', () => {
    const store = createStore();
    const id = url('back');
    const raw = broken(id);
    const manifest = convertToV4(raw);
    store.set(manifestUrlAtom, 'https://example.org/top');
    store.set(trailAtom, { owner: 'https://example.org/top', items: [{ url: id, manifest, raw, index: 0 }] });
    store.set(pickedPageAtom, { shown: 0, index: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(goBack(store, 'en')).toBe(false);
    expect(store.get(trailAtom).items).toHaveLength(0);
    expect(store.get(shownManifestAtom)).toBeNull();
  });

  it('reports the failure for the new iiif-content: its URL is kept and the old trail is dropped', async () => {
    const store = createStore();
    const a = url('ca');
    const bad = url('cbad');
    stubFetch({ [a]: manifestJson(a), [bad]: broken(bad) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadContent(store, a, () => 'en');
    await expect(loadContent(store, bad, () => 'en')).resolves.toBe('failed');
    expect(store.get(manifestUrlAtom)).toBe(bad);
    expect(store.get(trailAtom)).toEqual({ owner: bad, items: [] });
    // nothing of A stays under B's URL
    expect(store.get(shownManifestAtom)).toBeNull();
    expect(store.get(manifestAtom)).toBeNull();
  });

  it('tryPrepareShow gives null for it, and the prepared value for a good one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(tryPrepareShow(convertToV4(broken(url('t'))), 'en')).toBeNull();
    expect(tryPrepareShow(convertToV4(manifestJson(url('g'))), 'en')?.annotations).toHaveLength(1);
  });

  it('prepareShow throws for it (the guard has something to catch)', () => {
    expect(() => prepareShow(convertToV4(broken(url('p'))), 'en')).toThrow();
  });
});
