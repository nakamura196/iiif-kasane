import { describe, expect, it } from 'vitest';
import { readAnnotationBodies, otherBodies, mainTextBody } from './annotationBody';
import { readAnnotationResources, isUnresolvableEditorId } from './annotationResources';
import { embeddedCanvasAnnotations } from './annotations';
import { convertToV4 } from '../services/manifestConverter';
import { parseManifestV4 } from '../services/manifestParser';
import { annotationSearchText } from './annotationSearch';

// Synthetic items in the shape the 3D annotation editor writes (no real manifest).
const BASE = 'https://editor.example.org/api/1/abc/manifest';
const UUID = '0a1b2c3d-1111-2222-3333-444455556666';
const seeAlso = [
  { id: `${BASE}/media/${UUID}`, type: 'Image', label: { en: ['dog relief'] }, format: 'image/jpeg', source: 'https://img.example.org/dog.jpg' },
  { id: 'https://en.wikipedia.org/wiki/Dog', type: 'Text', label: { en: ['Wikipedia: イヌ'] }, format: 'text/html' },
  { id: 'https://www.wikidata.org/wiki/Q144', type: 'Dataset', label: { en: ['イヌ'] }, format: 'application/ld+json' },
  { id: `${BASE}/bibliography/${UUID}`, type: 'Text', label: { en: ['Author, A. (2003). A book. Publisher.'] }, format: 'text/plain' },
  { id: 'https://example.org/page', type: 'Text', label: { en: ['A page'] }, format: 'text/html' },
];

describe('readAnnotationResources: editor seeAlso', () => {
  const r = readAnnotationResources([], seeAlso);
  it('classifies each item', () => {
    expect(r.map((x) => [x.kind, x.role])).toEqual([
      ['image', 'place'],
      ['wikidata', 'identifying'],
      ['wikipedia', 'related'],
      ['web', 'related'],
      ['citation', 'related'],
    ]);
  });
  it('uses the real image (source), not the id that does not resolve', () => {
    expect(r[0].url).toBe('https://img.example.org/dog.jpg');
  });
  it('gives a bibliography as text without an address', () => {
    const c = r.find((x) => x.kind === 'citation')!;
    expect(c.url).toBeUndefined();
    expect(c.label).toEqual({ en: ['Author, A. (2003). A book. Publisher.'] });
  });
  it('drops an editor image without a source and ignores unresolvable ids', () => {
    expect(readAnnotationResources([], [{ id: `${BASE}/media/${UUID}`, type: 'Image' }])).toEqual([]);
    expect(isUnresolvableEditorId(`${BASE}/media/${UUID}`)).toBe(true);
    expect(isUnresolvableEditorId('https://example.org/media/photo')).toBe(false);
  });
  it('accepts a seeAlso of plain URL strings', () => {
    expect(readAnnotationResources([], ['https://example.org/x'])[0]).toMatchObject({ kind: 'web', url: 'https://example.org/x' });
  });
});

describe('readAnnotationResources: bodies with a purpose', () => {
  const body = [
    { type: 'TextualBody', value: '<p>text</p>', format: 'text/html' },
    { id: 'https://img.example.org/a.jpg', type: 'Image', purpose: 'describing', label: { en: ['place'] }, service: [{ id: 'https://img.example.org/a', type: 'ImageService3' }] },
    { id: 'https://img.example.org/b.jpg', type: 'Image', purpose: 'linking', label: { en: ['comparable'] } },
    { id: 'http://www.wikidata.org/entity/Q144', type: 'Dataset', purpose: 'identifying' },
    { id: 'https://en.wikipedia.org/wiki/Dog', type: 'Text', purpose: 'linking' },
  ];
  const bodies = readAnnotationBodies({ body, motivation: 'commenting' });
  const r = readAnnotationResources(bodies);
  it('gives the same classes as the seeAlso form', () => {
    expect(r.map((x) => [x.kind, x.role])).toEqual([
      ['image', 'place'],
      ['wikidata', 'identifying'],
      ['image', 'related'],
      ['wikipedia', 'related'],
    ]);
    expect(r[0].service).toBe('https://img.example.org/a');
  });
  it('keeps them out of the description and the other bodies', () => {
    expect(mainTextBody(bodies)?.value).toBe('<p>text</p>');
    expect(otherBodies(bodies)).toEqual([]);
  });
  it('merges the two forms without duplicates', () => {
    const both = readAnnotationResources(bodies, [{ id: 'https://en.wikipedia.org/wiki/Dog', type: 'Text', format: 'text/html' }]);
    expect(both.filter((x) => x.kind === 'wikipedia')).toHaveLength(1);
  });
});

describe('where the resources appear', () => {
  const annotation = {
    id: 'https://example.org/a1',
    type: 'Annotation',
    motivation: 'commenting',
    label: 'aaa',
    body: { type: 'TextualBody', value: '', format: 'text/html' },
    target: { type: 'SpecificResource', id: 'https://example.org/region/1', source: 'https://example.org/c1', selector: { type: 'FragmentSelector', value: 'xywh=1,2,30,40' } },
    seeAlso,
  };
  it('2D: reads seeAlso into resources even when the body is empty', () => {
    const manifest = convertToV4({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://example.org/m',
      type: 'Manifest',
      label: { en: ['m'] },
      items: [{ id: 'https://example.org/c1', type: 'Canvas', width: 100, height: 100, items: [], annotations: [{ id: 'https://example.org/p', type: 'AnnotationPage', items: [annotation] }] }],
    });
    const list = embeddedCanvasAnnotations(manifest, 'https://example.org/c1', { width: 100, height: 100 });
    expect(list).toHaveLength(1);
    expect(list[0].resources).toHaveLength(5);
    expect(annotationSearchText(list[0])).toContain('イヌ');
  });
  it('3D: the parsed annotation carries the same resources', () => {
    const scene = {
      '@context': 'http://iiif.io/api/presentation/4/context.json',
      id: 'https://example.org/m3',
      type: 'Manifest',
      label: { en: ['m'] },
      items: [{
        id: 'https://example.org/s1', type: 'Scene',
        items: [{ id: 'https://example.org/ap', type: 'AnnotationPage', items: [] }],
        annotations: [{ id: 'https://example.org/ap2', type: 'AnnotationPage', items: [{
          ...annotation,
          target: { type: 'SpecificResource', id: 'https://example.org/region/2', source: { id: 'https://example.org/s1', type: 'Scene' }, selector: [{ type: 'PointSelector', x: 1, y: 2, z: 3 }] },
        }] }],
      }],
    };
    const parsed = parseManifestV4(scene as never, null, 'en');
    const a = parsed.annotations?.[0];
    expect(a?.resources?.map((x) => x.kind)).toEqual(['image', 'wikidata', 'wikipedia', 'web', 'citation']);
  });
});
