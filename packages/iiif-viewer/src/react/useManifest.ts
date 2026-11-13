'use client';

import { useEffect, useRef, useState } from 'react';
import { atom, useStore, type createStore } from 'jotai';
import {
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
  shownManifestAtom,
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

/**
 * Put a manifest (or Collection) into the store as the shown one: the manifest, its URL and served JSON,
 * its annotations, the painted 3D models, and reset model choices and layer settings.
 * Loads still in flight are dropped (what is shown now is the latest request).
 * The only way a manifest is shown: the first load, the moves inside a Collection and going back all use it,
 * so the parts that need the served JSON always get the one of what is shown.
 */
export function showManifest(store: Store, url: string, source: ManifestSource, locale: string): void {
  const { manifest, raw } = source;
  beginLoad(store);
  const { annotations } = parseManifestV4(manifest, undefined, locale);
  store.set(paintedModelsAtom, paintedModelsOf(firstSceneOf(manifest)));
  store.set(modelChoicesAtom, {});
  store.set(layerSettingsAtom, {});
  store.set(layerOrderAtom, {});
  store.set(layerPlaybackAtom, null);
  store.set(shownManifestAtom, { url, raw, manifest, seq: (store.get(shownManifestAtom)?.seq ?? 0) + 1 });
  store.set(manifestAtom, manifest);
  store.set(annotationsAtom, annotations);
}

/**
 * Read the manifest at the URL and show it, unless a later load or show started meanwhile.
 * 'stale': a later request replaced this one (nothing was changed).
 */
export async function loadManifest(
  store: Store,
  url: string,
  locale: () => string,
  beforeShow?: (source: ManifestSource) => void,
): Promise<'shown' | 'failed' | 'stale'> {
  const isCurrent = beginLoad(store);
  const source = await readManifestSource(url);
  if (!isCurrent()) return 'stale';
  if (!source) return 'failed';
  beforeShow?.(source);
  showManifest(store, url, source, locale());
  return 'shown';
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
    store.set(manifestUrlAtom, iiifContent);
    let cancelled = false;
    void loadManifest(store, iiifContent, () => localeRef.current).then((result) => {
      if (!cancelled && result === 'failed') setFailedUrl(iiifContent);
    });
    return () => {
      cancelled = true;
      // a load (or a move inside a Collection) still in flight is for the old iiif-content
      beginLoad(store);
    };
  }, [iiifContent, store, localeRef]);

  // a new locale: the annotations' labels are read again from what is shown
  const parsedLocale = useRef(locale);
  useEffect(() => {
    if (parsedLocale.current === locale) return;
    parsedLocale.current = locale;
    const shown = store.get(shownManifestAtom);
    if (shown) store.set(annotationsAtom, parseManifestV4(shown.manifest, undefined, locale).annotations);
  }, [locale, store]);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
