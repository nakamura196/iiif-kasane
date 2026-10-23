import { describe, expect, it } from 'vitest';
import extensionSample from '../../../../public/manifests/sample-manifest-region-tags.json';
import { convertToV4 } from './services/manifestConverter';
import { parseManifestV4 } from './services/manifestParser';
import {
  EMPTY_FILTER,
  creatorFacets,
  filterAnnotations,
  isFilterActive,
  tagFacets,
} from './annotationFilter';

const annotations = parseManifestV4(convertToV4(extensionSample)).annotations;
const ids = (list: typeof annotations) => list.map((a) => a.id.split('#')[1]);

describe('filterAnnotations', () => {
  it('returns everything for an empty filter', () => {
    expect(filterAnnotations(annotations, EMPTY_FILTER)).toHaveLength(4);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('searches title, description text, tags and creator, case-insensitively', () => {
    const q = (query: string) => ids(filterAnnotations(annotations, { ...EMPTY_FILTER, query }));
    expect(q('北海')).toEqual(['anno-north-sea']);
    expect(q('POLYGON')).toEqual(['anno-area']);
    expect(q('europe')).toEqual(['anno-uk-2']);
    expect(q('annotator 2')).toEqual(['anno-uk-2']);
  });

  it('does not match HTML markup in the description', () => {
    expect(filterAnnotations(annotations, { ...EMPTY_FILTER, query: '<p>' })).toHaveLength(0);
  });

  it('ORs values within a facet and ANDs across facets', () => {
    const both = filterAnnotations(annotations, {
      ...EMPTY_FILTER,
      creators: ['Example Annotator 1', 'Example Annotator 2'],
    });
    expect(ids(both)).toEqual(['anno-uk-1', 'anno-uk-2', 'anno-area']);
    const narrowed = filterAnnotations(annotations, {
      ...EMPTY_FILTER,
      creators: ['Example Annotator 1', 'Example Annotator 2'],
      tags: ['region: Europe'],
    });
    expect(ids(narrowed)).toEqual(['anno-uk-2']);
  });

  it('ignores the width of characters, as the 2D list does', () => {
    const q = (query: string) => ids(filterAnnotations(annotations, { ...EMPTY_FILTER, query }));
    expect(q('ＰＯＬＹＧＯＮ')).toEqual(['anno-area']);
    expect(q('ｅｕｒｏｐｅ')).toEqual(['anno-uk-2']);
  });

  it('finds the names and addresses of the pictures and related links on the card', () => {
    const base = annotations[0];
    const linked = {
      ...base,
      id: 'x#anno-linked',
      seeAlso: [{ id: 'https://example.org/record/1', label: { ja: ['所蔵先の記録'] } }],
      images: [{ id: 'https://example.org/photo.jpg', label: 'Photograph of the coast' }],
    };
    const q = (query: string) => ids(filterAnnotations([base, linked], { ...EMPTY_FILTER, query }));
    expect(q('所蔵先')).toEqual(['anno-linked']);
    expect(q('example.org/record')).toEqual(['anno-linked']);
    expect(q('photograph coast')).toEqual(['anno-linked']);
  });

  it('matches a tag without a key by its value', () => {
    const r = filterAnnotations(annotations, { ...EMPTY_FILTER, tags: ['example'] });
    expect(ids(r)).toEqual(['anno-uk-2']);
  });
});

describe('facets', () => {
  it('counts creators, skipping annotations without one', () => {
    expect(creatorFacets(annotations)).toEqual([
      { value: 'Example Annotator 1', count: 2 },
      { value: 'Example Annotator 2', count: 1 },
    ]);
  });

  it('lists tags as "key: value", or the value alone', () => {
    expect(tagFacets(annotations).map((f) => f.value)).toEqual([
      'region: Europe',
      'place type: country name',
      'example',
    ]);
  });
});
