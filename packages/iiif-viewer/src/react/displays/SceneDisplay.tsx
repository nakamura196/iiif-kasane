'use client';

import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { authorizedUrl, chosenOption, paintedModelsOf, parseManifestV4, probeServiceOf, sceneOf } from '../../core';
import {
  annotationsAtom,
  modelChoicesAtom,
  paintedModelsAtom,
  sceneIdAtom,
  selectedAnnotationIdAtom,
} from '../atoms';
import { useLocale, useTranslations } from '../env';
import AuthPrompt from '../auth/AuthPrompt';
import { useAuthStates } from '../auth/authStore';
import ModelChoice from '../three/ModelChoice';
import type { Display, DisplayProps } from './types';

// three.js and react-three-fiber are only fetched when a Scene is shown.
const CanvasComponent = lazy(() => import('../three/Canvas'));

function SceneDisplay({ container, manifest, iiifContent, renderActions, selectedIndex }: DisplayProps) {
  const t = useTranslations('Viewer');
  const locale = useLocale();
  const paintedModels = useAtomValue(paintedModelsAtom);
  const setPaintedModels = useSetAtom(paintedModelsAtom);
  const setAnnotations = useSetAtom(annotationsAtom);
  const setSceneId = useSetAtom(sceneIdAtom);
  const setSelectedAnnotation = useSetAtom(selectedAnnotationIdAtom);
  const modelChoices = useAtomValue(modelChoicesAtom);

  // The 3D display reads the Scene that is shown (not always the first one): its models,
  // its notes, and (through sceneIdAtom) its default Camera and Camera buttons.
  const sceneId = container.id;
  useEffect(() => {
    setSceneId(sceneId);
    setPaintedModels(paintedModelsOf(sceneOf(manifest, sceneId)));
    setAnnotations(parseManifestV4(manifest, sceneId, locale).annotations);
    setSelectedAnnotation(null);
  }, [manifest, sceneId, setSceneId, setPaintedModels, setAnnotations, setSelectedAnnotation, locale]);

  // The first painted model is the main one (framing, annotation occlusion);
  // the others are drawn alongside. A Choice shows its chosen (default: first) Model.
  // A Model behind IIIF Auth 2.0 (an AuthProbeService2 on the Model) is loaded only once the
  // probe lets the user in, from the probe's `location` when it gives one (e.g. a signed URL).
  const chosen = useMemo(() => paintedModels.map((m) => chosenOption(m, modelChoices)), [paintedModels, modelChoices]);
  const probes = useMemo(() => chosen.map((o) => probeServiceOf(o.body, locale)), [chosen, locale]);
  const authStates = useAuthStates(probes, locale);
  const urls = chosen.map((o, i) => authorizedUrl(o.url, authStates[i]));
  const glbUrl = urls[0] ?? null;
  const extraKey = urls.slice(1).join('\n');
  const extraModels = useMemo(
    () =>
      paintedModels
        .slice(1)
        .map((m, i) => ({ url: urls[i + 1], position: m.position }))
        .filter((m): m is { url: string; position: [number, number, number] } => !!m.url),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urls is rebuilt each render; extraKey holds its content
    [paintedModels, extraKey],
  );
  const hasChoices = (paintedModels[0]?.options.length ?? 0) > 1;

  return (
    <div className="relative flex-1 min-h-0 min-w-0">
      {glbUrl && (
        <Suspense fallback={<div className="p-4 text-sm text-[var(--ds-fg)]">{t('loading')}</div>}>
          {/* a new 3D view per Scene, so that the camera starts again from that Scene's view */}
          <CanvasComponent key={sceneId} glbUrl={glbUrl} extraModels={extraModels} />
        </Suspense>
      )}
      <AuthPrompt />
      <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
        <ModelChoice />
        {renderActions?.({ iiifContent, hasChoices, selectedIndex })}
      </div>
    </div>
  );
}

export const sceneDisplay: Display = {
  id: 'scene',
  match: (c) => c.kind === 'Scene',
  Component: SceneDisplay,
};
