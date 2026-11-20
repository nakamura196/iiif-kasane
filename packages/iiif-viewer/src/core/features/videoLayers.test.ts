import { describe, expect, it } from 'vitest';
import { canvasImagesOf, isVideoLayer, layerPaintingsOf } from './image';
import { layerCountOf, layerItemsOf } from './layers';
import { containersOf } from '../services/containers';
import { isPictureWithVideo, regionInView, regionVolume } from './videoLayers';

// Recipe 0036 with a clip in place of the detail image: a page image, and a video placed on part of it.
const CANVAS = 'https://example.org/canvas/1';

const image = {
  id: `${CANVAS}/painting/image`,
  type: 'Annotation',
  motivation: 'painting',
  body: {
    id: 'https://example.org/iiif/scroll/full/max/0/default.jpg',
    type: 'Image',
    format: 'image/jpeg',
    width: 80000,
    height: 3000,
    service: [{ id: 'https://example.org/iiif/scroll', type: 'ImageService2', profile: 'level2' }],
  },
  target: CANVAS,
};

const video = (n: number, target: unknown, extra: Record<string, unknown> = {}) => ({
  id: `${CANVAS}/painting/video-${n}`,
  type: 'Annotation',
  motivation: 'painting',
  body: {
    id: `https://example.org/video-${n}.mp4`,
    type: 'Video',
    format: 'video/mp4',
    width: 960,
    height: 1080,
    label: { en: [`Clip ${n}`] },
    summary: { en: ['A demon walks'] },
    ...extra,
  },
  target,
});

const canvasWith = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  id: CANVAS,
  type: 'Canvas',
  width: 80000,
  height: 3000,
  items: [{ id: `${CANVAS}/page`, type: 'AnnotationPage', items }],
  ...extra,
});

const manifestOf = (canvas: unknown) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: 'https://example.org/manifest',
  type: 'Manifest',
  label: { en: ['x'] },
  items: [canvas],
});

describe('a video painted with an image is a layer (0036 with a clip)', () => {
  const canvas = canvasWith([
    image,
    video(1, `${CANVAS}#xywh=38601,181,2440,2690`),
    video(2, { type: 'SpecificResource', source: CANVAS, selector: { type: 'FragmentSelector', value: 'xywh=100,200,300,400' } }),
  ]);
  const images = canvasImagesOf(canvas);

  it('reads the video as a layer placed on its target', () => {
    const items = layerItemsOf(layerPaintingsOf(images.paintings));
    expect(items.map((it) => [isVideoLayer(it.layer), it.layer.target])).toEqual([
      [false, undefined],
      [true, { x: 38601, y: 181, w: 2440, h: 2690 }],
      [true, { x: 100, y: 200, w: 300, h: 400 }],
    ]);
    expect(items[1].label).toEqual({ en: ['Clip 1'] });
    expect(items[1].layer.summary).toEqual({ en: ['A demon walks'] });
    expect(items[1].layer.format).toBe('video/mp4');
  });

  it('counts the videos as layers, so the Layers tab is offered', () => {
    const [info] = containersOf(manifestOf(canvas) as never);
    expect(layerCountOf(info.painting)).toBe(3);
  });

  it('is a picture, not a timeline', () => {
    expect(isPictureWithVideo(canvas)).toBe(true);
  });
});

describe('what is not a picture with video', () => {
  it('a video Canvas (no image): played as a video, no layers', () => {
    const canvas = canvasWith([video(1, CANVAS)]);
    expect(layerPaintingsOf(canvasImagesOf(canvas).paintings)).toEqual([]);
    expect(isPictureWithVideo(canvas)).toBe(false);
    const [info] = containersOf(manifestOf(canvas) as never);
    expect(layerCountOf(info.painting)).toBe(0);
  });

  it('a timeline: a duration, or a time on a target (recipe 0489)', () => {
    expect(isPictureWithVideo(canvasWith([image, video(1, `${CANVAS}#xywh=1,2,3,4`)], { duration: 60 }))).toBe(false);
    expect(isPictureWithVideo(canvasWith([image, video(1, `${CANVAS}#xywh=1,2,3,4&t=5,20`)]))).toBe(false);
  });

  it('a Canvas that also paints sound', () => {
    const sound = { ...image, id: 'x', body: { id: 'https://example.org/a.mp3', type: 'Sound' } };
    expect(isPictureWithVideo(canvasWith([image, sound, video(1, `${CANVAS}#xywh=1,2,3,4`)]))).toBe(false);
  });

  it('images only (recipe 0036 itself)', () => {
    expect(isPictureWithVideo(canvasWith([image, { ...image, id: 'detail', target: `${CANVAS}#xywh=1,2,3,4` }]))).toBe(false);
  });
});

describe('regionVolume / regionInView', () => {
  const view = { x: 0, y: 0, w: 1000, h: 1000 };
  it('is loudest at the middle of the view and silent at a corner', () => {
    expect(regionVolume({ x: 450, y: 450, w: 100, h: 100 }, view)).toBeCloseTo(1);
    expect(regionVolume({ x: -50, y: -50, w: 100, h: 100 }, view)).toBeCloseTo(0);
    expect(regionVolume({ x: 5000, y: 5000, w: 100, h: 100 }, view)).toBe(0);
  });
  it('tells whether a region is on screen', () => {
    expect(regionInView({ x: 900, y: 900, w: 200, h: 200 }, view)).toBe(true);
    expect(regionInView({ x: 1001, y: 0, w: 10, h: 10 }, view)).toBe(false);
  });
});
