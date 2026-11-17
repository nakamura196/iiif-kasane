import { describe, expect, it } from 'vitest';
import { convertToV4 } from './manifestConverter';
import { geoAnnotations, geoCanvasesOf, geoFeatureIdOf, parseManifestV4 } from './manifestParser';

// 画像（Canvas）に付いたジオリファレンス。geo.ldas.jp/manifest.json と同じ形（地点 2 件に縮めたもの）。
const feature = (n: number, xy: [number, number], lnglat: [number, number]) => ({
  type: 'Feature',
  id: `gcp-${n}`,
  '@id': `https://example.org/places/gcp-${n}`,
  properties: { resourceCoords: xy, title: `GCP ${n}` },
  geometry: { type: 'Point', coordinates: lnglat },
});

const imageManifest = {
  '@context': ['http://iiif.io/api/extension/georef/1/context.json', 'http://iiif.io/api/presentation/3/context.json'],
  id: 'https://example.org/iiif/manifest',
  type: 'Manifest',
  label: { ja: ['絵図'] },
  items: [
    {
      id: 'https://example.org/iiif/canvas/1',
      type: 'Canvas',
      width: 18415,
      height: 12911,
      items: [
        {
          id: 'https://example.org/iiif/canvas/1/page',
          type: 'AnnotationPage',
          items: [
            {
              id: 'https://example.org/iiif/canvas/1/page/1',
              type: 'Annotation',
              motivation: 'painting',
              body: { id: 'https://example.org/iiif/image/full/max/0/default.jpg', type: 'Image', width: 18415, height: 12911 },
              target: 'https://example.org/iiif/canvas/1',
            },
          ],
        },
      ],
      annotations: [
        {
          id: 'https://example.org/iiif/canvas/1/georef',
          type: 'AnnotationPage',
          items: [
            {
              id: 'https://example.org/iiif/canvas/1/georef/1',
              type: 'Annotation',
              motivation: 'georeferencing',
              target: 'https://example.org/iiif/canvas/1',
              body: {
                type: 'FeatureCollection',
                transformation: { type: 'polynomial', options: { order: 1 } },
                features: [feature(1, [6690, 7517], [139.7623182, 35.7151233]), feature(2, [100, 200], [139.75, 35.7])],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('georeferencing on a Canvas (a georeferenced picture)', () => {
  const parsed = parseManifestV4(convertToV4(imageManifest));

  it('reads the places of the Canvas and names the Canvas', () => {
    expect(parsed.modelUrl).toBeNull();
    expect(parsed.geoCanvasId).toBe('https://example.org/iiif/canvas/1');
    expect(parsed.geoFeatures.map((f) => f.properties.title)).toEqual(['GCP 1', 'GCP 2']);
    expect(parsed.geoFeatures[0].properties.resourceCoords).toEqual([6690, 7517]);
  });

  it('builds one annotation per place, keyed as the map keys it, with z = 0', () => {
    const annos = geoAnnotations(parsed.geoFeatures, parsed.annotations);
    expect(annos.map((a) => a.id)).toEqual(parsed.geoFeatures.map(geoFeatureIdOf));
    expect(annos[0].position).toEqual({ x: 6690, y: 7517, z: 0 });
  });

  it('reads the name from metadata.label (geo.ldas.jp older form) when properties.title is missing', () => {
    // The older form geo.ldas.jp still supports: the name in metadata.label (e.g. Toyo Bunko's Da Ming map).
    const legacy = { ...feature(3, [10, 20], [135.5, 34.7]), properties: { resourceCoords: [10, 20] }, metadata: { label: '會寧', tags: ['域外地名'] } };
    const withTitle = { ...feature(4, [30, 40], [135.6, 34.8]), metadata: { label: 'old name' } };
    const manifest = structuredClone(imageManifest);
    manifest.items[0].annotations[0].items[0].body.features = [legacy, withTitle] as never;
    const titles = parseManifestV4(convertToV4(manifest)).geoFeatures.map((f) => f.properties.title);
    expect(titles).toEqual(['會寧', 'GCP 4']);
    const empty = { ...feature(5, [50, 60], [135.7, 34.9]), properties: { resourceCoords: [50, 60], title: '' }, metadata: { label: { ja: ['長白山'] } } };
    manifest.items[0].annotations[0].items[0].body.features = [empty] as never;
    expect(parseManifestV4(convertToV4(manifest)).geoFeatures[0].properties.title).toBe('長白山');
  });

  it('falls back to the GeoJSON id, then to the index', () => {
    const f = parsed.geoFeatures[0];
    expect(geoFeatureIdOf({ ...f, '@id': '' }, 0)).toBe('gcp-1');
    expect(geoFeatureIdOf({ ...f, '@id': '', id: undefined }, 4)).toBe('geo-feature-4');
  });
});

describe('a Manifest with several georeferenced Canvases', () => {
  const canvas1 = imageManifest.items[0];
  const plain = { ...canvas1, id: 'https://example.org/iiif/canvas/plain', annotations: [] };
  const second = {
    ...canvas1,
    id: 'https://example.org/iiif/canvas/2',
    label: { ja: ['二枚目'] },
    annotations: [
      {
        ...canvas1.annotations[0],
        items: [
          {
            ...canvas1.annotations[0].items[0],
            body: {
              ...canvas1.annotations[0].items[0].body,
              features: [{ ...feature(3, [10, 20], [135.5, 34.7]), properties: { resourceCoords: [10, 20], title: '工学部棟', tags: ['工学部', '建物'] } }],
            },
          },
        ],
      },
    ],
  };
  const manifest = convertToV4({ ...imageManifest, items: [plain, canvas1, second] });

  it('lists every Canvas with places, in order, skipping one without', () => {
    const canvases = geoCanvasesOf(manifest);
    expect(canvases.map((c) => c.id)).toEqual(['https://example.org/iiif/canvas/1', 'https://example.org/iiif/canvas/2']);
    expect(canvases.map((c) => c.features.length)).toEqual([2, 1]);
    expect(canvases[1].label).toEqual({ ja: ['二枚目'] });
  });

  it('still opens the first one by default', () => {
    expect(parseManifestV4(manifest).geoCanvasId).toBe('https://example.org/iiif/canvas/1');
  });

  it('gives the tags of a place to its annotation', () => {
    const [, c2] = geoCanvasesOf(manifest);
    const [a] = geoAnnotations(c2.features, []);
    expect(a.tags).toEqual([{ value: '工学部' }, { value: '建物' }]);
  });

  it('reads tags from metadata (geo.ldas.jp older form) too', () => {
    const f = { ...parsed1(), metadata: { tags: ['旧形式'] } };
    expect(geoAnnotations([f], [])[0].tags).toEqual([{ value: '旧形式' }]);
  });
});

function parsed1() {
  return parseManifestV4(convertToV4(imageManifest)).geoFeatures[0];
}
