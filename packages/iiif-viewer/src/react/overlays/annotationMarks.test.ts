import { describe, expect, it } from 'vitest';
import type { StageInfo } from '../displays/ImageView';
import { overlaps, pixelsPerUnit, visibleBoxOf } from './annotationMarks';

// A 2000 x 1000 Canvas fitted into a 1000 x 500 box: the stage is the box, half a Canvas unit per pixel.
const stage = (scale: number, tx = 0, ty = 0): StageInfo => ({
  scale,
  tx,
  ty,
  stageW: 1000,
  stageH: 500,
  boxW: 1000,
  boxH: 500,
});

describe('visibleBoxOf', () => {
  it('is the whole Canvas when nothing is zoomed', () => {
    expect(visibleBoxOf(stage(1), 2000, 1000)).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
  });

  it('is the whole Canvas without a stage', () => {
    expect(visibleBoxOf(undefined, 2000, 1000)).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
  });

  it('is the middle quarter at twice the size', () => {
    expect(visibleBoxOf(stage(2), 2000, 1000)).toEqual({ x: 500, y: 250, w: 1000, h: 500 });
  });

  it('follows a move (the stage moved right shows the left of the Canvas)', () => {
    expect(visibleBoxOf(stage(2, 500, 0), 2000, 1000)).toEqual({ x: 0, y: 250, w: 1000, h: 500 });
  });

  it('is clamped to the Canvas when zoomed out', () => {
    expect(visibleBoxOf(stage(0.5), 2000, 1000)).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
  });

  it('is the bounds of the turned screen on a turned stage', () => {
    // turned a quarter: the 1000 x 500 box covers 500 x 1000 stage pixels, clamped to the 1000 x 500 stage
    expect(visibleBoxOf({ ...stage(2), rotation: 90 }, 2000, 1000)).toEqual({ x: 750, y: 0, w: 500, h: 1000 });
  });

  it('grows by the margin', () => {
    expect(visibleBoxOf(stage(4), 2000, 1000, 0.5)).toEqual({ x: 625, y: 312.5, w: 750, h: 375 });
  });
});

describe('pixelsPerUnit', () => {
  it('is the fit times the zoom', () => {
    expect(pixelsPerUnit(stage(3), 2000)).toBe(1.5);
  });
});

describe('overlaps', () => {
  it('counts a point on the box', () => {
    expect(overlaps({ x: 10, y: 10, w: 0, h: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(overlaps({ x: 11, y: 10, w: 0, h: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('annotationNumbers', () => {
  it('numbers annotations from 1 in list order', async () => {
    const { annotationNumbers } = await import('./annotationMarks');
    const m = annotationNumbers([{ id: 'a' }, { id: 'b' }]);
    expect(m?.get('a')).toBe(1);
    expect(m?.get('b')).toBe(2);
  });
  it('gives no numbers when there are too many', async () => {
    const { annotationNumbers, NUMBER_LIMIT } = await import('./annotationMarks');
    expect(annotationNumbers(Array.from({ length: NUMBER_LIMIT + 1 }, (_, i) => ({ id: String(i) })))).toBeNull();
  });
});
