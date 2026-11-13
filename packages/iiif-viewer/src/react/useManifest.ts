'use client';

import { useEffect, useRef, useState } from 'react';
import { atom, useStore, type createStore } from 'jotai';
import {
  containersOf,
  convertToV4,
  fetchManifest,
  firstSceneOf,
  paintedModelsOf,
  parseManifestV4,
  type ManifestV4,
} from '../core';
import {
  annotationsAtom,
  layerOrderAtom,
  layerPlaybackAtom,
  layerSettingsAtom,
  manifestAtom,
  manifestUrlAtom,
  modelChoicesAtom,
  paintedModelsAtom,
  pickedPageAtom,
  pickedIndex,
  shownManifestAtom,
  type ShownOrigin,
} from './atoms';
import { useLocale } from './env';

type Store = ReturnType<typeof createStore>;

/** A manifest (or Collection) as served and as converted. */
export interface ManifestSource {
  /** The JSON as served (made into Presentation 3; before convertToV4). */
  raw: unknown;
  manifest: ManifestV4;
}

/** Read a manifest (or Collection) from its URL, keeping the served JSON. null when it cannot be read or converted. */
export async function readManifestSource(url: string): Promise<ManifestSource | null> {
  const raw = await fetchManifest(url);
  if (!raw) return null;
  try {
    return { raw, manifest: convertToV4(raw) };
  } catch (e) {
    console.error('Error reading manifest:', e);
    return null;
  }
}

/** Read a manifest (or Collection) from its URL. null when it cannot be read or converted. */
export async function readManifest(url: string): Promise<ManifestV4 | null> {
  return (await readManifestSource(url))?.manifest ?? null;
}

// Load ticket. The first load, a move inside a Collection and going back all advance it; a load whose
// ticket has changed by the time it is read (something else was asked for meanwhile) is dropped
const loadTicketAtom = atom(0);

/** Start a load. The returned function is true while no later load (or show) has started in this store. */
export function beginLoad(store: Store): () => boolean {
  const ticket = store.get(loadTicketAtom) + 1;
  store.set(loadTicketAtom, ticket);
  return () => store.get(loadTicketAtom) === ticket;
}

/** What showManifest derives from a manifest. Computed before anything in the store changes, because it can throw. */
export interface PreparedShow {
  annotations: ReturnType<typeof parseManifestV4>['annotations'];
  hasGeo: boolean;
  paintedModels: ReturnType<typeof paintedModelsOf>;
}

/** Parse a manifest for showing. Throws when the manifest's v4 form cannot be parsed (nothing is changed). */
export function prepareShow(manifest: ManifestV4, locale: string): PreparedShow {
  const { annotations, geoCanvasId, geoFeatures } = parseManifestV4(manifest, undefined, locale);
  return {
    annotations,
    hasGeo: !!geoCanvasId || geoFeatures.length > 0,
    paintedModels: paintedModelsOf(firstSceneOf(manifest)),
  };
}

/** prepareShow, or null (reported on the console) when the manifest cannot be parsed. */
export function tryPrepareShow(manifest: ManifestV4, locale: string): PreparedShow | null {
  try {
    return prepareShow(manifest, locale);
  } catch (e) {
    console.error('Error reading manifest:', e);
    return null;
  }
}

/**
 * Put a manifest (or Collection) into the store as the shown one: the manifest, its URL and served JSON,
 * its annotations, the painted 3D models, and reset model choices and layer settings.
 * Loads still in flight are dropped (what is shown now is the latest request).
 * The only way a manifest is shown: the first load, the moves inside a Collection and going back all use it,
 * so the parts that need the served JSON always get the one of what is shown.
 */
export function showManifest(
  store: Store,
  url: string,
  source: ManifestSource,
  origin: ShownOrigin,
  prepared: PreparedShow,
): void {
  const { manifest, raw } = source;
  const { annotations, hasGeo, paintedModels } = prepared;
  beginLoad(store);
  store.set(paintedModelsAtom, paintedModels);
  store.set(modelChoicesAtom, {});
  store.set(layerSettingsAtom, {});
  store.set(layerOrderAtom, {});
  store.set(layerPlaybackAtom, null);
  const seq = (store.get(shownManifestAtom)?.seq ?? 0) + 1;
  store.set(shownManifestAtom, { url, raw, manifest, seq, origin, hasGeo });
  store.set(manifestAtom, manifest);
  store.set(annotationsAtom, annotations);
}

/**
 * A new locale: read the annotations' labels again from what is shown. When the page on display is a Scene,
 * SceneDisplay owns the annotations (it reads that Scene again for the locale), so nothing is done here.
 * Otherwise (an image or AV page) the annotations are the first Scene's, as showManifest put them.
 */
export function reparseAnnotations(store: Store, locale: string): void {
  const shown = store.get(shownManifestAtom);
  if (!shown) return;
  const containers = containersOf(shown.manifest);
  const here = containers[pickedIndex(store.get(pickedPageAtom), shown.seq, containers.length)];
  if (here?.kind === 'Scene') return;
  try {
    store.set(annotationsAtom, parseManifestV4(shown.manifest, undefined, locale).annotations);
  } catch (e) {
    console.error('Error reading manifest:', e);
  }
}

/** Result of loading a manifest: shown, could not be read, or dropped because a later request replaced it. */
export type OpenResult = 'shown' | 'failed' | 'stale';

/** One step of the trail: what was shown, its URL, its served JSON and the page the reader was on. */
export interface TrailItem {
  url: string;
  manifest: ManifestV4;
  raw: unknown;
  /** Index of the page (container) shown when the reader left it. */
  index: number;
}

/** The way taken through Collections: what was shown before each move, to go back to it. Emptied for a new iiif-content. */
export const trailAtom = atom<{ owner: string | null; items: TrailItem[] }>({ owner: null, items: [] });

/**
 * Read the manifest at the URL and show it, unless a later load or show started meanwhile.
 * 'stale': a later request replaced this one (nothing was changed).
 */
export async function loadManifest(
  store: Store,
  url: string,
  locale: () => string,
  origin: ShownOrigin,
  beforeShow?: (source: ManifestSource) => void,
): Promise<OpenResult> {
  const isCurrent = beginLoad(store);
  const source = await readManifestSource(url);
  if (!isCurrent()) return 'stale';
  if (!source) return 'failed';
  // parsed before beforeShow, so a manifest that cannot be parsed changes nothing (no trail entry, no cleared focus)
  const prepared = tryPrepareShow(source.manifest, locale());
  if (!prepared) return 'failed';
  beforeShow?.(source);
  showManifest(store, url, source, origin, prepared);
  return 'shown';
}

// The load of the iiif-content in flight (a token), or null. While it is in flight, opening an entry is
// dropped: the new iiif-content always wins over a move inside what was shown before.
const contentLoadAtom = atom<object | null>(null);

/** True while the iiif-content given to the viewer is being read. */
export const isContentLoading = (store: Store): boolean => store.get(contentLoadAtom) !== null;

/** Read the iiif-content given to the viewer and show it. Moves started meanwhile are dropped, not this load. */
export async function loadContent(store: Store, url: string, locale: () => string): Promise<OpenResult> {
  // The iiif-content is a new one whatever the load gives: the URL and the trail are set at once. When the
  // manifest cannot be read or parsed, the viewer reports the failure for this new content (failedUrl in
  // useManifest) rather than silently keeping the old one; only the shown manifest is left as it was.
  store.set(manifestUrlAtom, url);
  // the way taken through the old iiif-content does not lead back from the new one
  store.set(trailAtom, { owner: url, items: [] });
  const token = {};
  store.set(contentLoadAtom, token);
  const done = () => {
    if (store.get(contentLoadAtom) === token) store.set(contentLoadAtom, null);
  };
  try {
    // done before it is shown: what is shown (a content state Annotation) may open its manifest right away
    const result = await loadManifest(store, url, locale, 'content', done);
    if (result === 'failed') {
      // nothing of the old iiif-content stays under the new URL: only the failure is shown
      store.set(shownManifestAtom, null);
      store.set(manifestAtom, null);
      store.set(annotationsAtom, []);
      store.set(paintedModelsAtom, []);
    }
    return result;
  } finally {
    done();
  }
}

/** Stop waiting for the iiif-content load in flight (the viewer got another iiif-content, or was removed). */
export function cancelContentLoad(store: Store): void {
  store.set(contentLoadAtom, null);
  beginLoad(store);
}

/** The locale, read when called (not a dependency of effects). */
export function useLocaleRef(): { readonly current: string } {
  const locale = useLocale();
  const ref = useRef(locale);
  useEffect(() => {
    ref.current = locale;
  }, [locale]);
  return ref;
}

/** Load the manifest given to the viewer (iiif-content) into the current jotai store. */
export function useManifest(iiifContent: string | null): { failed: boolean } {
  // the url that could not be read; compared with the current one so that no state is reset in the effect
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const store = useStore();
  const locale = useLocale();
  const localeRef = useLocaleRef();

  // only a new iiif-content reads again (a new locale must not send the reader back to the top of a Collection)
  useEffect(() => {
    if (!iiifContent) return;
    let cancelled = false;
    void loadContent(store, iiifContent, () => localeRef.current).then((result) => {
      if (!cancelled && result === 'failed') setFailedUrl(iiifContent);
    });
    return () => {
      cancelled = true;
      // a load (or a move inside a Collection) still in flight is for the old iiif-content
      cancelContentLoad(store);
    };
  }, [iiifContent, store, localeRef]);

  // a new locale: the annotations' labels are read again from what is shown
  const parsedLocale = useRef(locale);
  useEffect(() => {
    if (parsedLocale.current === locale) return;
    parsedLocale.current = locale;
    reparseAnnotations(store, locale);
  }, [locale, store]);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
