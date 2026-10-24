import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canvasImagesOf,
  canvasRectToLayer,
  imageRequestUrl,
  parseImageInfo,
  parseRotation,
  parseImageXywh,
  pickScaleFactor,
  placementOf,
  resolveRegion,
  rotationFromCss,
  serviceFromImageUrl,
  singleImageUrl,
  thumbnailUrlOf,
  tileSchemeOf,
  tilesCovering,
  tilesForView,
  mergedScheme,
  type CanvasImages,
} from './image';

// Cookbook recipes (Presentation 3), saved from iiif.io on 2026-10-12.
const manifest = (n: string): { items: unknown[]; thumbnail?: unknown } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${n}.json`, import.meta.url)), 'utf8'));
const canvases = (n: string): CanvasImages[] => manifest(n).items.map(canvasImagesOf);
const first = (n: string): CanvasImages => canvases(n)[0];
const layerOf = (c: CanvasImages, p = 0, o = 0) => c.paintings[p].options[o].layer!;

describe('canvasImagesOf: Cookbook recipes', () => {
  it('0004 canvas size: a plain image without a service', () => {
    const c = first('0004-canvas-size');
    expect([c.width, c.height]).toEqual([1920, 1080]);
    const l = layerOf(c);
    expect(l.service).toBeUndefined();
    expect(l.url).toMatch(/act1-thumbnail\.png$/);
    expect([l.width, l.height]).toEqual([640, 360]);
    expect(l.target).toBeUndefined();
  });

  it('0005 image service: the service of the body', () => {
    const l = layerOf(first('0005-image-service'));
    expect(l.service).toEqual({
      id: 'https://iiif.io/api/image/3.0/example/reference/918ecd18c2592080851777620de9bcb5-gottingen',
      version: 3,
    });
  });

  it('0005 image service（v4 版。Cookbook PR #725）: v3 版と同じに読む', () => {
    const l = layerOf(first('0005-image-service-v4'));
    expect(l.service).toEqual({
      id: 'https://iiif.io/api/image/3.0/example/reference/918ecd18c2592080851777620de9bcb5-gottingen',
      version: 3,
    });
  });

  it('0036 composition: the miniature has a place on the Canvas', () => {
    const c = first('0036-composition-from-multiple-images');
    expect(c.paintings).toHaveLength(2);
    expect(layerOf(c, 0).target).toBeUndefined();
    expect(layerOf(c, 1).target).toEqual({ x: 3949, y: 994, w: 1091, h: 1232 });
  });

  it('0040 rotation: selector version and CSS version both rotate by 90', () => {
    const a = layerOf(first('0040-image-rotation-service_manifest-service'));
    expect([a.rotation, a.mirror]).toEqual([90, false]);
    expect(a.url).toMatch(/full\/max\/0\/default\.jpg$/);
    const b = layerOf(first('0040-image-rotation-service_manifest-css'));
    expect(b.rotation).toBe(90);
    expect(b.service?.id).toMatch(/page1$/);
  });

  it('0283 missing image: the empty Canvas keeps its size and has no painting', () => {
    const cs = canvases('0283-missing-image');
    expect(cs).toHaveLength(4);
    expect(cs[1].paintings).toHaveLength(0);
    expect([cs[1].width, cs[1].height]).toEqual([1768, 2504]);
    expect(cs[2].paintings).toHaveLength(1);
  });

  it('0326 image layer: Choice options, and an annotation of the X-ray layer only', () => {
    const c = first('0326-annotating-image-layer');
    expect(c.paintings).toHaveLength(1);
    const [natural, xray] = c.paintings[0].options;
    expect(natural.layer!.annotations).toHaveLength(0);
    expect(xray.layer!.annotations).toHaveLength(1);
    const a = xray.layer!.annotations[0];
    expect(a.text).toBe('A group of skulls.');
    // region 810,900,260,370 of a 2000x1271 image that fills a 2000x1271 Canvas
    expect([a.region.x, a.region.y, a.region.w].map(Math.round)).toEqual([810, 900, 260]);
    expect(a.region.h).toBeCloseTo(370);
  });

  it('0377 image in annotation: an Image body in a commenting annotation', () => {
    const c = first('0377-image-in-annotation');
    expect(c.annotations).toHaveLength(1);
    expect(c.annotations[0].region).toEqual({ x: 138, y: 550, w: 1477, h: 1710 });
    expect(c.annotations[0].images[0]).toMatch(/fountain\/full\/300,\/0\/default\.jpg$/);
    expect(c.annotations[0].text).toMatch(/Gänseliesel/);
  });

  it('0013 placeholderCanvas / 0014 accompanyingCanvas', () => {
    const p = first('0013-placeholderCanvas');
    expect(p.paintings[0].options[0].kind).toBe('Video');
    expect(p.placeholder?.layer.url).toMatch(/act1-thumbnail\.png$/);
    expect(p.accompanying).toBeUndefined();
    const a = first('0014-accompanyingcanvas');
    expect(a.paintings[0].options[0].kind).toBe('Audio');
    expect(a.accompanying?.layer.service?.id).toMatch(/mahler-0$/);
    expect([a.accompanying?.width, a.accompanying?.height]).toEqual([772, 998]);
  });

  it('0035 foldouts: nine plain image canvases with their own sizes', () => {
    const cs = canvases('0035-foldouts');
    expect(cs).toHaveLength(9);
    expect(cs.every((c) => c.paintings[0].options[0].kind === 'Image')).toBe(true);
    expect([cs[3].width, cs[3].height]).toEqual([3688, 1968]);
  });

  it('0117 / 0232 thumbnails', () => {
    const m = manifest('0117-add-image-thumbnail');
    expect(thumbnailUrlOf(m.thumbnail)).toMatch(/ucla_bib1987273_no001_rs_001\/full\/max/);
    const cs = canvases('0232-image-thumbnail-canvas_manifest-image');
    // a level 0 service: a size the service lists, never an arbitrary one
    expect(cs[0].thumbnail).toBe(
      'https://fixtures.iiif.io/other/level0/Glen/photos/gottingen/full/252,189/0/default.jpg',
    );
    const av = canvases('0232-image-thumbnail-canvas_manifest-av');
    expect(av[0].thumbnail).toMatch(/act1-thumbnail\.png$/);
  });
});

describe('small readers', () => {
  it('parseImageXywh', () => {
    expect(parseImageXywh('https://x/c#xywh=1,2,3,4')).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(parseImageXywh('xywh=percent:10,10,50,50', { width: 200, height: 100 })).toEqual({ x: 20, y: 10, w: 100, h: 50 });
    expect(parseImageXywh('https://x/c')).toBeUndefined();
  });
  it('parseRotation', () => {
    expect(parseRotation('!90')).toEqual({ rotation: 90, mirror: true });
    expect(parseRotation('-90')).toEqual({ rotation: 270, mirror: false });
    expect(parseRotation(undefined)).toEqual({ rotation: 0, mirror: false });
  });
  it('rotationFromCss reads only the rule of the class', () => {
    const css = '.a { transform: rotate(10deg); } .rotated { transform-origin: 1px 2px; transform: rotate(90deg) translateY(-5px); }';
    expect(rotationFromCss(css, 'rotated')).toBe(90);
    expect(rotationFromCss(css, 'none')).toBeUndefined();
  });
  it('resolveRegion', () => {
    expect(resolveRegion('full', 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(resolveRegion('square', 100, 50)).toEqual({ x: 25, y: 0, w: 50, h: 50 });
    expect(resolveRegion('pct:10,10,50,50', 200, 100)).toEqual({ x: 20, y: 10, w: 100, h: 50 });
    expect(resolveRegion('10,10,500,500', 100, 50)).toEqual({ x: 10, y: 10, w: 90, h: 40 });
  });
  it('serviceFromImageUrl', () => {
    expect(serviceFromImageUrl('https://h/iiif/abc/full/max/0/default.jpg')).toBe('https://h/iiif/abc');
    expect(serviceFromImageUrl('https://h/iiif/abc/full/!512,512/90/default.jpg')).toBe('https://h/iiif/abc');
    expect(serviceFromImageUrl('https://h/photo.png')).toBeUndefined();
  });
});

describe('tiles', () => {
  const service = { id: 'https://h/i', version: 3 as const };
  const info = parseImageInfo({
    '@context': 'http://iiif.io/api/image/3/context.json',
    width: 4000,
    height: 3000,
    profile: 'level1',
    tiles: [{ width: 1024, height: 1024, scaleFactors: [1, 2, 4] }],
  })!;

  it('parseImageInfo reads v3 and v2', () => {
    expect(info.version).toBe(3);
    expect(info.level).toBe(1);
    const v2 = parseImageInfo({
      '@context': 'http://iiif.io/api/image/2/context.json',
      '@id': 'https://h/i',
      width: 10,
      height: 20,
      profile: ['http://iiif.io/api/image/2/level0.json'],
      sizes: [{ width: 5, height: 10 }],
    })!;
    expect([v2.version, v2.level, v2.sizes.length]).toEqual([2, 0, 1]);
    expect(parseImageInfo({})).toBeNull();
  });

  it('picks the coarsest factor that keeps one source pixel per screen pixel', () => {
    expect(pickScaleFactor([1, 2, 4], 1)).toBe(1);
    expect(pickScaleFactor([1, 2, 4], 0.5)).toBe(2);
    expect(pickScaleFactor([1, 2, 4], 0.1)).toBe(4);
    expect(pickScaleFactor([2, 4], 3)).toBe(2);
  });

  it('covers a region with clipped edge tiles', () => {
    const scheme = tileSchemeOf(info)!;
    const all = tilesCovering(service, info, scheme, 1, { x: 0, y: 0, w: 4000, h: 3000 });
    expect(all).toHaveLength(4 * 3);
    const last = all[all.length - 1];
    expect([last.x, last.y, last.w, last.h]).toEqual([3072, 2048, 928, 952]);
    expect(last.url).toBe('https://h/i/3072,2048,928,952/928,/0/default.jpg');
    const one = tilesCovering(service, info, scheme, 4, { x: 10, y: 10, w: 10, h: 10 });
    expect(one).toHaveLength(1);
    expect(one[0].url).toBe('https://h/i/0,0,4000,3000/1000,/0/default.jpg');
  });

  it('steps to a coarser factor rather than cutting the tiles of a view', () => {
    // a large level 0 image (8612 x 6470, 200 px tiles) shown whole on a wide screen
    const big = { ...info, width: 8612, height: 6470, level: 0, tiles: [{ width: 200, height: 200, scaleFactors: [1, 2, 4, 8, 16, 32] }] };
    const scheme = tileSchemeOf(big)!;
    const whole = { x: 0, y: 0, w: 8612, h: 6470 };
    // factor 2 would take 22 x 17 = 374 tiles; factor 4 takes 11 x 9 = 99
    const tiles = tilesForView(service, big, scheme, 0.43, whole);
    expect(tiles).toHaveLength(99);
    expect(tiles[tiles.length - 1].key).toBe('4/10/8');
    // a view that fits keeps the sharpest factor
    expect(tilesForView(service, big, scheme, 0.43, { x: 0, y: 0, w: 2000, h: 1500 })[0].key).toBe('2/0/0');
  });

  it('asks for 2 x 2 declared tiles at once on servers that cut any region', () => {
    // the University of Tokyo's server: level 2, 512 px tiles, 7442 x 5592
    const ut = parseImageInfo({
      '@context': 'http://iiif.io/api/image/2/context.json',
      '@id': 'https://h/i',
      width: 7442,
      height: 5592,
      profile: ['http://iiif.io/api/image/2/level2.json'],
      tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4, 8, 16] }],
    })!;
    const scheme = tileSchemeOf(ut)!;
    const view = { x: 0, y: 0, w: 6600, h: 5000 };
    // 13 x 10 = 130 declared tiles become 7 x 5 = 35 requests of the same sharpness
    const tiles = tilesForView(service, ut, scheme, 1, view);
    expect(tiles).toHaveLength(35);
    expect(tiles[0].key).toBe('m1/0/0');
    expect(tiles[0].url).toBe('https://h/i/0,0,1024,1024/1024,/0/default.jpg');
    // a view of a few tiles keeps the declared ones
    expect(tilesForView(service, ut, scheme, 1, { x: 0, y: 0, w: 1000, h: 1000 })[0].key).toBe('1/0/0');
    // not on level 0, nor beyond the server's maxWidth
    expect(tilesForView(service, { ...ut, level: 0 }, scheme, 1, view)).toHaveLength(130);
    expect(mergedScheme({ ...ut, maxWidth: 800 }, scheme)).toBeNull();
    expect(mergedScheme(ut, { width: 1024, height: 1024 })).toBeNull();
  });

  it('parseImageInfo reads maxWidth from the v2 profile and the v3 info.json', () => {
    const v2 = parseImageInfo({ '@id': 'https://h/i', width: 10, height: 10, profile: ['level2', { maxWidth: 800 }] })!;
    expect([v2.maxWidth, v2.maxHeight, v2.maxArea]).toEqual([800, 800, undefined]);
    const v3 = parseImageInfo({ width: 10, height: 10, profile: 'level2', maxArea: 1000000 })!;
    expect([v3.maxWidth, v3.maxArea]).toEqual([undefined, 1000000]);
  });

  it('level 0 without tiles: a listed size, never a region', () => {
    const l0 = { ...info, level: 0, tiles: [], sizes: [{ width: 500, height: 375 }, { width: 1000, height: 750 }] };
    expect(tileSchemeOf(l0)).toBeNull();
    expect(singleImageUrl(service, l0, 600)).toBe('https://h/i/full/1000,750/0/default.jpg');
    expect(singleImageUrl(service, l0, 5000)).toBe('https://h/i/full/1000,750/0/default.jpg');
  });

  it('level 1 without tiles: 512 px tiles at powers of two', () => {
    const scheme = tileSchemeOf({ ...info, tiles: [] })!;
    expect(scheme.width).toBe(512);
    expect(scheme.scaleFactors).toEqual([1, 2, 4, 8]);
  });

  it('imageRequestUrl: the whole image can be asked as pixels (servers that refuse `full`)', () => {
    const region = { x: 0, y: 0, w: 40427, h: 27112 };
    expect(imageRequestUrl({ id: 'u', version: 2 }, region, 1024)).toBe('u/0,0,40427,27112/1024,/0/default.jpg');
    expect(imageRequestUrl({ id: 'u', version: 1 }, region, 1024)).toBe('u/0,0,40427,27112/1024,/0/native.jpg');
  });

  it('imageRequestUrl: v2 gets w, and v1 asks for native', () => {
    expect(imageRequestUrl({ id: 'u', version: 2 }, 'full', 100, 50)).toBe('u/full/100,/0/default.jpg');
    expect(imageRequestUrl({ id: 'u', version: 1 }, 'full', 100)).toBe('u/full/100,/0/native.jpg');
    expect(imageRequestUrl({ id: 'u', version: 3 }, 'full', 100, 50)).toBe('u/full/100,50/0/default.jpg');
  });
});

describe('placement', () => {
  it('a 90 degree turned image fills a landscape Canvas', () => {
    const p = placementOf({ x: 0, y: 0, w: 1523, h: 2105 }, { x: 0, y: 0, w: 2105, h: 1523 }, 90, false);
    expect(p.k).toBeCloseTo(1);
    expect([p.cx, p.cy]).toEqual([1052.5, 761.5]);
  });

  it('maps a Canvas rectangle back to source pixels through the rotation', () => {
    const p = placementOf({ x: 0, y: 0, w: 1523, h: 2105 }, { x: 0, y: 0, w: 2105, h: 1523 }, 90, false);
    // the whole Canvas is the whole source image
    const r = canvasRectToLayer(p, { x: 0, y: 0, w: 2105, h: 1523 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(1523);
    expect(r.h).toBeCloseTo(2105);
    // turned clockwise by 90: the Canvas' top-left corner is the source's bottom-left corner
    const corner = canvasRectToLayer(p, { x: 0, y: 0, w: 10, h: 10 });
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y + corner.h).toBeCloseTo(2105);
  });
});
