import { describe, expect, it } from 'vitest';
import { focusBoxOf } from './annotationSearch';
import { annotationsOfSelection, readCanvasAnnotations, selectedHitOf, selectionKeyOf } from './annotations';
import { contentSearchAnnotationPage } from './contentSearch';

const C = 'https://example.org/c/1';
const page = (items: unknown[]) => ({ type: 'AnnotationPage', id: `${C}#p`, items });
const note = (id: string, xywh: string) => ({
  id,
  type: 'Annotation',
  motivation: 'commenting',
  body: { type: 'TextualBody', value: id },
  target: `${C}#xywh=${xywh}`,
});

describe('selection of the marks of a search hit', () => {
  const hit = {
    id: 'hit/1',
    canvasId: C,
    match: 'blue bird',
    regions: [
      { annotationId: 'w1', canvasId: C, xywh: [200, 300, 40, 18] as [number, number, number, number], text: 'blue' },
      { annotationId: 'w2', canvasId: C, xywh: [60, 320, 38, 18] as [number, number, number, number], text: 'bird' },
    ],
  };
  const hitPage = contentSearchAnnotationPage(C, [hit]);
  const marks = readCanvasAnnotations(C, [hitPage], { width: 1000, height: 800 }, undefined, { hitIds: true });

  it('reads the hit id of every mark', () => {
    expect(marks.map((a) => a.hitId)).toEqual(['hit/1', 'hit/1']);
  });

  it('ignores a hitId in pages that did not come from the Content Search panel', () => {
    const outside = readCanvasAnnotations(C, [hitPage], { width: 1000, height: 800 });
    expect(outside.map((a) => a.hitId)).toEqual([undefined, undefined]);
  });

  it('selects the whole hit from any one of its marks', () => {
    const second = marks[1].id;
    expect(selectedHitOf(second, marks)).toBe('hit/1');
    expect(annotationsOfSelection(marks, selectedHitOf(second, marks))).toHaveLength(2);
    // the list moves to the whole hit too
    expect(focusBoxOf(annotationsOfSelection(marks, 'hit/1').map((a) => a.region), { width: 1000, height: 800 })).toEqual(
      focusBoxOf({ type: 'rect', x: 60, y: 300, w: 180, h: 38 }, { width: 1000, height: 800 }),
    );
  });

  it('keeps all the marks of the selected hit even when others are filtered out', () => {
    const others = readCanvasAnnotations(C, [page([note('n/1', '0,0,10,10')])], { width: 1000, height: 800 });
    expect(annotationsOfSelection([...others, ...marks], 'hit/1').map((a) => a.id)).toEqual(marks.map((a) => a.id));
  });

  it('falls back to the selected id when no mark of it is on this Canvas', () => {
    expect(selectedHitOf('hit/9', marks)).toBe('hit/9');
    expect(selectedHitOf(null, marks)).toBeNull();
  });
});

describe('selection of ordinary annotations', () => {
  it('does not select `anno/7#1` together with `anno/7` (ids are not parsed)', () => {
    const list = readCanvasAnnotations(C, [page([note('anno/7', '0,0,10,10'), note('anno/7#1', '50,0,10,10')])], {
      width: 1000,
      height: 800,
    });
    expect(list.map(selectionKeyOf)).toEqual(['anno/7', 'anno/7#1']);
    expect(annotationsOfSelection(list, selectedHitOf('anno/7', list)).map((a) => a.id)).toEqual(['anno/7']);
  });
});
