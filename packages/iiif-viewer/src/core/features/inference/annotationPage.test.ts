import { describe, expect, it } from 'vitest';
import { readCanvasAnnotations } from '../annotations';
import { annotationKindOf } from '../annotationKinds';
import { canvasAnnotationTags } from '../annotationSearch';
import { annotationPlainText, searchLocalAnnotations } from '../contentSearch/local';
import { toAnnotationPage } from './annotationPage';

const canvasId = 'https://example.org/c1';
let n = 0;
const page = toAnnotationPage(
  {
    kind: 'lines',
    imageWidth: 100,
    imageHeight: 100,
    items: [
      { x: 0, y: 0, w: 10, h: 40, score: 1, label: 'line_main', text: 'main text' },
      { x: 20, y: 0, w: 10, h: 40, score: 1, text: 'no class' },
      { x: 40, y: 0, w: 30, h: 30, score: 1, label: 'block_fig' },
    ],
  },
  {
    canvasId,
    map: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    newId: () => `urn:test:${++n}`,
    generator: { id: 'https://example.org/m', name: 'M' },
  },
);
const items = page.items as Record<string, unknown>[];
const annos = readCanvasAnnotations(canvasId, [page]);

describe('toAnnotationPage: kinds and classes', () => {
  it('writes a read line with a class as supplementing with the text and a tagging body', () => {
    expect(items[0]).toMatchObject({
      motivation: 'supplementing',
      textGranularity: 'line',
      body: [
        { type: 'TextualBody', value: 'main text' },
        { type: 'TextualBody', value: 'line_main', purpose: 'tagging' },
      ],
    });
  });

  it('keeps a single text body for a read line without a class (the shape it always had)', () => {
    expect(items[1]).toMatchObject({ motivation: 'supplementing', body: { value: 'no class' } });
    expect(Array.isArray(items[1].body)).toBe(false);
  });

  it('writes a region with only a class as tagging', () => {
    expect(items[2]).toMatchObject({ motivation: 'tagging', body: { value: 'block_fig', purpose: 'tagging' } });
  });

  it('reads back as kinds and tags the viewer filters by', () => {
    expect(annos.map(annotationKindOf)).toEqual(['supplementing', 'supplementing', 'tagging']);
    expect(annos.map((a) => canvasAnnotationTags(a, 'en'))).toEqual([['line_main'], [], ['block_fig']]);
    expect(annos[0].granularity).toBe('line');
  });

  it('leaves the class out of the text: a search for the class name finds nothing', () => {
    expect(annotationPlainText(annos[0])).toBe('main text');
    expect(searchLocalAnnotations([{ canvasId, annotations: annos }], 'line_main')).toEqual([]);
    expect(searchLocalAnnotations([{ canvasId, annotations: annos }], 'main text')).toHaveLength(1);
  });
});
