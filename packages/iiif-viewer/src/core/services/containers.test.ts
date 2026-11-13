import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ManifestV4 } from '../types/iiif';
import { containersOf, defaultChoiceIndex, firstSceneOf, pageMediaOf, pagePlaceholderOf } from './containers';
import { convertToV4 } from './manifestConverter';
import { parseManifestV4, sceneCamerasOf } from './manifestParser';

// The six Cookbook recipes (Presentation 4 versions, saved from iiif.io on 2026-10-11).
const recipe = (n: string): ManifestV4 =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${n}.json`, import.meta.url)), 'utf8'),
  );

describe('containersOf: Cookbook recipes', () => {
  it('0608 3D: a Scene painting one Model', () => {
    const [c, ...rest] = containersOf(recipe('0608'));
    expect(rest).toHaveLength(0);
    expect(c.kind).toBe('Scene');
    expect(c.painting).toHaveLength(1);
    expect(c.painting[0].options).toEqual([
      { url: 'https://fixtures.iiif.io/3d/google/astronaut.glb', kind: 'Model', format: 'model/gltf-binary' },
    ]);
    expect(c.supplementing).toEqual([]);
  });

  it('0001 image: a Canvas with its size and one Image', () => {
    const [c] = containersOf(recipe('0001'));
    expect(c).toMatchObject({ kind: 'Canvas', width: 1200, height: 1800 });
    expect(c.duration).toBeUndefined();
    expect(c.painting[0].options[0]).toEqual({
      url: 'https://iiif.io/api/presentation/2.1/example/fixtures/resources/page1-full.png',
      kind: 'Image',
      format: 'image/png',
      width: 1200,
      height: 1800,
    });
  });

  it('0002 audio: a Timeline with a duration and one Audio', () => {
    const [c] = containersOf(recipe('0002'));
    expect(c).toMatchObject({ kind: 'Timeline', duration: 1985.024 });
    expect(c.width).toBeUndefined();
    expect(c.painting[0].options[0]).toMatchObject({
      kind: 'Audio',
      format: 'audio/mp4',
      duration: 1985.024,
    });
  });

  it('0003 video: a Canvas with size and duration, one Video', () => {
    const [c] = containersOf(recipe('0003'));
    expect(c).toMatchObject({ kind: 'Canvas', width: 480, height: 360, duration: 572.034 });
    expect(c.painting[0].options[0]).toMatchObject({ kind: 'Video', format: 'video/mp4', width: 480 });
    expect(c.supplementing).toEqual([]);
  });

  it('0219 captions: a closedCaptions file in WebVTT', () => {
    const [c] = containersOf(recipe('0219'));
    expect(c.painting[0].options[0].kind).toBe('Video');
    expect(c.supplementing).toEqual([
      {
        id: 'https://iiif.io/api/cookbook/recipe/0219-using-caption-file/canvas/page2/a1',
        provides: ['closedCaptions'],
        url: 'https://fixtures.iiif.io/video/indiana/lunchroom_manners/lunchroom_manners.vtt',
        format: 'text/vtt',
        language: ['en'],
        label: { en: ['Captions in WebVTT format'] },
      },
    ]);
  });

  it('0253 transcript: a transcript file in plain text', () => {
    const [c] = containersOf(recipe('0253'));
    expect(c.supplementing).toHaveLength(1);
    expect(c.supplementing[0]).toMatchObject({
      provides: ['transcript'],
      format: 'text/plain',
      url: 'https://fixtures.iiif.io/video/indiana/lunchroom_manners/lunchroom_manners.txt',
      language: ['en'],
    });
  });
});

describe('containersOf: other shapes', () => {
  it('returns [] for a missing manifest and skips unknown containers', () => {
    expect(containersOf(null)).toEqual([]);
    const m = { ...recipe('0001'), items: [{ id: 'x', type: 'Range' }, ...recipe('0001').items] };
    expect(containersOf(m as unknown as ManifestV4).map((c) => c.kind)).toEqual(['Canvas']);
  });

  it('reads a Choice as several options of one painting, and treats Sound as Audio', () => {
    const m = {
      '@context': 'http://iiif.io/api/presentation/4/context.json',
      id: 'm',
      type: 'Manifest',
      items: [
        {
          id: 'c',
          type: 'Canvas',
          items: [
            {
              type: 'AnnotationPage',
              items: [
                {
                  id: 'a',
                  type: 'Annotation',
                  motivation: 'painting',
                  body: {
                    type: 'Choice',
                    label: { en: ['Versions'] },
                    items: [
                      { id: 'https://e.org/1.mp3', type: 'Sound', format: 'audio/mpeg' },
                      { id: 'https://e.org/2.mp3', type: 'Sound' },
                      { type: 'Image' },
                    ],
                  },
                  target: 'c',
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ManifestV4;
    const [c] = containersOf(m);
    expect(c.painting).toHaveLength(1);
    expect(c.painting[0].label).toEqual({ en: ['Versions'] });
    expect(c.painting[0].options.map((o) => [o.kind, o.url])).toEqual([
      ['Audio', 'https://e.org/1.mp3'],
      ['Audio', 'https://e.org/2.mp3'],
    ]);
  });
});

describe('convertToV4: legacy (Presentation 3) manifests', () => {
  const legacy = (type: string, bodyType: string | undefined, id = 'https://e.org/c1') => ({
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: 'https://e.org/m.json',
    type: 'Manifest',
    items: [
      {
        id,
        type: 'Canvas',
        items: [
          {
            type: 'AnnotationPage',
            items: [
              {
                id: `${id}/a`,
                type: 'Annotation',
                motivation: 'painting',
                body: { id: 'https://e.org/file', type: bodyType, format: type },
                target: id,
              },
            ],
          },
        ],
      },
    ],
  });

  it('keeps turning a Canvas that paints a Model into a Scene', () => {
    const m = convertToV4(legacy('model/gltf-binary', 'Model'));
    expect(m.items[0].type).toBe('Scene');
    expect(containersOf(m)[0].painting[0].options[0].kind).toBe('Model');
  });

  it('keeps turning a Canvas with an unknown body into a Scene (as before)', () => {
    expect(convertToV4(legacy('x/y', undefined)).items[0].type).toBe('Scene');
  });

  it('leaves a Canvas that paints only an Image as a Canvas', () => {
    const m = convertToV4(legacy('image/jpeg', 'Image'));
    expect(m['@context']).toBe('http://iiif.io/api/presentation/4/context.json');
    expect(m.items[0].type).toBe('Canvas');
    expect(containersOf(m)[0].painting[0].options[0].kind).toBe('Image');
  });

  it('leaves a Timeline as it is', () => {
    const src = legacy('audio/mp4', 'Sound');
    (src.items[0] as { type: string }).type = 'Timeline';
    expect(convertToV4(src).items[0].type).toBe('Timeline');
  });

  it('converts each container on its own in a mixed manifest', () => {
    const a = legacy('model/gltf-binary', 'Model', 'https://e.org/a');
    const b = legacy('image/jpeg', 'Image', 'https://e.org/b');
    const m = convertToV4({ ...a, items: [...b.items, ...a.items] });
    expect(m.items.map((c) => c.type)).toEqual(['Canvas', 'Scene']);
    // the 3D side reads the first Scene, not items[0]
    expect(firstSceneOf(m)?.id).toBe('https://e.org/a');
    expect(parseManifestV4(m).modelUrl).toBe('https://e.org/file');
    expect(sceneCamerasOf(m)).toEqual([]);
  });
});

describe('Choice bodies and empty pages', () => {
  const choiceManifest = (type: string, extra: string[] = []) => ({
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: 'https://e.org/m',
    type: 'Manifest',
    items: [
      {
        id: 'https://e.org/c1',
        type: 'Canvas',
        label: { en: ['Track'] },
        items: [
          {
            id: 'https://e.org/c1/p',
            type: 'AnnotationPage',
            items: [
              {
                id: 'https://e.org/c1/a',
                type: 'Annotation',
                motivation: 'painting',
                body: {
                  type: 'Choice',
                  items: [
                    { id: 'https://e.org/a.mp3', type, format: 'audio/mp3' },
                    { id: 'https://e.org/a.ogg', type, format: 'audio/ogg' },
                    ...extra.map((t) => ({ id: `https://e.org/x.${t}`, type: t })),
                  ],
                },
                target: 'https://e.org/c1',
              },
            ],
          },
        ],
      },
    ],
  });

  it('keeps a Canvas painted only with a Choice of Sound as a Canvas, with all options', () => {
    const m = convertToV4(choiceManifest('Sound'));
    expect(m.items[0].type).toBe('Canvas');
    const [c] = containersOf(m);
    expect(c.painting).toHaveLength(1);
    expect(c.painting[0].options.map((o) => o.kind)).toEqual(['Audio', 'Audio']);
  });

  it('keeps a Canvas painted only with a Choice of Video as a Canvas', () => {
    expect(convertToV4(choiceManifest('Video')).items[0].type).toBe('Canvas');
  });

  it('still makes a Scene when a Choice offers a Model', () => {
    expect(convertToV4(choiceManifest('Sound', ['Model'])).items[0].type).toBe('Scene');
  });

  it('gives an empty page an "empty" placeholder, not the kind (Scene)', () => {
    const m = convertToV4({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://e.org/m',
      type: 'Manifest',
      items: [{ id: 'https://e.org/c2', type: 'Canvas', label: { en: ['f. 1v — MISSING'] }, items: [] }],
    });
    const [c] = containersOf(m);
    expect(c.label).toEqual({ en: ['f. 1v — MISSING'] });
    expect(pagePlaceholderOf(c)).toBe('empty');
    expect(pagePlaceholderOf(containersOf(convertToV4(choiceManifest('Sound')))[0])).toBe('Canvas');
  });

  it('names the media a page shows, for the page list icon', () => {
    const m = convertToV4({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://e.org/m',
      type: 'Manifest',
      items: [
        { id: 'https://e.org/e', type: 'Canvas', items: [] },
        ...(['Image', 'Video'] as const).map((type) => ({
          id: `https://e.org/${type}`,
          type: 'Canvas',
          width: 100,
          height: 100,
          duration: type === 'Video' ? 10 : undefined,
          items: [
            {
              id: `https://e.org/${type}/p`,
              type: 'AnnotationPage',
              items: [
                {
                  id: `https://e.org/${type}/a`,
                  type: 'Annotation',
                  motivation: 'painting',
                  target: `https://e.org/${type}`,
                  body: { id: `https://e.org/${type}.bin`, type },
                },
              ],
            },
          ],
        })),
      ],
    });
    expect(containersOf(m).map(pageMediaOf)).toEqual(['empty', 'Image', 'Video']);
    expect(pageMediaOf(containersOf(convertToV4(choiceManifest('Sound')))[0])).toBe('Audio');
    expect(pageMediaOf({ kind: 'Scene', painting: [{ id: 'x', label: undefined, options: [] }] })).toBe('Model');
  });
});

describe('defaultChoiceIndex', () => {
  const opts = [
    { kind: 'Audio' as const, format: 'audio/alac' },
    { kind: 'Audio' as const, format: 'audio/mpeg' },
    { kind: 'Audio' as const, format: 'audio/ogg' },
  ];
  it('picks the first playable option', () => {
    expect(defaultChoiceIndex(opts, (f) => (f === 'audio/alac' ? '' : 'maybe'))).toBe(1);
  });
  it('treats an option without a format as a candidate', () => {
    expect(defaultChoiceIndex([opts[0], { kind: 'Audio' as const }], () => '')).toBe(1);
  });
  it('falls back to the first when none is playable', () => {
    expect(defaultChoiceIndex(opts, () => '')).toBe(0);
  });
  it('does not touch image Choices', () => {
    expect(defaultChoiceIndex([{ kind: 'Image' as const, format: 'x/y' }], () => '')).toBe(0);
  });
});
