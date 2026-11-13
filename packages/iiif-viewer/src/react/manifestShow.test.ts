import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { annotationsAtom, manifestUrlAtom, sceneIdAtom, shownManifestAtom } from './atoms';
import { loadContent, prepareShow, reparseAnnotations, showManifest, tryPrepareShow } from './useManifest';
import { goBack, openManifest, pickedPageAtom, trailAtom, focusAtom } from './displays/structureState';
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
  it('reads the Scene on display, not the first one', () => {
    const store = createStore();
    const id = url('two');
    const manifest = convertToV4(manifestJson(id));
    showManifest(store, id, { raw: manifestJson(id), manifest }, 'content', prepareShow(manifest, 'ja'));
    expect(store.get(annotationsAtom)[0]?.title).toBe(`${id}/scene/1 (ja)`);
    // SceneDisplay, showing Scene 2, did this
    store.set(sceneIdAtom, `${id}/scene/2`);
    reparseAnnotations(store, 'en');
    expect(store.get(annotationsAtom).map((a) => a.title)).toEqual([`${id}/scene/2 note`]);
  });

  it('forgets the Scene id of the manifest shown before when another is shown', () => {
    const store = createStore();
    const a = url('a');
    const b = url('b');
    const ma = convertToV4(manifestJson(a));
    showManifest(store, a, { raw: manifestJson(a), manifest: ma }, 'content', prepareShow(ma, 'ja'));
    store.set(sceneIdAtom, `${a}/scene/2`);
    const mb = convertToV4(manifestJson(b));
    showManifest(store, b, { raw: manifestJson(b), manifest: mb }, 'content', prepareShow(mb, 'ja'));
    expect(store.get(sceneIdAtom)).toBeNull();
  });

  it('reads the first Scene when the Scene id is not one of this manifest (an image canvas is shown)', () => {
    const store = createStore();
    const id = url('img');
    const manifest = convertToV4(manifestJson(id));
    showManifest(store, id, { raw: manifestJson(id), manifest }, 'content', prepareShow(manifest, 'ja'));
    store.set(sceneIdAtom, 'https://example.org/other/scene');
    reparseAnnotations(store, 'en');
    expect(store.get(annotationsAtom).map((a) => a.title)).toEqual([`${id}/scene/1 note`]);
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

  it('does not go back to a trail item that cannot be parsed, and keeps the trail', () => {
    const store = createStore();
    const id = url('back');
    const raw = broken(id);
    const manifest = convertToV4(raw);
    store.set(manifestUrlAtom, 'https://example.org/top');
    store.set(trailAtom, { owner: 'https://example.org/top', items: [{ url: id, manifest, raw, index: 0 }] });
    store.set(pickedPageAtom, { shown: 0, index: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(goBack(store, 'en')).toBe(false);
    expect(store.get(trailAtom).items).toHaveLength(1);
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
  });

  it('tryPrepareShow gives null for it, and the prepared value (with its locale) for a good one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(tryPrepareShow(convertToV4(broken(url('t'))), 'en')).toBeNull();
    expect(tryPrepareShow(convertToV4(manifestJson(url('g'))), 'en')?.locale).toBe('en');
  });

  it('prepareShow throws for it (the guard has something to catch)', () => {
    expect(() => prepareShow(convertToV4(broken(url('p'))), 'en')).toThrow();
  });
});
