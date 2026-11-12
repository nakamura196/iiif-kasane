'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';
import {
  CompareChip,
  CompareHint,
  LensRing,
  SwipeHandle,
  compareClipOf,
  lensRingPositionOf,
  pointInBox,
  type CompareMode,
  type SwipeDirection,
} from 'iiif-kasane';
import { Scene, SceneEnvironment, type PlacedModel, type ViewHandle } from 'iiif-kasane/scene';

// Two models of one Scene, seen through one camera. Each side has its own canvas;
// whichever the user is moving leads, and the other copies its camera every frame.
// The modes are those of map layer comparison: side by side, a swipe line, and a
// spyglass (a round window showing the other model under the pointer). The line, the
// window and the labels are shared with the image comparison (CompareParts).
/** The modes of the 3D comparison (overlay is for images only). */
export type CompareMode3D = Exclude<CompareMode, 'overlay'>;

interface SharedCamera {
  leader: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  near: number;
  far: number;
  ready: boolean;
}

function CameraSync({ index, shared }: { index: number; shared: MutableRefObject<SharedCamera> }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    const c = controls as unknown as OrbitControlsType | null;
    if (!c) return;
    const lead = () => {
      shared.current.leader = index;
    };
    c.addEventListener('start', lead);
    return () => c.removeEventListener('start', lead);
  }, [controls, index, shared]);

  // runs after OrbitControls' own update, so the copied camera is what gets drawn
  useFrame(() => {
    const c = controls as unknown as OrbitControlsType | null;
    if (!c || !(camera instanceof THREE.PerspectiveCamera)) return;
    const s = shared.current;
    if (s.leader === index) {
      s.position.copy(camera.position);
      s.target.copy(c.target);
      s.fov = camera.fov;
      s.near = camera.near;
      s.far = camera.far;
      s.ready = true;
    } else if (s.ready) {
      camera.position.copy(s.position);
      c.target.copy(s.target);
      camera.lookAt(s.target);
      if (camera.fov !== s.fov || camera.near !== s.near || camera.far !== s.far) {
        camera.fov = s.fov;
        camera.near = s.near;
        camera.far = s.far;
        camera.updateProjectionMatrix();
      }
    }
  });
  return null;
}

function Pane({
  index,
  url,
  extraModels,
  shared,
  viewRef,
}: {
  index: number;
  url: string | null;
  extraModels: PlacedModel[];
  shared: MutableRefObject<SharedCamera>;
  viewRef?: MutableRefObject<ViewHandle | null>;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <Canvas
      camera={{ position: [0, 2, 5], fov: 50 }}
      style={{ position: 'absolute', inset: 0 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1 }}
      scene={{ background: new THREE.Color(isDark ? 0x111827 : 0xf3f4f6) }}
    >
      <Suspense fallback={null}>
        {url && <Scene glbUrl={url} extraModels={extraModels} viewRef={viewRef} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} rotateSpeed={0.5} zoomSpeed={0.8} panSpeed={0.5} />
        <CameraSync index={index} shared={shared} />
        <SceneEnvironment isDark={isDark} />
        <ambientLight intensity={isDark ? 0.15 : 0.25} />
        <directionalLight position={[10, 10, 5]} intensity={isDark ? 0.5 : 0.7} />
      </Suspense>
    </Canvas>
  );
}

export default function CompareView({
  mode,
  urls,
  labels,
  extraModels,
  swipeDirection = 'horizontal',
}: {
  mode: CompareMode3D;
  urls: [string | null, string | null];
  labels: [string, string];
  extraModels: PlacedModel[];
  swipeDirection?: SwipeDirection;
}) {
  const t = useTranslations('Compare');
  const shared = useRef<SharedCamera>({
    leader: 0,
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: 50,
    near: 0.1,
    far: 1000,
    ready: false,
  });
  const viewRef = useRef<ViewHandle | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const split = useRef(50); // swipe line, % from the left (from the top when vertical)
  const lens = useRef<{ x: number; y: number } | null>(null);

  // The second pane's clip is set on the element directly: the pointer moves it
  // many times a second, and the canvases should not re-render for that.
  const applyClip = useCallback(() => {
    const top = topRef.current;
    if (!top) return;
    const box = boxRef.current;
    const p = lens.current ?? (box ? { x: box.clientWidth / 2, y: box.clientHeight / 2 } : { x: 0, y: 0 });
    top.style.clipPath = compareClipOf(mode, split.current, p, swipeDirection);
    if (mode === 'swipe' && lineRef.current) {
      if (swipeDirection === 'vertical') lineRef.current.style.top = `${split.current}%`;
      else lineRef.current.style.left = `${split.current}%`;
    }
    if (mode === 'spyglass' && ringRef.current) Object.assign(ringRef.current.style, lensRingPositionOf(p));
  }, [mode, swipeDirection]);

  useEffect(applyClip, [applyClip]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== 'spyglass' || !boxRef.current) return;
    lens.current = pointInBox(boxRef.current, e);
    applyClip();
  };

  const side = mode === 'side';
  // the view buttons fly the first pane's camera; the second follows it
  const fly = (f: (v: ViewHandle) => void) => {
    shared.current.leader = 0;
    if (viewRef.current) f(viewRef.current);
  };

  return (
    <div
      ref={boxRef}
      onPointerMove={onPointerMove}
      className={`relative w-full h-full overflow-hidden bg-gray-100 dark:bg-gray-900 ${side ? 'flex flex-col sm:flex-row gap-px bg-[var(--ds-border)]' : ''}`}
    >
      <div className={side ? 'relative flex-1 min-w-0 min-h-0' : 'absolute inset-0'}>
        <Pane index={0} url={urls[0]} extraModels={extraModels} shared={shared} viewRef={viewRef} />
        <CompareChip className="left-3">A: {labels[0]}</CompareChip>
      </div>
      <div ref={topRef} className={side ? 'relative flex-1 min-w-0 min-h-0' : 'absolute inset-0'}>
        <Pane index={1} url={urls[1]} extraModels={extraModels} shared={shared} />
        {side && <CompareChip className="left-3">B: {labels[1]}</CompareChip>}
      </div>
      {/* outside the clipped pane, so that the label stays visible */}
      {!side && (
        <CompareChip className={mode === 'swipe' && swipeDirection === 'vertical' ? 'left-3' : 'right-3'} bottom={mode === 'swipe' && swipeDirection === 'vertical'}>
          B: {labels[1]}
        </CompareChip>
      )}
      {mode === 'spyglass' && <LensRing ringRef={ringRef} />}
      {mode === 'swipe' && (
        <SwipeHandle
          boxRef={boxRef}
          handleRef={lineRef}
          split={split.current}
          label={t('swipeHandle')}
          direction={swipeDirection}
          onSplit={(v) => {
            split.current = v;
            applyClip();
          }}
        />
      )}
      {mode === 'spyglass' && <CompareHint>{t('spyglassHint')}</CompareHint>}
      <div className="absolute top-12 right-3 z-20 flex flex-col rounded overflow-hidden shadow">
        <button
          onClick={() => fly((v) => v.fit())}
          className="min-h-[29px] px-2 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600"
        >
          {t('fitAll')}
        </button>
        <button
          onClick={() => fly((v) => v.top())}
          className="min-h-[29px] px-2 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {t('topView')}
        </button>
      </div>
    </div>
  );
}
