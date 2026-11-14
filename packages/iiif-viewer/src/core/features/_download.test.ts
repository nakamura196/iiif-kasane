import { describe, expect, it } from 'vitest';
import {
  canCutRegion,
  downloadFileName,
  downloadSizesOf,
  extensionOf,
  isPlainLayer,
  limitedSize,
  visibleDownloadRegion,
} from './_download';
import type { ImageInfo, ImageServiceRef } from './image';

const v2: ImageServiceRef = { id: 'https://example.org/iiif/2/a', version: 2 };
const v3: ImageServiceRef = { id: 'https://example.org/iiif/3/a', version: 3 };
const info = (over: Partial<ImageInfo> = {}): ImageInfo => ({
  width: 4000,
  height: 3000,
  version: 2,
  level: 2,
  tiles: [],
  sizes: [],
  ...over,
});

describe('limitedSize', () => {
  it('leaves a size that fits', () => {
    expect(limitedSize(4000, 3000, {})).toEqual({ width: 4000, height: 3000 });
    expect(limitedSize(4000, 3000, { maxWidth: 4000, maxHeight: 3000, maxArea: 12_000_000 })).toEqual({ width: 4000, height: 3000 });
  });
  it('shrinks to maxWidth, maxHeight and maxArea, keeping the shape', () => {
    expect(limitedSize(4000, 3000, { maxWidth: 2000 })).toEqual({ width: 2000, height: 1500 });
    expect(limitedSize(4000, 3000, { maxHeight: 1500 })).toEqual({ width: 2000, height: 1500 });
    const a = limitedSize(4000, 3000, { maxArea: 1_000_000 });
    expect(a.width * a.height).toBeLessThanOrEqual(1_000_000);
    expect(a.width / a.height).toBeCloseTo(4 / 3, 1);
  });
});

describe('downloadSizesOf: sizes absent (level 2)', () => {
  it('computes a few sizes below the long side, then max (v2: full)', () => {
    const s = downloadSizesOf(v2, info(), 'full');
    expect(s.map((x) => x.width)).toEqual([256, 512, 1024, 2048, 4000]);
    expect(s[0]).toMatchObject({ width: 256, height: 192, url: 'https://example.org/iiif/2/a/full/256,/0/default.jpg' });
    expect(s.at(-1)).toMatchObject({ id: 'max', max: true, width: 4000, height: 3000, url: 'https://example.org/iiif/2/a/full/full/0/default.jpg' });
  });
  it('uses the max keyword in v3', () => {
    const s = downloadSizesOf(v3, info({ version: 3 }), 'full');
    expect(s.at(-1)?.url).toBe('https://example.org/iiif/3/a/full/max/0/default.jpg');
    expect(s[0].url).toBe('https://example.org/iiif/3/a/full/256,/0/default.jpg');
  });
  it('skips computed sizes at or above the image and offers max only for a small image', () => {
    const s = downloadSizesOf(v2, info({ width: 200, height: 100 }), 'full');
    expect(s.map((x) => x.id)).toEqual(['max']);
  });
  it('never offers more than maxWidth / maxHeight / maxArea', () => {
    const s = downloadSizesOf(v2, info({ maxWidth: 1500, maxHeight: 1500 }), 'full');
    expect(s.map((x) => x.width)).toEqual([256, 512, 1024, 1500]);
    expect(s.at(-1)?.url).toBe('https://example.org/iiif/2/a/full/1500,/0/default.jpg');
    expect(s.at(-1)?.height).toBe(1125);
    const area = downloadSizesOf(v3, info({ version: 3, maxArea: 1_000_000 }), 'full');
    for (const x of area) expect(x.width * x.height).toBeLessThanOrEqual(1_000_000);
    expect(area.at(-1)?.url).toContain('/max/');
  });
});

describe('downloadSizesOf: sizes listed', () => {
  const listed = info({ sizes: [{ width: 1000, height: 750 }, { width: 250, height: 188 }, { width: 4000, height: 3000 }] });
  it('offers the listed sizes in order, the full one as max', () => {
    const s = downloadSizesOf(v2, listed, 'full');
    expect(s.map((x) => `${x.width}x${x.height}`)).toEqual(['250x188', '1000x750', '4000x3000']);
    expect(s[1].url).toBe('https://example.org/iiif/2/a/full/1000,/0/default.jpg');
  });
  it('writes w,h in v3', () => {
    const s = downloadSizesOf(v3, { ...listed, version: 3 }, 'full');
    expect(s[0].url).toBe('https://example.org/iiif/3/a/full/250,188/0/default.jpg');
  });
});

describe('downloadSizesOf: level 0', () => {
  it('with sizes: only those and the whole image at full size', () => {
    const l0 = info({ level: 0, sizes: [{ width: 500, height: 375 }] });
    const s = downloadSizesOf(v2, l0, 'full');
    expect(s.map((x) => x.url)).toEqual([
      'https://example.org/iiif/2/a/full/500,/0/default.jpg',
      'https://example.org/iiif/2/a/full/full/0/default.jpg',
    ]);
  });
  it('static tiles without sizes: only the whole image, never `full/<w>,` (it answers 404)', () => {
    const tiles = info({ level: 0, tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4] }] });
    expect(downloadSizesOf(v2, tiles, 'full').map((x) => x.url)).toEqual(['https://example.org/iiif/2/a/full/full/0/default.jpg']);
    expect(downloadSizesOf(v3, { ...tiles, version: 3 }, 'full').map((x) => x.url)).toEqual(['https://example.org/iiif/3/a/full/max/0/default.jpg']);
  });
  it('offers no region', () => {
    expect(canCutRegion(info({ level: 0 }))).toBe(false);
    expect(downloadSizesOf(v2, info({ level: 0 }), { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });
});

describe('downloadSizesOf: region', () => {
  const region = { x: 100, y: 200, w: 3000, h: 1500 };
  it('sizes follow the region, not the image; URLs carry the region', () => {
    const s = downloadSizesOf(v2, info(), region);
    expect(s.map((x) => x.width)).toEqual([256, 512, 1024, 2048, 3000]);
    expect(s[0]).toMatchObject({ height: 128, url: 'https://example.org/iiif/2/a/100,200,3000,1500/256,/0/default.jpg' });
    expect(s.at(-1)?.url).toBe('https://example.org/iiif/2/a/100,200,3000,1500/full/0/default.jpg');
    expect(downloadSizesOf(v3, info({ version: 3 }), region).at(-1)?.url).toBe('https://example.org/iiif/3/a/100,200,3000,1500/max/0/default.jpg');
  });
  it('ignores the listed sizes (they are for the whole image)', () => {
    const s = downloadSizesOf(v2, info({ sizes: [{ width: 300, height: 225 }] }), region);
    expect(s.map((x) => x.width)).toContain(256);
    expect(s.map((x) => x.width)).not.toContain(300);
  });
  it('respects the limits for a region', () => {
    const s = downloadSizesOf(v2, info({ maxWidth: 1000, maxHeight: 1000 }), region);
    expect(s.at(-1)).toMatchObject({ width: 1000, height: 500, url: 'https://example.org/iiif/2/a/100,200,3000,1500/1000,/0/default.jpg' });
  });
});

describe('visibleDownloadRegion: Canvas to image coordinates', () => {
  const image = { width: 4000, height: 3000 };
  it('scales when the Canvas is smaller than the image', () => {
    // Canvas 1000 x 750 shows the 4000 x 3000 image whole
    const r = visibleDownloadRegion({ x: 250, y: 100, w: 500, h: 250 }, {}, { width: 1000, height: 750 }, image);
    expect(r).toEqual({ x: 1000, y: 400, w: 2000, h: 1000 });
  });
  it('subtracts the place of an image that covers part of the Canvas', () => {
    const layer = { target: { x: 500, y: 0, w: 1000, h: 750 } };
    const r = visibleDownloadRegion({ x: 750, y: 0, w: 500, h: 375 }, layer, { width: 2000, height: 750 }, image);
    expect(r).toEqual({ x: 1000, y: 0, w: 2000, h: 1500 });
  });
  it('clamps to the image (a view that reaches past it)', () => {
    const r = visibleDownloadRegion({ x: -100, y: -100, w: 600, h: 600 }, {}, { width: 1000, height: 750 }, image);
    expect(r).toEqual({ x: 0, y: 0, w: 2000, h: 2000 });
    const r2 = visibleDownloadRegion({ x: 800, y: 600, w: 600, h: 600 }, {}, { width: 1000, height: 750 }, image);
    expect(r2).toEqual({ x: 3200, y: 2400, w: 800, h: 600 });
  });
  it('is the whole image when the view covers it', () => {
    expect(visibleDownloadRegion({ x: -10, y: -10, w: 2000, h: 2000 }, {}, { width: 1000, height: 750 }, image)).toBe('full');
  });
  it('is null when the view misses the image or the Canvas has no size', () => {
    const layer = { target: { x: 0, y: 0, w: 100, h: 100 } };
    expect(visibleDownloadRegion({ x: 500, y: 500, w: 10, h: 10 }, layer, { width: 1000, height: 750 }, image)).toBeNull();
    expect(visibleDownloadRegion({ x: 0, y: 0, w: 10, h: 10 }, {}, {}, image)).toBeNull();
  });
});

describe('isPlainLayer', () => {
  it('is false for a cropped, turned or mirrored image', () => {
    expect(isPlainLayer({ rotation: 0, mirror: false })).toBe(true);
    expect(isPlainLayer({ rotation: 0, mirror: false, regionSpec: 'full' })).toBe(true);
    expect(isPlainLayer({ rotation: 0, mirror: false, regionSpec: '0,0,10,10' })).toBe(false);
    expect(isPlainLayer({ rotation: 90, mirror: false })).toBe(false);
    expect(isPlainLayer({ rotation: 0, mirror: true })).toBe(false);
  });
});

describe('file names', () => {
  it('joins label, region and size', () => {
    expect(downloadFileName('A postcard / 1900', 'full', { width: 800, height: 600 }, 'jpg')).toBe('A_postcard_1900_full_800x600.jpg');
    expect(downloadFileName('絵巻', { x: 1, y: 2, w: 3, h: 4 }, { width: 3, height: 4 }, '.png')).toBe('絵巻_region-1-2-3-4_3x4.png');
  });
  it('falls back for an empty or unsafe label', () => {
    expect(downloadFileName('///', undefined, undefined, 'mp4')).toBe('image.mp4');
    expect(downloadFileName('x'.repeat(100), undefined, undefined, 'jpg')).toBe(`${'x'.repeat(60)}.jpg`);
  });
  it('takes the extension from the media type, else the URL', () => {
    expect(extensionOf('https://e.org/a', 'video/mp4')).toBe('mp4');
    expect(extensionOf('https://e.org/a/m.GLB?x=1')).toBe('glb');
    expect(extensionOf('https://e.org/a/full/max/0/default', undefined, 'jpg')).toBe('jpg');
  });
});
