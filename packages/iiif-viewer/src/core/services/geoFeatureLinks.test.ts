import { describe, expect, it } from 'vitest';
import { geoFeatureLinksOf, type GeoFeature } from './manifestParser';

const feature = (extra: Partial<GeoFeature> = {}, url?: string): GeoFeature => ({
  '@id': 'f1',
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [139.76, 35.71] },
  properties: { title: '本郷', resourceCoords: [10, 20], ...(url ? { url } : {}) },
  ...extra,
});

describe('geoFeatureLinksOf', () => {
  it('reads Linked Places links with their type', () => {
    const f = feature({
      links: [
        { type: 'primaryTopicOf', identifier: 'https://ja.wikipedia.org/wiki/本郷' },
        { type: 'closeMatch', identifier: 'http://www.wikidata.org/entity/Q1' },
      ],
    });
    expect(geoFeatureLinksOf(f)).toEqual([
      { type: 'primaryTopicOf', href: 'https://ja.wikipedia.org/wiki/%E6%9C%AC%E9%83%B7' },
      { type: 'closeMatch', href: 'http://www.wikidata.org/entity/Q1' },
    ]);
  });

  it('falls back to properties.url as detail when there are no links', () => {
    expect(geoFeatureLinksOf(feature({}, 'https://example.org/a'))).toEqual([{ type: 'detail', href: 'https://example.org/a' }]);
  });

  it('falls back to metadata.url (geo.ldas.jp older form) after properties.url', () => {
    const legacy = feature({ metadata: { url: 'https://example.org/old' } });
    expect(geoFeatureLinksOf(legacy)).toEqual([{ type: 'detail', href: 'https://example.org/old' }]);
    const both = feature({ metadata: { url: 'https://example.org/old' } }, 'https://example.org/new');
    expect(geoFeatureLinksOf(both)).toEqual([{ type: 'detail', href: 'https://example.org/new' }]);
  });

  it('prefers links over properties.url', () => {
    const f = feature({ links: [{ type: 'seeAlso', identifier: 'https://example.org/b' }] }, 'https://example.org/a');
    expect(geoFeatureLinksOf(f)).toEqual([{ type: 'seeAlso', href: 'https://example.org/b' }]);
  });

  it('drops non-http links', () => {
    const f = feature({ links: [{ type: 'seeAlso', identifier: 'javascript:alert(1)' }, { type: 'seeAlso', identifier: 'not a url' }] }, 'data:text/html,x');
    expect(geoFeatureLinksOf(f)).toEqual([]);
  });

  it('labels a link without type as detail', () => {
    const f = feature({ links: [{ type: '', identifier: 'https://example.org/c' }] });
    expect(geoFeatureLinksOf(f)).toEqual([{ type: 'detail', href: 'https://example.org/c' }]);
  });
});
