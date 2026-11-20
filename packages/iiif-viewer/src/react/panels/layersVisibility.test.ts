import { describe, expect, it } from 'vitest';
import { containersOf, type ManifestV4 } from '../../core';
import { layersPanel } from './LayersPanel';

// The Layers tab counts videos only where the image display draws them. A timed Canvas with an image and a video
// is drawn by the stage, which gives the tab no layers, so offering the tab there left it loading forever.
const CANVAS = 'https://example.org/canvas/1';

const manifestWith = (extra: Record<string, unknown>) =>
  ({
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: 'https://example.org/manifest',
    type: 'Manifest',
    label: { en: ['x'] },
    items: [
      {
        id: CANVAS,
        type: 'Canvas',
        width: 1000,
        height: 500,
        ...extra,
        items: [
          {
            id: `${CANVAS}/page`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${CANVAS}/a/image`,
                type: 'Annotation',
                motivation: 'painting',
                body: { id: 'https://example.org/i.jpg', type: 'Image', format: 'image/jpeg', width: 1000, height: 500 },
                target: CANVAS,
              },
              {
                id: `${CANVAS}/a/video`,
                type: 'Annotation',
                motivation: 'painting',
                body: { id: 'https://example.org/v.mp4', type: 'Video', format: 'video/mp4', width: 100, height: 100 },
                target: `${CANVAS}#xywh=10,10,100,100`,
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as ManifestV4;

const available = (manifest: ManifestV4) => {
  const [container] = containersOf(manifest as never);
  return layersPanel.available({ container, manifest });
};

describe('Layers tab with videos', () => {
  it('is offered for a picture with video (no duration)', () => {
    expect(available(manifestWith({}))).toBe(true);
  });

  it('is not offered for a timed Canvas with one image and a video (drawn by the stage)', () => {
    expect(available(manifestWith({ duration: 60 }))).toBe(false);
  });
});
