import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Environment } from '@react-three/drei';
import { Suspense, useEffect, useState, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import Scene, { type PlacedModel, type ViewHandle } from '../three/Scene';
import ModelErrorBoundary from './ModelErrorBoundary';
import { useAtom, useAtomValue } from 'jotai';
import { manifestAtom, measuringAtom, modelAnimationAtom, modelRadiusAtom, sceneIdAtom } from '../atoms';
import { sceneCamerasOf, sceneSpatialScaleOf } from '../../core';
import { nextZoomDistance, zoomLimitsFor } from '../../core';
import { labelIn } from '../../core';
import { useProgress } from '@react-three/drei';
import { useTheme } from '../env';
import { useLocale, useTranslations } from '../env';
import * as THREE from 'three';
import { Spinner } from '../layout/Loading';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';

// MapLibre風のイージング関数
const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};
// ローディングコンポーネント
const LoadingScreen = ({ loadingText }: { loadingText: string }) => {
  const { progress, total, loaded } = useProgress();

  return (
    <Html center>
      <div className="flex flex-col items-center gap-3 rounded-lg bg-[var(--ds-surface)]/80 px-6 py-5 backdrop-blur-sm" role="status">
        <Spinner />
        <div className="text-sm text-[var(--ds-fg)]">{loadingText}</div>
        <div className="w-48 bg-[var(--ds-border)] rounded-full h-1.5">
          <div
            className="bg-[var(--ds-primary)] h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <div className="text-xs text-[var(--ds-fg-muted)]">
          {Math.round(progress)}% ({(loaded / 1024 / 1024).toFixed(2)}MB /{' '}
          {(total / 1024 / 1024).toFixed(2)}MB)
        </div>
      </div>
    </Html>
  );
};

// カメラズーム制御用のコンポーネント（MapLibre風スムーズズーム）
interface CameraControllerProps {
  controlsRef: React.RefObject<OrbitControlsType | null>;
}

interface ZoomAnimation {
  startTime: number;
  duration: number;
  startDistance: number;
  targetDistance: number;
}

const ZOOM_DURATION = 300; // ミリ秒
const ZOOM_FACTOR = 0.3; // ズーム量（割合）

const CameraController = forwardRef<{ zoomIn: () => void; zoomOut: () => void }, CameraControllerProps>(
  ({ controlsRef }, ref) => {
    const { camera } = useThree();
    const zoomAnimationRef = useRef<ZoomAnimation | null>(null);
    const targetRef = useRef(new THREE.Vector3(0, 0, 0));
    const modelRadius = useAtomValue(modelRadiusAtom);

    // アニメーションフレーム処理
    useFrame(() => {
      if (!zoomAnimationRef.current || !controlsRef.current) return;

      const { startTime, duration, startDistance, targetDistance } = zoomAnimationRef.current;
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      // OrbitControlsのターゲットを取得
      const target = controlsRef.current.target;
      targetRef.current.copy(target);

      // カメラからターゲットへの方向ベクトル
      const direction = new THREE.Vector3();
      direction.subVectors(camera.position, targetRef.current).normalize();

      // 現在の距離を補間
      const currentDistance = startDistance + (targetDistance - startDistance) * easedProgress;

      // カメラ位置を更新
      camera.position.copy(targetRef.current).addScaledVector(direction, currentDistance);
      controlsRef.current.update();

      // アニメーション完了
      if (progress >= 1) {
        zoomAnimationRef.current = null;
      }
    });

    const startZoomAnimation = useCallback((zoomIn: boolean) => {
      if (!controlsRef.current) return;

      const target = controlsRef.current.target;
      const currentDistance = camera.position.distanceTo(target);

      // 模型の大きさに合わせた距離の制限（単位が mm でも m でも効くように）
      const targetDistance = nextZoomDistance(currentDistance, zoomIn, ZOOM_FACTOR, zoomLimitsFor(modelRadius ?? 1));

      zoomAnimationRef.current = {
        startTime: performance.now(),
        duration: ZOOM_DURATION,
        startDistance: currentDistance,
        targetDistance,
      };
    }, [camera, controlsRef, modelRadius]);

    useImperativeHandle(ref, () => ({
      zoomIn: () => startZoomAnimation(true),
      zoomOut: () => startZoomAnimation(false),
    }), [startZoomAnimation]);

    return null;
  }
);
CameraController.displayName = 'CameraController';

const VIEW_BUTTON = 'min-h-[29px] px-2 text-xs transition-colors';
const VIEW_BUTTON_IDLE =
  'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';

interface CanvasComponentProps {
  glbUrl: string;
  // other models painted into the Scene, drawn alongside the main one
  extraModels?: PlacedModel[];
  attribution?: string;
}

const CanvasComponent = ({ glbUrl, extraModels, attribution }: CanvasComponentProps) => {
  const { resolvedTheme } = useTheme();
  const t = useTranslations('Viewer');
  const [mounted, setMounted] = useState(false);
  const [sceneRef, setSceneRef] = useState<THREE.Scene | null>(null);
  const controlsRef = useRef<OrbitControlsType>(null);
  const cameraControllerRef = useRef<{ zoomIn: () => void; zoomOut: () => void }>(null);
  const viewRef = useRef<ViewHandle>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [manifest] = useAtom(manifestAtom);
  const sceneId = useAtomValue(sceneIdAtom);
  const [animation, setAnimation] = useAtom(modelAnimationAtom);
  const locale = useLocale();
  // 実寸（spatialScale）が分かる Scene だけ「測る」ボタンを出す
  const canMeasure = useMemo(() => !!sceneSpatialScaleOf(manifest, sceneId), [manifest, sceneId]);
  const [measuring, setMeasuring] = useAtom(measuringAtom);
  // 別の Scene に移ったら、測るを切る（点も消える）
  useEffect(() => {
    if (!canMeasure) setMeasuring(false);
  }, [canMeasure, setMeasuring]);
  useEffect(() => () => setMeasuring(false), [setMeasuring]);
  // one button per Camera painted into the Scene (hidden ones belong to notes)
  const cameras = useMemo(() => sceneCamerasOf(manifest, sceneId), [manifest, sceneId]);
  // the main model could not be loaded: say so over the (empty) 3D view
  const [loadError, setLoadError] = useState<{ url: string; message: string } | null>(null);
  const failedUrl = loadError?.url === glbUrl ? loadError : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (sceneRef && mounted) {
      const isDark = resolvedTheme === 'dark';
      sceneRef.background = isDark ? new THREE.Color(0x111827) : new THREE.Color(0xf3f4f6);
    }
  }, [resolvedTheme, sceneRef, mounted]);

  const isDark = mounted && resolvedTheme === 'dark';

  const handleZoomIn = () => {
    cameraControllerRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    cameraControllerRef.current?.zoomOut();
  };

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{
          position: [0, 2, 5],
          fov: 50,
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
        gl={{
          antialias: true,
          // Voyager並みの質感に：物理ベースのフィルミックなトーンマッピング
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
        onCreated={({ scene }) => {
          setSceneRef(scene);
          // Set initial background color based on theme
          scene.background = isDark ? new THREE.Color(0x111827) : new THREE.Color(0xf3f4f6);
        }}
      >
        <Suspense fallback={<LoadingScreen loadingText={t('loading')} />}>
          <ModelErrorBoundary
            key={glbUrl}
            onError={(e) => setLoadError({ url: glbUrl, message: e.message })}
          >
            <Scene glbUrl={glbUrl} extraModels={extraModels} viewRef={viewRef} />
          </ModelErrorBoundary>
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping={true}
            dampingFactor={0.1}
            rotateSpeed={0.5}
            zoomSpeed={0.8}
            panSpeed={0.5}
            minPolarAngle={0}
            maxPolarAngle={Math.PI}
            autoRotate={autoRotate}
          />
          <CameraController ref={cameraControllerRef} controlsRef={controlsRef} />
          <gridHelper args={[10, 10, isDark ? 0x374151 : 0x9ca3af, isDark ? 0x1f2937 : 0xe5e7eb]} />
          {/* IBL(環境マップ)で PBR マテリアルに反射・陰影を与える＝Voyagerに近い質感の主因。
              背景は差し替えず(テーマ色を維持)、ライティングのみ利用。 */}
          <Environment preset="city" background={false} environmentIntensity={isDark ? 0.6 : 1} />
          {/* フラットな環境光は最小限に(IBLと二重に効くと白飛びするため)、
              directional は陰影の方向づけ用のキーライトとして残す。 */}
          <ambientLight intensity={isDark ? 0.15 : 0.25} />
          <directionalLight position={[10, 10, 5]} intensity={isDark ? 0.5 : 0.7} />
        </Suspense>
      </Canvas>
      {failedUrl && (
        <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center p-4 pointer-events-none">
          <div className="max-w-md bg-white/90 dark:bg-gray-800/90 p-4 rounded-lg shadow text-center pointer-events-auto">
            <p className="font-medium text-gray-800 dark:text-gray-200">{t('modelError')}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">{failedUrl.message}</p>
          </div>
        </div>
      )}
      {/* ズームボタン（MapLibre GL風） */}
      <div className="absolute top-4 right-4 z-10 flex flex-col rounded overflow-hidden shadow">
        <button
          onClick={handleZoomIn}
          className="w-[29px] h-[29px] bg-white dark:bg-gray-800 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-200 dark:border-gray-600"
          aria-label="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="w-[29px] h-[29px] bg-white dark:bg-gray-800 flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
          </svg>
        </button>
      </div>
      {/* 視点ボタン: ズームの下に、汎用の 3 つと、マニフェストのカメラごとに 1 つ */}
      <div className="absolute top-[78px] right-4 z-10 flex flex-col items-end gap-2 max-w-[min(14rem,calc(100%-2rem))]">
        <div className="flex flex-col rounded overflow-hidden shadow">
          <button
            onClick={() => setAutoRotate((v) => !v)}
            aria-pressed={autoRotate}
            className={`${VIEW_BUTTON} border-b border-gray-200 dark:border-gray-600 ${
              autoRotate ? 'bg-blue-600 text-white hover:bg-blue-700' : VIEW_BUTTON_IDLE
            }`}
          >
            {t('autoRotate')}
          </button>
          <button
            onClick={() => viewRef.current?.fit()}
            className={`${VIEW_BUTTON} ${VIEW_BUTTON_IDLE} border-b border-gray-200 dark:border-gray-600`}
          >
            {t('fitAll')}
          </button>
          <button
            onClick={() => viewRef.current?.top()}
            className={`${VIEW_BUTTON} ${VIEW_BUTTON_IDLE} ${canMeasure ? 'border-b border-gray-200 dark:border-gray-600' : ''}`}
          >
            {t('topView')}
          </button>
          {canMeasure && (
            <button
              onClick={() => setMeasuring((v) => !v)}
              aria-pressed={measuring}
              title={t('measureHint')}
              className={`${VIEW_BUTTON} ${
                measuring ? 'bg-blue-600 text-white hover:bg-blue-700' : VIEW_BUTTON_IDLE
              }`}
            >
              {t('measure')}
            </button>
          )}
        </div>
        {animation.clips > 0 && (
          <div className="flex flex-col rounded overflow-hidden shadow">
            <button
              onClick={() => setAnimation((a) => ({ ...a, playing: !a.playing }))}
              aria-pressed={animation.playing}
              className={`${VIEW_BUTTON} ${
                animation.playing ? 'bg-blue-600 text-white hover:bg-blue-700' : VIEW_BUTTON_IDLE
              }`}
            >
              {animation.playing ? t('pauseAnimation') : t('playAnimation')}
            </button>
          </div>
        )}
        {cameras.length > 0 && (
          <div role="group" aria-label={t('cameras')} className="flex flex-col rounded overflow-hidden shadow">
            {cameras.map((cam, i) => (
              <button
                key={cam.id}
                onClick={() => viewRef.current?.goTo(cam)}
                className={`${VIEW_BUTTON} ${VIEW_BUTTON_IDLE} text-right truncate ${
                  i < cameras.length - 1 ? 'border-b border-gray-200 dark:border-gray-600' : ''
                }`}
              >
                {labelIn(cam.label, locale) || `${t('camera')} ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Attribution（MapLibre GL風） */}
      {attribution && (
        <div className="absolute bottom-3 right-3 z-10 bg-white/90 dark:bg-gray-800/90 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 rounded shadow-sm font-medium">
          {attribution}
        </div>
      )}
    </div>
  );
};

export default CanvasComponent;
