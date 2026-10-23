import { describe, expect, it } from 'vitest';
import { parseManifestV4 } from '../services/manifestParser';
import type { ManifestV4 } from '../types/iiif';
import {
  annotationTitleOf,
  imageOfBody,
  isImageBody,
  isTagBody,
  pickBodies,
  readAnnotationBodies,
  tagOfBody,
} from './annotationBody';
import { readCanvasAnnotations } from './annotations';

// One annotation as the Region & Tag extension writes it: a heading, a description in two languages,
// a keyed tag, a plain tag, a picture with its Image API service and the holding institution's page, and a link.
const body = [
  {
    type: 'Choice',
    items: [
      { type: 'TextualBody', value: '北極', language: 'ja' },
      { type: 'TextualBody', value: 'North Pole', language: 'en' },
    ],
  },
  { type: 'TextualBody', purpose: 'tagging', value: '北極', label: { ja: ['地名'] } },
  { type: 'TextualBody', purpose: 'tagging', value: '極' },
  {
    id: 'https://example.org/iiif/pole/full/max/0/default.jpg',
    type: 'Image',
    format: 'image/jpeg',
    label: { ja: ['北極の拡大'] },
    service: [{ id: 'https://example.org/iiif/pole', type: 'ImageService3' }],
    homepage: [{ id: 'https://example.org/record/1', type: 'Text', label: { ja: ['所蔵先の記録'] } }],
  },
  { id: 'https://www.wikidata.org/entity/Q934', type: 'SpecificResource', source: 'https://www.wikidata.org/entity/Q934' },
];
const anno = { id: 'https://example.org/m#a1', type: 'Annotation', motivation: 'commenting', label: { ja: ['北極点'] }, body };

const canvas = 'https://example.org/m/canvas';
const read2D = (a: Record<string, unknown>) =>
  readCanvasAnnotations(canvas, [{ type: 'AnnotationPage', items: [{ ...a, target: `${canvas}#xywh=1,2,3,4` }] }], {
    width: 100,
    height: 100,
  });

const scene = 'https://example.org/m#scene';
const read3D = (a: Record<string, unknown>, locale = 'ja') =>
  parseManifestV4(
    {
      '@context': 'http://iiif.io/api/presentation/4/context.json',
      id: 'https://example.org/m',
      type: 'Manifest',
      items: [
        {
          id: scene,
          type: 'Scene',
          items: [],
          annotations: [
            {
              id: 'https://example.org/m#page',
              type: 'AnnotationPage',
              items: [
                {
                  ...a,
                  target: {
                    type: 'SpecificResource',
                    source: [{ id: scene, type: 'Scene' }],
                    selector: [{ type: 'PointSelector', x: 1, y: 2, z: 3 }],
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ManifestV4,
    null,
    locale,
  ).annotations;

describe('readAnnotationBodies', () => {
  it('keeps every body, the alternatives of a Choice under one number', () => {
    const items = readAnnotationBodies(anno);
    expect(items.map((b) => [b.kind, b.choice])).toEqual([
      ['text', 0],
      ['text', 0],
      ['text', undefined],
      ['text', undefined],
      ['resource', undefined],
      ['resource', undefined],
    ]);
  });

  it('reads what a picture says about itself', () => {
    const image = readAnnotationBodies(anno).find(isImageBody);
    expect(image && imageOfBody(image, 'ja')).toEqual({
      id: 'https://example.org/iiif/pole/full/max/0/default.jpg',
      label: '北極の拡大',
      format: 'image/jpeg',
      service: 'https://example.org/iiif/pole',
      homepage: 'https://example.org/record/1',
      homepageLabel: '所蔵先の記録',
    });
  });

  it('marks a related picture (purpose linking)', () => {
    const items = readAnnotationBodies({ body: { id: 'https://example.org/a.jpg', type: 'Image', purpose: 'linking' } });
    expect(imageOfBody(items[0], 'ja').purpose).toBe('linking');
  });

  it('reads bodyValue as a text body', () => {
    expect(readAnnotationBodies({ bodyValue: '短い本文' })).toEqual([{ kind: 'text', value: '短い本文' }]);
  });
});

describe('annotationTitleOf', () => {
  it('takes the annotation label, else the label of the first text body that is not a tag', () => {
    expect(annotationTitleOf(anno)).toEqual({ ja: ['北極点'] });
    expect(
      annotationTitleOf({
        body: [
          { type: 'TextualBody', purpose: 'tagging', value: 't', label: 'key' },
          { type: 'TextualBody', value: 'v', label: '見出し' },
        ],
      }),
    ).toBe('見出し');
  });
});

describe('2D and 3D read an annotation the same way', () => {
  it('gives the same heading, tags and pictures', () => {
    const [a2] = read2D(anno);
    const [a3] = read3D(anno);
    const items = pickBodies(a2.bodies, 'ja');
    expect(a3.title).toBe('北極点');
    expect(a2.title).toEqual({ ja: ['北極点'] });
    expect(a3.tags).toEqual(items.filter(isTagBody).map((b) => tagOfBody(b, 'ja')));
    expect(a3.tags).toEqual([{ key: '地名', value: '北極' }, { value: '極' }]);
    expect(a3.images).toEqual(items.filter(isImageBody).map((b) => imageOfBody(b, 'ja')));
  });

  it('3D takes the description in the reader\'s language from a Choice', () => {
    expect(read3D(anno, 'ja')[0].description).toBe('北極');
    expect(read3D(anno, 'en')[0].description).toBe('North Pole');
  });

  it('2D reads bodyValue', () => {
    const rest = { ...anno, body: undefined };
    const [a2] = read2D({ ...rest, bodyValue: '短い本文' });
    expect(a2.bodies).toEqual([{ kind: 'text', value: '短い本文' }]);
    expect(read3D({ ...rest, bodyValue: '短い本文' })[0].description).toBe('短い本文');
  });
});
