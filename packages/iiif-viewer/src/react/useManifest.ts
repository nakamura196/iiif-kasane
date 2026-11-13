'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
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
  shownManifestUrlAtom,
} from './atoms';
import { useLocale } from './env';

/**
 * Put a manifest (or Collection) into the current jotai store as the shown one: the manifest, its URL,
 * its annotations, the painted 3D models, and reset model choices and layer settings.
 * The only place that does this: the first load and the moves inside a Collection both use it,
 * so the parts that read the source manifest again always get the URL of what is shown.
 */
export function useShowManifest(): (url: string, manifest: ManifestV4) => void {
  const locale = useLocale();
  const setShownUrl = useSetAtom(shownManifestUrlAtom);
  const setManifest = useSetAtom(manifestAtom);
  const setAnnotations = useSetAtom(annotationsAtom);
  const setPaintedModels = useSetAtom(paintedModelsAtom);
  const setModelChoices = useSetAtom(modelChoicesAtom);
  const setLayerSettings = useSetAtom(layerSettingsAtom);
  const setLayerOrder = useSetAtom(layerOrderAtom);
  const setLayerPlayback = useSetAtom(layerPlaybackAtom);
  return useCallback(
    (url: string, manifest: ManifestV4) => {
      const { annotations } = parseManifestV4(manifest, undefined, locale);
      setPaintedModels(paintedModelsOf(firstSceneOf(manifest)));
      setModelChoices({});
      setLayerSettings({});
      setLayerOrder({});
      setLayerPlayback(null);
      setShownUrl(url);
      setManifest(manifest);
      setAnnotations(annotations);
    },
    [locale, setShownUrl, setManifest, setAnnotations, setPaintedModels, setModelChoices, setLayerSettings, setLayerOrder, setLayerPlayback],
  );
}

/** Read a manifest (or Collection) from its URL. null when it cannot be read or converted. */
export async function readManifest(url: string): Promise<ManifestV4 | null> {
  const raw = await fetchManifest(url);
  if (!raw) return null;
  try {
    return convertToV4(raw);
  } catch (e) {
    console.error('Error reading manifest:', e);
    return null;
  }
}

/** Load the manifest given to the viewer (iiif-content) into the current jotai store. */
export function useManifest(iiifContent: string | null): { failed: boolean } {
  // the url that could not be read; compared with the current one so that no state is reset in the effect
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const setManifestUrl = useSetAtom(manifestUrlAtom);
  const show = useShowManifest();

  useEffect(() => {
    if (!iiifContent) return;
    setManifestUrl(iiifContent);
    let cancelled = false;
    readManifest(iiifContent).then((manifest) => {
      if (cancelled) return;
      if (manifest) show(iiifContent, manifest);
      else setFailedUrl(iiifContent);
    });
    return () => {
      cancelled = true;
    };
  }, [iiifContent, setManifestUrl, show]);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
