import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { storyOf } from './story';

// A story told in a Scene (Presentation 4.0, "Interactivity, Guided Viewing and Storytelling"): each step is
// a describing or commenting Annotation, and `scope` names the Camera it is seen from. The shape follows the
// IIIF/3d example manifests/10_activating_annotations/astronaut_comment_activating_scope.json
// (hidden Cameras painted into the Scene, position from the target's PointSelector, direction from lookAt).
const S = 'https://example.org/scene/1';
const camera = (n: number, z: number, extra: Record<string, unknown> = {}) => ({
  id: `${S}/cameras/${n}`,
  type: 'Annotation',
  motivation: ['painting'],
  behavior: ['hidden'],
  body: { id: `${S}/cameras/${n}/body`, type: 'PerspectiveCamera', lookAt: { type: 'PointSelector', x: 0, y: 1, z: 0 }, ...extra },
  target: { type: 'SpecificResource', source: { id: S, type: 'Scene' }, selector: [{ type: 'PointSelector', x: 0, y: 1, z }] },
});
const step = (n: number, html: string, opts: { camera?: number; point?: boolean; motivation?: string } = {}) => ({
  id: `${S}/steps/${n}`,
  type: 'Annotation',
  motivation: [opts.motivation ?? 'describing'],
  body: { type: 'TextualBody', value: html, format: 'text/html' },
  ...(opts.camera ? { scope: [{ id: `${S}/cameras/${opts.camera}`, type: 'Annotation' }] } : {}),
  target: opts.point
    ? { type: 'SpecificResource', source: { id: S, type: 'Scene' }, selector: [{ type: 'PointSelector', x: 0, y: 1, z: 0.1 }] }
    : { id: S, type: 'Scene' },
});
const manifest = (pages: unknown[]): ManifestV4 =>
  ({
    '@context': 'http://iiif.io/api/presentation/4/context.json',
    id: 'https://example.org/m',
    type: 'Manifest',
    label: { en: ['m'] },
    items: [
      {
        id: S,
        type: 'Scene',
        items: [
          {
            id: `${S}/page/1`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${S}/model`,
                type: 'Annotation',
                motivation: ['painting'],
                body: { id: 'https://example.org/model.glb', type: 'Model', format: 'model/gltf-binary' },
                target: { id: S, type: 'Scene' },
              },
              camera(1, 5, { fieldOfView: 40 }),
              camera(2, 3),
            ],
          },
        ],
        annotations: pages,
      },
    ],
  }) as unknown as ManifestV4;

describe('storyOf in a Scene', () => {
  it('reads an Annotation Page with the behavior "sequence" as the tour, steps without a Camera included', () => {
    const story = storyOf(
      manifest([
        { id: `${S}/notes`, type: 'AnnotationPage', items: [step(9, 'A mark', { point: true, motivation: 'commenting' })] },
        {
          id: `${S}/tour`,
          type: 'AnnotationPage',
          behavior: ['sequence'],
          items: [step(1, '<h2>Front</h2><p>From the front.</p>', { camera: 1 }), step(2, '<p>Closer.</p>', { camera: 2 }), step(3, '<p>Look around.</p>')],
        },
      ]),
    );
    expect(story?.steps.map((s) => s.id)).toEqual([`${S}/steps/1`, `${S}/steps/2`, `${S}/steps/3`]);
    expect(story?.steps[0]).toMatchObject({ canvasId: S, camera: { position: [0, 1, 5], lookAt: [0, 1, 0], fieldOfView: 40 } });
    expect(story?.steps[1].camera).toEqual({ position: [0, 1, 3], lookAt: [0, 1, 0] });
    expect(story?.steps[2].camera).toBeNull();
  });

  it('without a sequence, makes a tour of the notes that name a Camera, and leaves the others out', () => {
    const story = storyOf(
      manifest([
        {
          id: `${S}/notes`,
          type: 'AnnotationPage',
          items: [
            step(1, 'Glove', { camera: 1, point: true, motivation: 'commenting' }),
            step(2, 'No view of its own', { point: true, motivation: 'commenting' }),
            step(3, 'Helmet', { camera: 2, point: true, motivation: 'commenting' }),
          ],
        },
      ]),
    );
    expect(story?.steps.map((s) => s.id)).toEqual([`${S}/steps/1`, `${S}/steps/3`]);
  });

  it('is no story when fewer than two notes have a Camera', () => {
    const m = manifest([
      { id: `${S}/notes`, type: 'AnnotationPage', items: [step(1, 'Glove', { camera: 1, point: true }), step(2, 'Hand', { point: true })] },
    ]);
    expect(storyOf(m)).toBeNull();
  });

  it('is no story when no step of a sequence has a Camera (nothing would move)', () => {
    const m = manifest([
      { id: `${S}/tour`, type: 'AnnotationPage', behavior: ['sequence'], items: [step(1, 'One'), step(2, 'Two')] },
    ]);
    expect(storyOf(m)).toBeNull();
  });
});
