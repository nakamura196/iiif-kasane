// measure3d: 3D の 2 点間の距離を測る道具の、React に依存しない部分。
//
// Scene が spatialScale（Presentation 4.0 の UnitValue。シーンの 1 単位が実物でいくつか）を
// 持つときだけ、3D の画面に「測る」ボタンが出る。ここでは scale の読み取りと、長さの整形を行う。
// 画面への描画とクリックの拾い方は react/three/MeasureTool.tsx にある。
import type { ManifestV4 } from '../types/iiif';
import { sceneOf } from '../services/containers';

export interface SpatialScale {
  /** Real-world length of one scene unit. */
  value: number;
  /** The unit string as written in the manifest ("m", "cm", ...). */
  unit: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The spatialScale of a Scene (a UnitValue), or undefined when it is missing or unusable. */
export const spatialScaleOf = (scene: unknown): SpatialScale | undefined => {
  if (!isObj(scene)) return undefined;
  const raw = Array.isArray(scene.spatialScale) ? scene.spatialScale[0] : scene.spatialScale;
  if (!isObj(raw)) return undefined;
  const value = Number(raw.quantityValue);
  const unit = typeof raw.unit === 'string' ? raw.unit.trim() : '';
  if (!Number.isFinite(value) || value <= 0 || !unit) return undefined;
  return { value, unit };
};

/** The spatialScale of the Scene `sceneId` (default: the first Scene). */
export const sceneSpatialScaleOf = (
  manifest: ManifestV4 | null | undefined,
  sceneId?: string | null,
): SpatialScale | undefined => spatialScaleOf(sceneOf(manifest, sceneId));

/** Distance between two points, in scene units. */
export const distanceBetween = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** "123.4 m": a length in scene units, converted with the scale, one decimal. */
export const formatLength = (sceneUnits: number, scale: SpatialScale): string =>
  `${(sceneUnits * scale.value).toFixed(1)} ${scale.unit}`;
