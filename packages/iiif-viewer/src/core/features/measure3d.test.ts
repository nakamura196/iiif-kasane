import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { distanceBetween, formatLength, sceneSpatialScaleOf, spatialScaleOf } from './measure3d';

const unit = (quantityValue: unknown, u: unknown = 'm') => ({ type: 'UnitValue', quantityValue, unit: u });

describe('spatialScaleOf', () => {
  it('reads a UnitValue', () => {
    expect(spatialScaleOf({ type: 'Scene', spatialScale: unit(1.0, 'm') })).toEqual({ value: 1, unit: 'm' });
    expect(spatialScaleOf({ spatialScale: unit('0.5', 'cm') })).toEqual({ value: 0.5, unit: 'cm' });
  });
  it('takes the first of a list', () => {
    expect(spatialScaleOf({ spatialScale: [unit(2, 'mm'), unit(9, 'm')] })).toEqual({ value: 2, unit: 'mm' });
  });
  it('returns undefined when missing or unusable', () => {
    expect(spatialScaleOf({ type: 'Scene' })).toBeUndefined();
    expect(spatialScaleOf(undefined)).toBeUndefined();
    expect(spatialScaleOf({ spatialScale: unit(0) })).toBeUndefined();
    expect(spatialScaleOf({ spatialScale: unit(-1) })).toBeUndefined();
    expect(spatialScaleOf({ spatialScale: unit('x') })).toBeUndefined();
    expect(spatialScaleOf({ spatialScale: unit(1, '') })).toBeUndefined();
    expect(spatialScaleOf({ spatialScale: 'm' })).toBeUndefined();
  });
});

describe('sceneSpatialScaleOf', () => {
  const manifest = {
    type: 'Manifest',
    items: [
      { id: 'https://example.org/s1', type: 'Scene', spatialScale: unit(1, 'm'), items: [] },
      { id: 'https://example.org/s2', type: 'Scene', items: [] },
    ],
  } as unknown as ManifestV4;
  it('reads the requested Scene', () => {
    expect(sceneSpatialScaleOf(manifest)).toEqual({ value: 1, unit: 'm' });
    expect(sceneSpatialScaleOf(manifest, 'https://example.org/s1')).toEqual({ value: 1, unit: 'm' });
    expect(sceneSpatialScaleOf(manifest, 'https://example.org/s2')).toBeUndefined();
  });
  it('has none without a manifest', () => {
    expect(sceneSpatialScaleOf(null)).toBeUndefined();
  });
});

describe('distanceBetween / formatLength', () => {
  it('measures in scene units', () => {
    expect(distanceBetween([0, 0, 0], [3, 4, 12])).toBe(13);
  });
  it('converts with the scale and keeps the unit string', () => {
    expect(formatLength(123.44, { value: 1, unit: 'm' })).toBe('123.4 m');
    expect(formatLength(10, { value: 0.25, unit: 'cm' })).toBe('2.5 cm');
    expect(formatLength(0, { value: 1, unit: 'm' })).toBe('0.0 m');
  });
});
