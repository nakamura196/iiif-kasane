'use client';

import { useEffect, useRef, useState } from 'react';
import { atom, useAtomValue, useStore, type createStore } from 'jotai';
import {
  convertToV4,
  fetchManifest,
  paintedModelsOf,
  parseManifestV4,
  sceneOf,
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
  selectedAnnotationIdAtom,
  sceneIdAtom,
  shownManifestAtom,
  type ShownOrigin,
} from './atoms';
import { useLocale } from './env';
import { backFailedAtom, resetViewState, shownSeqAtom } from './internalState';

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

/**
 * Parse a manifest for showing: the notes and painted models of the Scene `sceneId` (default: the first Scene).
 * Throws when the manifest's v4 form cannot be parsed (nothing is changed).
 */
export function prepareShow(manifest: ManifestV4, locale: string, sceneId?: string): PreparedShow {
  const { annotations, geoCanvasId, geoFeatures } = parseManifestV4(manifest, sceneId, locale);
  return {
    annotations,
    hasGeo: !!geoCanvasId || geoFeatures.length > 0,
    paintedModels: paintedModelsOf(sceneOf(manifest, sceneId)),
  };
}

// What was parsed for a manifest, by locale and Scene (null: it could not be parsed). The guard before showing
// parses the first Scene and the display reads the same result: a manifest is parsed once per show and once per
// locale (or Scene) wanted, and a failure is reported once.
const parsedCache = new WeakMap<ManifestV4, Map<string, PreparedShow | null>>();

/** prepareShow, or null (reported on the console) when the manifest cannot be parsed. Remembered per manifest. */
export function tryPrepareShow(manifest: ManifestV4, locale: string, sceneId?: string): PreparedShow | null {
  let byKey = parsedCache.get(manifest);
  if (!byKey) parsedCache.set(manifest, (byKey = new Map()));
  const key = `${locale}\n${sceneId ?? ''}`;
  if (byKey.has(key)) return byKey.get(key) ?? null;
  let result: PreparedShow | null = null;
  try {
    result = prepareShow(manifest, locale, sceneId);
  } catch (e) {
    console.error('Error reading manifest:', e);
  }
  byKey.set(key, result);
  return result;
}

/**
 * What belongs to the manifest shown and goes back to its start with each manifest shown (and when what was
 * shown is cleared): model choices, layer settings, the selected annotation. One list, used by both.
 */
function resetShownState(store: Store): void {
  store.set(modelChoicesAtom, {});
  store.set(layerSettingsAtom, {});
  store.set(layerOrderAtom, {});
  store.set(layerPlaybackAtom, null);
  store.set(selectedAnnotationIdAtom, null);
}

/** Leave everything of the manifest shown: used when the new iiif-content cannot be shown. */
function clearShown(store: Store): void {
  store.set(shownManifestAtom, null);
  store.set(manifestAtom, null);
  resetShownState(store);
  resetViewState(store);
}

/**
 * Put a manifest (or Collection) into the store as the shown one: the manifest, its URL and served JSON,
 * and reset model choices, layer settings and the selected annotation. The notes and painted 3D models
 * are read from manifestAtom by useShownNotes.
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
  const { hasGeo } = prepared;
  beginLoad(store);
  resetShownState(store);
  store.set(backFailedAtom, false);
  // shownSeqAtom only grows, also over a failed load that cleared what was shown
  const seq = store.get(shownSeqAtom) + 1;
  store.set(shownSeqAtom, seq);
  store.set(shownManifestAtom, { url, raw, manifest, seq, origin, hasGeo });
  store.set(manifestAtom, manifest);
  // the notes and painted models are read from manifestAtom by useShownNotes
}

/**
 * The one place that sets the notes (annotationsAtom) and the painted models: they are read from the manifest the
 * displays use (manifestAtom), for the Scene on display (else the first Scene) and the locale.
 */
export function writeShownNotes(store: Store, manifest: ManifestV4 | null, locale: string, sceneId?: string): void {
  const read = manifest ? tryPrepareShow(manifest, locale, sceneId) : null;
  store.set(annotationsAtom, read?.annotations ?? []);
  store.set(paintedModelsAtom, read?.paintedModels ?? []);
}

/**
 * Keep the notes, painted models and Scene id of the store in step with what is on display. `sceneId` is the id
 * of the Scene on display (undefined for any other page).
 * A host that writes annotationsAtom itself keeps its value until the manifest, the Scene or the locale changes.
 */
export function useShownNotes(sceneId?: string): void {
  const store = useStore();
  const manifest = useAtomValue(manifestAtom);
  const locale = useLocale();
  useEffect(() => {
    writeShownNotes(store, manifest, locale, sceneId);
  }, [store, manifest, locale, sceneId]);
  // a notes' selection and the Scene id belong to the Scene on display
  useEffect(() => {
    store.set(sceneIdAtom, sceneId ?? null);
    store.set(selectedAnnotationIdAtom, null);
  }, [store, manifest, sceneId]);
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
  // useManifest) rather than silently keeping the old one. What was shown is cleared with it (see below).
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
    // nothing of the old iiif-content stays under the new URL: only the failure is shown
    if (result === 'failed') clearShown(store);
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
export function useManifest(iiifContent: string | null, sceneId?: string): { failed: boolean } {
  // the url that could not be read; compared with the current one so that no state is reset in the effect
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const store = useStore();
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

  useShownNotes(sceneId);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
