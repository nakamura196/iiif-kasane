'use client';

import { Component, Suspense, type ReactNode } from 'react';
import { Environment, Lightformer } from '@react-three/drei';
import { useSceneEnvironment } from '../env';

/**
 * Image-based lighting (the environment map that gives PBR materials their reflections).
 *
 * - `"built-in"` (default): a small studio-like environment drawn inside the viewer. No network request.
 * - `"none"`: no environment map. Only plain lights, a little brighter to make up for it.
 * - one of drei's preset names (`"city"`, `"studio"`, ...): fetched from drei's asset CDN
 *   (raw.githack.com). Opt-in, because pages with a strict Content-Security-Policy block it.
 * - any other string: the URL of an `.hdr` / `.exr` file, e.g. one hosted next to the page.
 *
 * If a preset or file fails to load, the scene falls back to `"none"` instead of failing.
 */
export type SceneEnvironmentOption =
  | 'built-in'
  | 'none'
  | 'apartment'
  | 'city'
  | 'dawn'
  | 'forest'
  | 'lobby'
  | 'night'
  | 'park'
  | 'studio'
  | 'sunset'
  | 'warehouse'
  | (string & {});

const PRESETS = new Set(['apartment', 'city', 'dawn', 'forest', 'lobby', 'night', 'park', 'studio', 'sunset', 'warehouse']);

export type SceneEnvironmentKind =
  | { kind: 'built-in' }
  | { kind: 'none' }
  | { kind: 'preset'; preset: string }
  | { kind: 'file'; url: string };

/** How an option value is read. Unknown words that are not URLs fall back to the default. */
export function resolveSceneEnvironment(option: string | undefined | null): SceneEnvironmentKind {
  const value = option?.trim();
  if (!value || value === 'built-in') return { kind: 'built-in' };
  if (value === 'none') return { kind: 'none' };
  if (PRESETS.has(value)) return { kind: 'preset', preset: value };
  if (/^(https?:|blob:|data:|\/|\.\.?\/)/.test(value) || /\.(hdr|exr)(\?|#|$)/i.test(value)) {
    return { kind: 'file', url: value };
  }
  return { kind: 'built-in' };
}

// Keeps a preset or file that cannot be loaded (blocked by CSP, 404) from taking the canvas down.
class EnvironmentBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[iiif-viewer] could not load the environment map, lighting without it:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PlainLightBoost({ isDark }: { isDark: boolean }) {
  return <hemisphereLight args={[0xffffff, 0x444444, isDark ? 0.6 : 0.9]} />;
}

// A few soft panels around the model, rendered once into a small cube map.
function BuiltInEnvironment({ intensity }: { intensity: number }) {
  return (
    <Environment resolution={256} background={false} environmentIntensity={intensity} frames={1}>
      <Lightformer form="rect" intensity={2} position={[0, 5, -9]} scale={[10, 10, 1]} />
      <Lightformer form="rect" intensity={1.5} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
      <Lightformer form="rect" intensity={1.5} position={[5, 1, -1]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
      <Lightformer form="rect" intensity={1} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
      <Lightformer form="ring" intensity={3} position={[2, 4, 4]} scale={2} />
    </Environment>
  );
}

export default function SceneEnvironment({
  isDark,
  environment,
}: {
  isDark: boolean;
  /** Overrides the value given to the viewer (`environment` prop / `options.environment`). */
  environment?: SceneEnvironmentOption;
}) {
  const fromViewer = useSceneEnvironment();
  const resolved = resolveSceneEnvironment(environment ?? fromViewer);
  const intensity = isDark ? 0.6 : 1;
  const plain = <PlainLightBoost isDark={isDark} />;

  switch (resolved.kind) {
    case 'none':
      return plain;
    case 'built-in':
      return <BuiltInEnvironment intensity={intensity} />;
    case 'preset':
    case 'file':
      return (
        <EnvironmentBoundary fallback={plain}>
          <Suspense fallback={null}>
            {resolved.kind === 'preset' ? (
              <Environment
                preset={resolved.preset as 'city'}
                background={false}
                environmentIntensity={intensity}
              />
            ) : (
              <Environment files={resolved.url} background={false} environmentIntensity={intensity} />
            )}
          </Suspense>
        </EnvironmentBoundary>
      );
  }
}
