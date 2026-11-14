'use client';

import { useEffect, useRef, useState } from 'react';
import { atom, useStore, type createStore } from 'jotai';
import {
  containersOf,
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
  sceneIdAtom,
  selectedAnnotationIdAtom,
  shownManifestAtom,
  type ShownOrigin,
} from './atoms';
import { useLocale } from './env';
import { resetViewState, sceneDisplayAtom, shownSeqAtom } from './internalState';

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
 * Throws when the models cannot be read (nothing is changed); notes that cannot be read give no notes.
 */
export function prepareShow(manifest: ManifestV4, locale: string, sceneId?: string): PreparedShow {
  // the notes degrade on their own: when they cannot be read the models are still drawn, with no notes
  let annotations: PreparedShow['annotations'] = [];
  let hasGeo = false;
  try {
    const parsed = parseManifestV4(manifest, sceneId, locale);
    annotations = parsed.annotations;
    hasGeo = !!parsed.geoCanvasId || parsed.geoFeatures.length > 0;
  } catch (e) {
    console.error('Error reading the notes of the manifest:', e);
  }
  return { annotations, hasGeo, paintedModels: paintedModelsOf(sceneOf(manifest, sceneId)) };
}

// What was parsed for a manifest, by locale and Scene (null: it could not be parsed). The guard before showing
// parses the first Scene and the writer and the display read the same result (the key is the Scene read, so
// 'no id' and the first Scene's id are one entry): a manifest is parsed once per show and once per locale (or
// other Scene) wanted, and a failure is reported once.
const parsedCache = new WeakMap<ManifestV4, Map<string, PreparedShow | null>>();

/** prepareShow, or null (reported on the console) when the manifest cannot be parsed. Remembered per manifest. */
export function tryPrepareShow(manifest: ManifestV4, locale: string, sceneId?: string): PreparedShow | null {
  let byKey = parsedCache.get(manifest);
  if (!byKey) parsedCache.set(manifest, (byKey = new Map()));
  let key = '';
  try {
    // the Scene actually read (no id, or an id the manifest does not have, is the first Scene)
    key = `${locale}\n${sceneOf(manifest, sceneId)?.id ?? ''}`;
    if (byKey.has(key)) return byKey.get(key) ?? null;
    const result = prepareShow(manifest, locale, sceneId);
    byKey.set(key, result);
    return result;
  } catch (e) {
    console.error('Error reading manifest:', e);
    // a manifest whose Scene list cannot even be searched has no key: it is reported each time
    if (key) byKey.set(key, null);
    return null;
  }
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
  store.set(annotationsAtom, []);
  store.set(paintedModelsAtom, []);
  store.set(sceneIdAtom, null);
  store.set(sceneDisplayAtom, (d) => ({ ...d, sceneId: null }));
}

/**
 * Put a manifest (or Collection) into the store as the shown one: the manifest, its URL and served JSON,
 * its first Scene's notes and painted 3D models, and reset model choices, layer settings and the selected
 * annotation.
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
  // the Scene a display read last belongs to the manifest left
  store.set(sceneDisplayAtom, (d) => ({ ...d, sceneId: null }));
  // shownSeqAtom only grows, also over a failed load that cleared what was shown
  const seq = Math.max(store.get(shownSeqAtom), store.get(shownManifestAtom)?.seq ?? 0) + 1;
  store.set(shownSeqAtom, seq);
  store.set(shownManifestAtom, { url, raw, manifest, seq, origin, hasGeo });
  store.set(manifestAtom, manifest);
  // the first Scene's notes and models go in with the manifest (no frame shows the new manifest with the old
  // one's models); a SceneDisplay then reads its own Scene
  store.set(annotationsAtom, prepared.annotations);
  store.set(paintedModelsAtom, prepared.paintedModels);
}

/**
 * A new locale while no SceneDisplay is mounted (an image, AV or other page): read the notes again, from the
 * Scene the last SceneDisplay read if the shown manifest has it, else the first Scene. Only for a manifest the
 * viewer itself showed: one a host set in manifestAtom has the host's own notes. (A mounted SceneDisplay reads
 * its Scene again for the locale itself.)
 */
export function reparseNotes(store: Store, locale: string): void {
  const { mounted, sceneId } = store.get(sceneDisplayAtom);
  const manifest = store.get(manifestAtom);
  if (mounted || !manifest || store.get(shownManifestAtom)?.manifest !== manifest) return;
  const read = tryPrepareShow(manifest, locale, sceneId ?? undefined);
  if (read) store.set(annotationsAtom, read.annotations);
}

/** A manifest (or Collection) shown, as reported by `onShownChange`. */
export interface ViewerShown {
  /** URL of the manifest (or Collection) shown. */
  url: string;
  /** The Collections walked through to reach it, top first (what `collection` takes). Empty at the top. */
  collections: string[];
  /**
   * 'content': the iiif-content (with its `collection`) was read. 'move': the reader opened an entry of a
   * Collection. 'back': the reader went back one step. A host that writes the location into its URL does
   * so for 'move' and 'back' only ('content' may be a content state, which a bare manifest URL would replace).
   */
  origin: ShownOrigin;
}

/** Where a shown manifest is: its URL and the Collections of the trail (when the trail belongs to `owner`, the iiif-content). */
export function shownLocation(
  shown: { url: string; origin: ShownOrigin },
  trail: { owner: string | null; items: { url: string }[] },
  owner: string | null,
): ViewerShown {
  const collections = (trail.owner === owner ? trail.items : []).map((item) => item.url);
  return { url: shown.url, collections, origin: shown.origin };
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

/**
 * Read the manifest and the Collections walked through to reach it (in parallel), then show the manifest as
 * the iiif-content with the Collections on the trail, each with the index of the next step in it (so that
 * Back lands on the entry that was opened). A Collection that cannot be read or parsed is left out of the
 * trail; the manifest is still shown.
 */
async function loadWithCollections(
  store: Store,
  url: string,
  collections: string[],
  locale: () => string,
  beforeShow: () => void,
): Promise<OpenResult> {
  const isCurrent = beginLoad(store);
  const [source, ...read] = await Promise.all([url, ...collections].map((u) => readManifestSource(u)));
  if (!isCurrent()) return 'stale';
  if (!source) return 'failed';
  const prepared = tryPrepareShow(source.manifest, locale());
  if (!prepared) return 'failed';
  const items: TrailItem[] = [];
  collections.forEach((collectionUrl, i) => {
    const entry = read[i];
    if (!entry || !tryPrepareShow(entry.manifest, locale())) return;
    const next = collections[i + 1] ?? url;
    const index = Math.max(0, containersOf(entry.manifest).findIndex((c) => c.id === next));
    items.push({ url: collectionUrl, manifest: entry.manifest, raw: entry.raw, index });
  });
  beforeShow();
  store.set(trailAtom, { owner: url, items });
  showManifest(store, url, source, 'content', prepared);
  return 'shown';
}

/**
 * The host gives an iiif-content + Collections that are what is shown already (the host wrote the location
 * into its URL after a move): nothing is read, the new iiif-content only becomes the owner of the trail, and
 * the page and everything else stay. false (nothing changed) when what is shown is not that location.
 */
export function takeOverContent(store: Store, url: string, collections: string[]): boolean {
  const shown = store.get(shownManifestAtom);
  if (!shown || shown.url !== url || isContentLoading(store)) return false;
  const trail = store.get(trailAtom);
  const items = trail.owner === store.get(manifestUrlAtom) ? trail.items : [];
  if (items.length !== collections.length || items.some((item, i) => item.url !== collections[i])) return false;
  store.set(manifestUrlAtom, url);
  store.set(trailAtom, { owner: url, items });
  return true;
}

/**
 * Read the iiif-content given to the viewer and show it. Moves started meanwhile are dropped, not this load.
 * `collections` are the Collections walked through to reach it, top first (see loadWithCollections).
 */
export async function loadContent(
  store: Store,
  url: string,
  locale: () => string,
  collections: string[] = [],
): Promise<OpenResult> {
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
    const result =
      collections.length > 0
        ? await loadWithCollections(store, url, collections, locale, done)
        : await loadManifest(store, url, locale, 'content', done);
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
export function useManifest(iiifContent: string | null, collection?: string[]): { failed: boolean } {
  // the url that could not be read; compared with the current one so that no state is reset in the effect
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const store = useStore();
  const localeRef = useLocaleRef();

  // the Collections as one string, so that a new array with the same URLs is not a new location
  const collectionKey = (collection ?? []).join('\n');

  // only a new iiif-content (or other Collections) reads again (a new locale must not send the reader back to
  // the top of a Collection)
  useEffect(() => {
    if (!iiifContent) return;
    const collections = collectionKey ? collectionKey.split('\n') : [];
    // the host wrote the location that is shown into its URL: nothing to read
    if (takeOverContent(store, iiifContent, collections)) return;
    let cancelled = false;
    void loadContent(store, iiifContent, () => localeRef.current, collections).then((result) => {
      if (!cancelled && result === 'failed') setFailedUrl(iiifContent);
    });
    return () => {
      cancelled = true;
      // a load (or a move inside a Collection) still in flight is for the old iiif-content
      cancelContentLoad(store);
    };
  }, [iiifContent, collectionKey, store, localeRef]);

  // a new locale: the notes' labels are read again (see reparseNotes)
  const locale = useLocale();
  const parsedLocale = useRef(locale);
  useEffect(() => {
    if (parsedLocale.current === locale) return;
    parsedLocale.current = locale;
    reparseNotes(store, locale);
  }, [locale, store]);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
