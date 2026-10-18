import { describe, expect, it } from 'vitest';
import type { SceneV4 } from '../types/iiif';
import { chosenUrl, labelIn, paintedModelsOf, upgradeUrl } from './paintedModels';
import { parseManifestV4 } from './manifestParser';

const scene = {
  id: 'https://example.org/m.json#scene',
  type: 'Scene',
  items: [
    {
      type: 'AnnotationPage',
      items: [
        {
          id: 'https://example.org/m.json#model',
          type: 'Annotation',
          motivation: ['painting'],
          body: { id: 'https://example.org/buildings.glb', type: 'Model', label: { en: ['Buildings'] } },
          target: { type: 'SpecificResource', source: [], selector: [{ type: 'PointSelector', x: 1, y: 2, z: 3 }] },
        },
        {
          id: 'https://example.org/m.json#ground',
          type: 'Annotation',
          motivation: ['painting'],
          body: {
            type: 'Choice',
            label: { ja: ['地面'], en: ['Ground'] },
            items: [
              { id: 'https://example.org/map.glb', type: 'Model', label: { ja: ['地図'], en: ['Map'] } },
              { id: 'https://example.org/roads.glb', type: 'Model', label: { ja: ['道'], en: ['Streets'] } },
            ],
          },
          target: 'https://example.org/m.json#scene',
        },
        {
          id: 'https://example.org/m.json#camera',
          type: 'Annotation',
          motivation: ['painting'],
          body: { type: 'PerspectiveCamera' },
          target: 'https://example.org/m.json#scene',
        },
      ],
    },
  ],
} as unknown as SceneV4;

describe('paintedModelsOf', () => {
  it('lists every painted Model, with a Choice as one model with several options', () => {
    const models = paintedModelsOf(scene);
    expect(models.map((m) => m.options.map((o) => o.url))).toEqual([
      ['https://example.org/buildings.glb'],
      ['https://example.org/map.glb', 'https://example.org/roads.glb'],
    ]);
    expect(models[0].position).toEqual([1, 2, 3]);
    expect(models[1].position).toEqual([0, 0, 0]);
    expect(labelIn(models[1].label, 'en')).toBe('Ground');
  });

  it('skips Choice items that are not Models, and drops an empty Choice', () => {
    const s = {
      items: [{ items: [{ id: 'a', motivation: 'painting', body: { type: 'Choice', items: [{ type: 'Image', id: 'x.jpg' }] } }] }],
    } as unknown as SceneV4;
    expect(paintedModelsOf(s)).toEqual([]);
  });
});

describe('chosenUrl', () => {
  it('shows the first option unless another is chosen', () => {
    const ground = paintedModelsOf(scene)[1];
    expect(chosenUrl(ground, {})).toBe('https://example.org/map.glb');
    expect(chosenUrl(ground, { [ground.id]: 1 })).toBe('https://example.org/roads.glb');
    expect(chosenUrl(ground, { [ground.id]: 9 })).toBe('https://example.org/map.glb');
  });
});

describe('upgradeUrl', () => {
  const progressive = {
    items: [
      {
        items: [
          {
            id: 'p',
            motivation: ['painting'],
            body: {
              type: 'Choice',
              behavior: ['progressive'],
              items: [
                { id: 'light.glb', type: 'Model' },
                { id: 'mid.glb', type: 'Model' },
                { id: 'full.glb', type: 'Model' },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as SceneV4;

  it('upgrades a progressive Choice to its last option until the user switches by hand', () => {
    const m = paintedModelsOf(progressive)[0];
    expect(m.progressive).toBe(true);
    expect(chosenUrl(m, {})).toBe('light.glb');
    expect(upgradeUrl(m, {})).toBe('full.glb');
    expect(upgradeUrl(m, { p: 0 })).toBeNull();
  });

  it('leaves a plain Choice (different contents) to the user', () => {
    const ground = paintedModelsOf(scene)[1];
    expect(ground.progressive).toBe(false);
    expect(upgradeUrl(ground, {})).toBeNull();
  });
});

describe('labelIn', () => {
  it('prefers the locale, then none, then any language', () => {
    expect(labelIn({ ja: ['道'], en: ['Streets'] }, 'ja')).toBe('道');
    expect(labelIn({ en: ['Streets'] }, 'ja')).toBe('Streets');
    expect(labelIn({ none: ['1934'], en: ['x'] }, 'ja')).toBe('1934');
    expect(labelIn('plain', 'en')).toBe('plain');
  });

  it('follows the locale, then none, then en, then the first language', () => {
    const map = { ja: ['上野駅'], en: ['Ueno Station'] };
    expect(labelIn(map, 'en')).toBe('Ueno Station');
    expect(labelIn(map, 'ja')).toBe('上野駅');
    expect(labelIn({ fr: ['Gare'], en: ['Station'] }, 'ja')).toBe('Station');
    expect(labelIn({ fr: ['Gare'], de: ['Bahnhof'] }, 'ja')).toBe('Gare');
    expect(labelIn({ none: ['1'], en: ['x'] }, 'en')).toBe('x');
    expect(labelIn(undefined, 'en')).toBe('');
  });

  it('gives the annotation titles of a Scene in the locale asked for', () => {
    const manifest = {
      items: [
        {
          id: 'https://example.org/s',
          type: 'Scene',
          annotations: [
            {
              type: 'AnnotationPage',
              items: [
                {
                  id: 'https://example.org/a1',
                  type: 'Annotation',
                  motivation: 'commenting',
                  label: { ja: ['上野駅'], en: ['Ueno Station'] },
                  body: { type: 'TextualBody', value: '' },
                  target: { type: 'SpecificResource', source: 'https://example.org/s', selector: [{ type: 'PointSelector', x: 1, y: 2, z: 3 }] },
                },
              ],
            },
          ],
        },
      ],
    } as never;
    expect(parseManifestV4(manifest, undefined, 'en').annotations[0].title).toBe('Ueno Station');
    expect(parseManifestV4(manifest, undefined, 'ja').annotations[0].title).toBe('上野駅');
  });
});

describe('parseManifestV4 modelUrl', () => {
  it('falls back to the first option when the first painted body is a Choice', () => {
    const choiceFirst = { ...scene, items: [{ type: 'AnnotationPage', items: [scene.items![0].items[1]] }] };
    const parsed = parseManifestV4({ '@context': '', id: 'm', type: 'Manifest', items: [choiceFirst] } as never);
    expect(parsed.modelUrl).toBe('https://example.org/map.glb');
  });
});
