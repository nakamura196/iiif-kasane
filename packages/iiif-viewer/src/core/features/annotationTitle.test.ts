import { describe, expect, it } from 'vitest';
import { convertToV4 } from '../services/manifestConverter';
import { annotationSearchText } from './annotationSearch';
import { embeddedCanvasAnnotations } from './annotations';
import { groupByRegion } from '../regions';

// The shape the 3D annotation editor writes for an image: the heading is a plain string on the
// TextualBody, the text may be empty, and annotations of one place share the target id.
const canvasId = 'https://example.org/canvas/1';
const anno = (id: string, region: string, body: unknown, extra: Record<string, unknown> = {}) => ({
  id: `https://example.org/anno/${id}`,
  type: 'Annotation',
  motivation: 'commenting',
  body,
  target: {
    type: 'SpecificResource',
    id: `https://example.org/region/${region}`,
    source: canvasId,
    selector: { type: 'FragmentSelector', value: 'xywh=10,20,30,40' },
  },
  ...extra,
});
const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: 'https://example.org/manifest',
  type: 'Manifest',
  label: { none: ['test'] },
  items: [
    {
      id: canvasId,
      type: 'Canvas',
      width: 100,
      height: 100,
      items: [],
      annotations: [
        {
          id: 'https://example.org/page/1',
          type: 'AnnotationPage',
          items: [
            anno('a', 'r1', { type: 'TextualBody', format: 'text/html', value: '', label: 'Hand' }),
            anno('b', 'r1', { type: 'TextualBody', format: 'text/html', value: '<p>About the actor.</p>', label: 'Actor' }),
            anno('c', 'r2', [
              { type: 'TextualBody', format: 'text/html', value: '<p>A boy.</p>', label: 'Boy' },
              { type: 'TextualBody', value: 'Tunic', purpose: 'tagging', label: { none: ['Clothing'] } },
            ]),
            anno('d', 'r3', { type: 'TextualBody', value: 'Text', label: 'Body label' }, { label: { en: ['Own label'] } }),
          ],
        },
      ],
    },
  ],
};

const annos = () => {
  const m = convertToV4(manifest);
  const c = m.items[0] as unknown as { id: string; width: number; height: number };
  return embeddedCanvasAnnotations(m, c.id, c);
};

describe('annotation headings (body label)', () => {
  it('reads the body label as the heading, also when the text is empty', () => {
    const list = annos();
    const byId = (id: string) => list.find((a) => a.id.endsWith(`/${id}`))!;
    expect(byId('a').title).toBe('Hand');
    expect(byId('a').bodies).toHaveLength(0);
    expect(byId('b').title).toBe('Actor');
    expect(byId('c').title).toBe('Boy');
  });

  it("prefers the annotation's own label", () => {
    expect(annos().find((a) => a.id.endsWith('/d'))!.title).toEqual({ en: ['Own label'] });
  });

  it('keeps the key of a tag', () => {
    const tag = annos().find((a) => a.id.endsWith('/c'))!.bodies.find((b) => b.tagging)!;
    expect(tag.value).toBe('Tunic');
    expect(tag.label).toEqual({ none: ['Clothing'] });
  });

  it('keeps grouping the annotations of one place', () => {
    expect(groupByRegion(annos()).map((g) => g.annotations.length)).toEqual([2, 1, 1]);
  });

  it('finds an annotation by its heading and by a tag key', () => {
    const list = annos();
    expect(annotationSearchText(list.find((a) => a.id.endsWith('/a'))!)).toContain('hand');
    expect(annotationSearchText(list.find((a) => a.id.endsWith('/c'))!)).toContain('clothing');
  });
});
