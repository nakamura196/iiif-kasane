'use client';

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useStore, type createStore } from 'jotai';
import { authorizedUrl, chosenOption, probeServiceOf } from '../../core';
import { tryPrepareShow, type PreparedShow } from '../useManifest';
import { annotationsAtom, paintedModelsAtom, sceneIdAtom, selectedAnnotationIdAtom, modelChoicesAtom } from '../atoms';
import { sceneDisplayAtom } from '../internalState';
import { useLocale, useTranslations } from '../env';
import AuthPrompt from '../auth/AuthPrompt';
import { useAuthStates } from '../auth/authStore';
import ModelChoice from '../three/ModelChoice';
import { StoryLayer } from '../overlays/StoryOverlay';
import type { StageInfo } from './ImageView';
import type { Display, DisplayProps } from './types';
import type { PlacedModel } from '../three/Scene';

// three.js and react-three-fiber are only fetched when a Scene is shown.
const CanvasComponent = lazy(() => import('../three/Canvas'));

const EMPTY: PreparedShow['paintedModels'] = [];

/** What the display of a Scene puts in the store: its Scene id, painted models and notes (a new Scene or locale clears the selection). */
export function writeSceneState(store: ReturnType<typeof createStore>, sceneId: string, read: PreparedShow | null): void {
  store.set(sceneIdAtom, sceneId);
  store.set(paintedModelsAtom, read?.paintedModels ?? []);
  store.set(annotationsAtom, read?.annotations ?? []);
  store.set(selectedAnnotationIdAtom, null);
}

function SceneDisplay({ container, manifest, iiifContent, shownUrl, renderActions, selectedIndex }: DisplayProps) {
  const t = useTranslations('Viewer');
  const locale = useLocale();
  const modelChoices = useAtomValue(modelChoicesAtom);
  const store = useStore();

  // The 3D display owns the notes, painted models and Scene id of the Scene it draws, read from its own manifest
  // (the one shown by the viewer, or one a host set in manifestAtom). The read is remembered per manifest, locale
  // and Scene, so the parse made before showing is reused. A Scene that cannot be parsed shows a notice.
  const sceneId = container.id;
  const read = useMemo(() => tryPrepareShow(manifest, locale, sceneId), [manifest, sceneId, locale]);
  const broken = read === null;
  useEffect(() => {
    writeSceneState(store, sceneId, read);
  }, [store, sceneId, read]);
  useEffect(() => {
    store.set(sceneDisplayAtom, { mounted: true, sceneId });
    return () => store.set(sceneDisplayAtom, (d) => ({ ...d, mounted: false }));
  }, [store, sceneId]);
  // the models come from this render's read, not from the atom: no frame draws the Scene left behind
  const paintedModels = read?.paintedModels ?? EMPTY;

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
        .flatMap((m, i): PlacedModel[] => {
          const url = urls[i + 1];
          return url ? [{ url, position: m.position, matrix: chosen[i + 1]?.matrix }] : [];
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urls is rebuilt each render; extraKey holds its content
    [paintedModels, extraKey],
  );
  const hasChoices = (paintedModels[0]?.options.length ?? 0) > 1;

  // The caption of a story step in this Scene (Presentation 4.0 storytelling), as over an image. It only
  // needs the size of the view: the 3D view does not move under it like a picture.
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<StageInfo | undefined>(undefined);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setStage({ scale: 1, tx: 0, ty: 0, stageW: width, stageH: height, boxW: width, boxH: height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="relative flex-1 min-h-0 min-w-0">
      {broken && (
        <div className="p-4 text-sm text-[var(--ds-fg)]" role="alert">
          {t('manifestError')}
        </div>
      )}
      {glbUrl && !broken && (
        <Suspense fallback={<div className="p-4 text-sm text-[var(--ds-fg)]">{t('loading')}</div>}>
          {/* a new 3D view per Scene, so that the camera starts again from that Scene's view */}
          <CanvasComponent key={sceneId} glbUrl={glbUrl} extraModels={extraModels} />
        </Suspense>
      )}
      {!broken && <AuthPrompt />}
      {!broken && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <StoryLayer container={container} canvasWidth={0} canvasHeight={0} stage={stage} />
        </div>
      )}
      <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
        {!broken && <ModelChoice />}
        {renderActions?.({ iiifContent, shownUrl, hasChoices, selectedIndex })}
      </div>
    </div>
  );
}

export const sceneDisplay: Display = {
  id: 'scene',
  match: (c) => c.kind === 'Scene',
  Component: SceneDisplay,
};
