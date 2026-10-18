import { describe, expect, it } from 'vitest';
import { filterGeorefFeatures, foldGeorefText, georefTagFacets } from './georefList';
import { geoAnnotations, geoFeaturesNamedBy, type GeoFeature } from './services/manifestParser';

const place = (id: string, title: string, tags: string[] = [], toponyms: string[] = []): GeoFeature => ({
  type: 'Feature',
  id,
  '@id': `https://example.org/places/${id}`,
  properties: { title, resourceCoords: [0, 0], tags },
  geometry: { type: 'Point', coordinates: [139.76, 35.71] },
  names: toponyms.map((toponym) => ({ toponym, lang: 'ja' })),
});

const features = [
  place('denki', '電気実験室', ['工学部']),
  place('yasuda', '安田講堂', ['本部', '建物'], ['ヤスダコウドウ']),
  place('nogaku', '農学部 1 号館', ['農学部', '建物']),
];
const annotations = geoAnnotations(features, []);
const run = (query: string, tags: string[] = []) => filterGeorefFeatures(features, annotations, { query, tags });

describe('foldGeorefText', () => {
  it('folds katakana to hiragana, half / full width and case', () => {
    expect(foldGeorefText('ヤスダ')).toBe('やすだ');
    expect(foldGeorefText('ﾔｽﾀﾞ')).toBe('やすだ');
    expect(foldGeorefText('ＡＢＣ abc')).toBe('abc abc');
  });
});

describe('filterGeorefFeatures', () => {
  it('keeps everything when there is no condition', () => {
    expect(run('')).toEqual([0, 1, 2]);
  });

  it('finds by title, alternative name (kana-insensitive), id and tag', () => {
    expect(run('講堂')).toEqual([1]);
    expect(run('やすだこうどう')).toEqual([1]);
    expect(run('DENKI')).toEqual([0]);
    expect(run('農学部')).toEqual([2]);
  });

  it('needs every word', () => {
    expect(run('建物 農学')).toEqual([2]);
  });

  it('keeps a place with any of the chosen tags, and ANDs with the text', () => {
    expect(run('', ['工学部', '本部'])).toEqual([0, 1]);
    expect(run('安田', ['工学部'])).toEqual([]);
  });
});

describe('georefTagFacets', () => {
  it('counts each tag once per place, most used first', () => {
    const twice = geoAnnotations([place('x', 'x', ['建物', '建物'])], []);
    expect(georefTagFacets([...annotations, ...twice])).toEqual([
      { value: '建物', count: 3 },
      { value: '工学部', count: 1 },
      { value: '本部', count: 1 },
      { value: '農学部', count: 1 },
    ]);
  });
});

describe('geoFeaturesNamedBy', () => {
  it('names a place on the map as the list does, from its Annotation', () => {
    const f = [place('a', '上野駅')];
    const named = geoAnnotations(f, []).map((a) => ({ ...a, title: 'Ueno Station' }));
    expect(geoFeaturesNamedBy(f, named)[0].properties.title).toBe('Ueno Station');
    expect(f[0].properties.title).toBe('上野駅');
  });
  it('keeps the feature when the names agree', () => {
    const f = [place('a', '上野駅')];
    expect(geoFeaturesNamedBy(f, geoAnnotations(f, []))[0]).toBe(f[0]);
  });
});
