import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../types/main';
import { contentSearchTargetOf, runContentSearch } from './index';
import { findSceneAnnotation, highlightParts, isSceneMatch, searchSceneAnnotations } from './scene';

const SCENE = 'https://example.org/ueno.json#scene';

// ueno.json の commenting 注釈と同じ形（source は配列、selector は PointSelector）
const hit = (id: string, value: string, [x, y, z]: number[]) => ({
  id,
  type: 'Annotation',
  motivation: ['commenting'],
  body: { type: 'TextualBody', format: 'text/plain', value },
  target: { type: 'SpecificResource', source: [{ id: SCENE, type: 'Scene' }], selector: [{ type: 'PointSelector', x, y, z }] },
});

const anno = (id: string, title: string, description: string, x: number, y: number, z: number): Annotation =>
  ({ id, title, description, position: { x, y, z } }) as unknown as Annotation;

const ANNOS = [
  anno('https://example.org/ueno.json#building-1', '上野警察署上野駅前交番', '高さ 7.1 m', -46.88, 6.66, -28.41),
  anno('https://example.org/ueno.json#building-2', '国立科学博物館', '高さ 20 m / Height 20 m', 10, 3.5, 4),
];

const page = (items: unknown[]) => ({ '@context': 'http://iiif.io/api/search/2/context.json', id: 'x', type: 'AnnotationPage', items });

describe('contentSearchTargetOf (Scene)', () => {
  it('keeps the Scene id with its fragment and reads the PointSelector', () => {
    expect(contentSearchTargetOf(hit('a', 'b', [1, 2, 3]).target)).toEqual({ canvasId: SCENE, point: [1, 2, 3] });
  });

  it('still cuts the fragment of a Canvas target', () => {
    expect(
      contentSearchTargetOf({ type: 'SpecificResource', source: { id: 'https://e.org/c1#xywh=1,2,3,4', type: 'Canvas' } }),
    ).toEqual({ canvasId: 'https://e.org/c1', xywh: [1, 2, 3, 4] });
  });
});

describe('Scene hits', () => {
  const run = async (items: unknown[]) =>
    (await runContentSearch({ id: 'https://s.example/search' }, '上野', async () => page(items))).matches;

  it('lists hits on the Scene and marks them as scene matches', async () => {
    const matches = await run([hit(ANNOS[0].id, '高さ 7.1 m', [-46.88, 6.66, -28.41])]);
    expect(matches).toHaveLength(1);
    expect(matches[0].canvasId).toBe(SCENE);
    expect(matches[0].regions[0].point).toEqual([-46.88, 6.66, -28.41]);
    expect(isSceneMatch(matches[0])).toBe(true);
  });

  it('matches by annotation id first', async () => {
    // 座標が違っても、id が同じならその注釈
    const [m] = await run([hit(ANNOS[1].id, 'x', [-46.88, 6.66, -28.41])]);
    expect(findSceneAnnotation(m, ANNOS)?.id).toBe(ANNOS[1].id);
  });

  it('falls back to the same PointSelector when the service returns new ids', async () => {
    const [m] = await run([hit('https://s.example/hit/1', 'x', [10, 3.5, 4])]);
    expect(findSceneAnnotation(m, ANNOS)?.id).toBe(ANNOS[1].id);
  });

  it('returns undefined when neither id nor point matches', async () => {
    const [m] = await run([hit('https://s.example/hit/2', 'x', [0, 0, 0])]);
    expect(findSceneAnnotation(m, ANNOS)).toBeUndefined();
  });

  it('does not treat Canvas hits as scene matches', async () => {
    const [m] = await run([
      { id: 'https://e.org/a1', type: 'Annotation', body: { type: 'TextualBody', value: 'v' }, target: 'https://e.org/c1#xywh=1,2,3,4' },
    ]);
    expect(isSceneMatch(m)).toBe(false);
  });
});

describe('searchSceneAnnotations (local)', () => {
  it('searches titles and descriptions, ignoring case and width', () => {
    const ms = searchSceneAnnotations(ANNOS, SCENE, 'height');
    expect(ms.map((m) => m.id)).toEqual([ANNOS[1].id]); // 'Height' は 2 件目の本文にだけある
    const ms2 = searchSceneAnnotations(ANNOS, SCENE, 'ＨＥＩＧＨＴ');
    expect(ms2.map((m) => m.id)).toEqual([ANNOS[1].id]);
    expect(isSceneMatch(ms2[0])).toBe(true);
    expect(findSceneAnnotation(ms2[0], ANNOS)?.id).toBe(ANNOS[1].id);
  });

  it('finds a title hit', () => {
    const [m] = searchSceneAnnotations(ANNOS, SCENE, '交番');
    expect(m.match).toBe('交番');
    expect(m.canvasId).toBe(SCENE);
  });

  it('returns nothing for an empty query', () => {
    expect(searchSceneAnnotations(ANNOS, SCENE, '  ')).toEqual([]);
  });
});

describe('highlightParts', () => {
  it('marks only the terms that occur', () => {
    expect(highlightParts('上野警察署上野駅前交番', '上野')).toEqual([
      { text: '上野', hit: true },
      { text: '警察署', hit: false },
      { text: '上野', hit: true },
      { text: '駅前交番', hit: false },
    ]);
  });

  it('leaves a text without the term unmarked', () => {
    expect(highlightParts('高さ 7.1 m', '上野')).toEqual([{ text: '高さ 7.1 m', hit: false }]);
  });

  it('ignores case and width, and handles several terms', () => {
    expect(highlightParts('Height 20 m', 'ｈｅｉｇｈｔ m').map((p) => p.hit)).toEqual([true, false, true]);
  });
});

describe('hit label', () => {
  it('keeps the label of a Scene hit', async () => {
    const h = { ...hit('https://s.example/h', 'body', [1, 2, 3]), label: { ja: ['上野駅'], en: ['Ueno Station'] } };
    const r = await runContentSearch({ id: 'https://s.example/search' }, '上野', async () => page([h]));
    expect(r.matches[0].regions[0].label).toEqual({ ja: ['上野駅'], en: ['Ueno Station'] });
  });

  it('puts the description in the local hit body so the title stays the main line', () => {
    const [m] = searchSceneAnnotations(ANNOS, SCENE, '交番');
    expect(m.regions[0].text).toBe('高さ 7.1 m');
  });
});
