import { describe, expect, it } from 'vitest';
import { CLASS_PALETTE, toAnnotationPage } from './annotationPage';
import { pageMarksOf } from './pageMarks';

let n = 0;
const newId = () => `urn:test:${++n}`;
const map = { x: 0, y: 0, scaleX: 2, scaleY: 2 };
const opts = { canvasId: 'https://example.org/c1', map, newId, generator: { id: 'https://example.org/m', name: 'M' } };

describe('pageMarksOf', () => {
  it('reads back boxes, class colors and tags from toAnnotationPage', () => {
    const page = toAnnotationPage(
      {
        kind: 'lines',
        imageWidth: 100,
        imageHeight: 100,
        classes: ['text_block', 'line_main'],
        items: [
          { x: 1, y: 2, w: 3, h: 4, score: 1, label: 'text_block' },
          { x: 5, y: 6, w: 7, h: 8, score: 1, label: 'line_main', text: 'あ' },
          { x: 0, y: 0, w: 1, h: 1, score: 1, text: 'plain' },
        ],
      },
      opts,
    );
    const marks = pageMarksOf(page);
    expect(marks).toEqual([
      { x: 2, y: 4, w: 6, h: 8, color: CLASS_PALETTE[0], tag: 'text_block', text: false },
      { x: 10, y: 12, w: 14, h: 16, color: CLASS_PALETTE[1], text: true },
      { x: 0, y: 0, w: 2, h: 2, color: CLASS_PALETTE[0], text: true },
    ]);
  });

  it('reads polygons with their bounding box', () => {
    const page = toAnnotationPage(
      { kind: 'regions', imageWidth: 100, imageHeight: 100, items: [{ x: 0, y: 0, w: 4, h: 4, score: 1, label: 'face', polygon: [[0, 0], [4, 0], [2, 4]] }] },
      opts,
    );
    const [m] = pageMarksOf(page);
    expect(m.points).toEqual([[0, 0], [8, 0], [4, 8]]);
    expect([m.x, m.y, m.w, m.h]).toEqual([0, 0, 8, 8]);
    expect(m.tag).toBe('face');
  });

  it('skips targets without a region and pages without items', () => {
    expect(pageMarksOf(undefined)).toEqual([]);
    expect(pageMarksOf({ items: [{ target: 'https://example.org/c1' }] })).toEqual([]);
  });
});
