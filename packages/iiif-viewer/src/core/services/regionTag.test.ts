import { describe, expect, it } from 'vitest';
import plainSample from '../../../../../public/manifests/sample-manifest-with-annotations.json';
import extensionSample from '../../../../../public/manifests/sample-manifest-region-tags.json';
import { convertToV4 } from './manifestConverter';
import { parseManifestV4 } from './manifestParser';
import { groupByRegion } from '../regions';
import { otherBodies } from '../features/annotationBody';

const load = (manifest: unknown) => parseManifestV4(convertToV4(manifest));

// Manifests without the extension must look exactly as before.
describe('manifests without the extension', () => {
  it('reads the plain v4 sample: one annotation per marker, no tags', () => {
    const { annotations } = load(plainSample);
    expect(annotations.map((a) => a.title)).toEqual(['北海', 'イギリス', 'フランス']);
    expect(groupByRegion(annotations)).toHaveLength(3);
    for (const a of annotations) {
      expect(a.regionId).toBeUndefined();
      expect(a.tags).toBeUndefined();
      expect(a.creator).toBe('');
    }
  });

  it('keeps the camera of each annotation in the plain v4 sample', () => {
    const [northSea] = load(plainSample).annotations;
    expect(northSea.data.target.selector.camPos).not.toEqual([
      northSea.position.x,
      northSea.position.y,
      northSea.position.z,
    ]);
  });

  it('reads a legacy v3 manifest with 3DSelector and camPos', () => {
    const legacy = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://example.org/legacy',
      type: 'Manifest',
      items: [{
        id: 'https://example.org/legacy/canvas/1',
        type: 'Canvas',
        annotations: [{
          type: 'AnnotationPage',
          items: [{
            id: 'https://example.org/legacy/anno/1',
            type: 'Annotation',
            motivation: 'commenting',
            body: { type: 'TextualBody', value: '<p>text</p>', label: 'Point' },
            target: {
              source: 'https://example.org/legacy/canvas/1',
              selector: { type: '3DSelector', value: [1, 2, 3], camPos: [4, 5, 6] },
            },
          }],
        }],
      }],
    };
    const [anno] = load(legacy).annotations;
    expect(anno.title).toBe('Point');
    expect(anno.description).toBe('<p>text</p>');
    expect(anno.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(anno.data.target.selector.camPos).toEqual([4, 5, 6]);
    expect(anno.regionId).toBeUndefined();
  });
});

describe('Shared Region extension', () => {
  it('treats a manifest that declares the extension context as v4', () => {
    expect(extensionSample['@context']).toEqual([
      'https://nakamura196.github.io/iiif-region-tag-extension/context.json',
      'http://iiif.io/api/presentation/4/context.json',
    ]);
    // v4 input is returned untouched, not run through the v3 converter.
    expect(convertToV4(extensionSample)).toBe(extensionSample);
  });

  it('groups annotations that share a target id, in document order', () => {
    const groups = groupByRegion(load(extensionSample).annotations);
    expect(groups.map((g) => g.annotations.map((a) => a.id.split('#')[1]))).toEqual([
      ['anno-uk-1', 'anno-uk-2'],
      ['anno-area'],
      ['anno-north-sea'],
    ]);
  });

  it('does not group annotations that only share coordinates', () => {
    const [a, b] = load(extensionSample).annotations;
    expect(a.position).toEqual(b.position);
    expect(groupByRegion([{ ...a, regionId: 'r1' }, { ...b, regionId: 'r2' }])).toHaveLength(2);
  });

  it('reads the Presentation 4 WktSelector', () => {
    const area = load(extensionSample).annotations.find((a) => a.id.endsWith('#anno-area'));
    expect(area?.data.target.selector.type).toBe('WKTSelector');
    expect(Number.isFinite(area?.position.x)).toBe(true);
  });

  it('reads W3C creator as the creator name', () => {
    const [first] = load(extensionSample).annotations;
    expect(first.creator).toBe('Example Annotator 1');
  });
});

describe('Keyed Tag extension', () => {
  const second = () => load(extensionSample).annotations.find((a) => a.id.endsWith('#anno-uk-2'));

  it('takes title and description from the first non-tagging body', () => {
    expect(second()?.title).toBe('イギリス（別の注釈者による例）');
    expect(second()?.description).toContain('second annotation');
  });

  it('reads tagging bodies as tags, with the label as the key', () => {
    expect(second()?.tags).toEqual([
      { key: 'region', value: 'Europe' },
      { key: 'place type', value: 'country name' },
      { value: 'example' },
    ]);
  });
});

// A second text and a link after the description: kept, so the card can show them (otherBodies).
describe('bodies after the description', () => {
  const withMore = () => {
    const m = structuredClone(extensionSample) as typeof extensionSample;
    const anno = m.items[0].annotations[0].items[1] as { body: unknown[] };
    anno.body.push(
      { type: 'TextualBody', format: 'text/plain', value: 'Also called Britain.' },
      { type: 'SpecificResource', source: { id: 'http://www.wikidata.org/entity/Q145', type: 'Dataset' } },
    );
    return load(m).annotations.find((a) => a.id.endsWith('#anno-uk-2'));
  };

  it('keeps the description, the tags and every other body', () => {
    const a = withMore();
    expect(a?.description).toContain('second annotation');
    expect(a?.tags).toHaveLength(3);
    expect(otherBodies(a?.bodies ?? []).map((b) => b.value ?? b.url)).toEqual([
      'Also called Britain.',
      'http://www.wikidata.org/entity/Q145',
    ]);
  });

  it('has no other bodies when there is only a description and tags', () => {
    const a = load(extensionSample).annotations.find((x) => x.id.endsWith('#anno-uk-2'));
    expect(otherBodies(a?.bodies ?? [])).toEqual([]);
  });
});

// The shape 3D-annotation-viewer exports today (Presentation 3): target.id,
// PointSelector / PolygonZSelector objects, and a plain-string body label.
describe('3D-annotation-viewer export (v3)', () => {
  const region = 'https://example.org/iiif/1/region/r1';
  const anno = (id: string, body: unknown, selector: unknown) => ({
    id: `https://example.org/iiif/1/annotation/${id}`,
    type: 'Annotation',
    motivation: Array.isArray(body) ? ['commenting', 'tagging'] : 'commenting',
    body,
    target: {
      id: region,
      type: 'SpecificResource',
      source: { id: 'https://example.org/iiif/1/canvas/p1', type: 'Scene' },
      selector,
    },
  });
  const point = { type: 'PointSelector', x: 0.1, y: 0.2, z: 0.3 };
  const manifest = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: 'https://example.org/iiif/1/manifest',
    type: 'Manifest',
    items: [{
      id: 'https://example.org/iiif/1/canvas/p1',
      type: 'Canvas',
      annotations: [{
        type: 'AnnotationPage',
        items: [
          anno('a', { type: 'TextualBody', value: '', label: 'A' }, point),
          anno('b', [
            { type: 'TextualBody', value: '<p>B</p>', label: 'B' },
            { type: 'TextualBody', value: 'v', purpose: 'tagging', label: { none: ['k'] } },
          ], point),
          {
            ...anno('c', { type: 'TextualBody', value: '', label: 'C' }, {
              type: 'PolygonZSelector',
              value: 'POLYGONZ((0 0 0, 1 0 0, 1 1 0, 0 0 0))',
            }),
            target: {
              id: 'https://example.org/iiif/1/region/r2',
              type: 'SpecificResource',
              source: { id: 'https://example.org/iiif/1/canvas/p1', type: 'Scene' },
              selector: { type: 'PolygonZSelector', value: 'POLYGONZ((0 0 0, 1 0 0, 1 1 0, 0 0 0))' },
            },
          },
        ],
      }],
    }],
  };

  it('keeps target.id through the v3 -> v4 conversion and groups by it', () => {
    const { annotations } = load(manifest);
    expect(annotations.map((a) => a.title)).toEqual(['A', 'B', 'C']);
    expect(groupByRegion(annotations).map((g) => g.annotations.length)).toEqual([2, 1]);
  });

  it('reads tags and the polygon', () => {
    const [, b, c] = load(manifest).annotations;
    expect(b.tags).toEqual([{ key: 'k', value: 'v' }]);
    expect(c.data.target.selector.type).toBe('WKTSelector');
    expect(Number.isFinite(c.position.x)).toBe(true);
  });
});
