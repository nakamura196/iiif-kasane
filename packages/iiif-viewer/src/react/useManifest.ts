'use client';

import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import {
  convertToV4,
  fetchManifest,
  firstSceneOf,
  paintedModelsOf,
  parseManifestV4,
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
} from './atoms';
import { useLocale } from './env';

/**
 * Load a manifest into the current jotai store: the manifest, its annotations,
 * the painted 3D models and a reset model choice.
 */
export function useManifest(iiifContent: string | null): { failed: boolean } {
  // the url that could not be read; compared with the current one so that no state is reset in the effect
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const locale = useLocale();
  const setManifestUrl = useSetAtom(manifestUrlAtom);
  const setManifest = useSetAtom(manifestAtom);
  const setAnnotations = useSetAtom(annotationsAtom);
  const setPaintedModels = useSetAtom(paintedModelsAtom);
  const setModelChoices = useSetAtom(modelChoicesAtom);
  const setLayerSettings = useSetAtom(layerSettingsAtom);
  const setLayerOrder = useSetAtom(layerOrderAtom);
  const setLayerPlayback = useSetAtom(layerPlaybackAtom);

  useEffect(() => {
    if (!iiifContent) return;
    setManifestUrl(iiifContent);
    let cancelled = false;
    fetchManifest(iiifContent).then((raw) => {
      if (cancelled) return;
      if (!raw) {
        setFailedUrl(iiifContent);
        return;
      }
      try {
        const manifest = convertToV4(raw);
        const { annotations } = parseManifestV4(manifest, undefined, locale);
        setPaintedModels(paintedModelsOf(firstSceneOf(manifest)));
        setModelChoices({});
        setLayerSettings({});
        setLayerOrder({});
        setLayerPlayback(null);
        setManifest(manifest);
        setAnnotations(annotations);
      } catch (e) {
        console.error('Error reading manifest:', e);
        setFailedUrl(iiifContent);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [iiifContent, setManifestUrl, setManifest, setAnnotations, setPaintedModels, setModelChoices, setLayerSettings, setLayerOrder, setLayerPlayback, locale]);

  return { failed: iiifContent !== null && failedUrl === iiifContent };
}
