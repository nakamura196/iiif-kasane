import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KIND,
  annotationKindOf,
  kindFacets,
  passesChoice,
  presentChoices,
  narrowByKindAndUnit,
} from './annotationKinds';

describe('annotationKindOf', () => {
  it('is the first motivation', () => {
    expect(annotationKindOf({ motivations: ['supplementing'] })).toBe('supplementing');
    expect(annotationKindOf({ motivations: ['commenting', 'tagging'] })).toBe('commenting');
  });
  it('is painting for text drawn on the Canvas, whatever the motivations say', () => {
    expect(annotationKindOf({ motivations: ['supplementing'], painted: true })).toBe('painting');
  });
  it('is a note for an annotation without a usable motivation', () => {
    expect(annotationKindOf({})).toBe(DEFAULT_KIND);
    expect(annotationKindOf({ motivations: [] })).toBe('commenting');
    expect(annotationKindOf({ motivations: [''] })).toBe('commenting');
  });
  it('keeps a motivation outside the W3C list as it is', () => {
    expect(annotationKindOf({ motivations: ['georeferencing'] })).toBe('georeferencing');
  });
});

describe('kindFacets', () => {
  it('counts the kinds and lists text first', () => {
    expect(kindFacets(['tagging', 'supplementing', 'tagging', 'commenting', 'supplementing', 'supplementing'])).toEqual([
      { value: 'supplementing', count: 3 },
      { value: 'commenting', count: 1 },
      { value: 'tagging', count: 2 },
    ]);
  });
  it('puts unknown kinds last, in the order they first occur', () => {
    expect(kindFacets(['zeta', 'tagging', 'alpha', 'zeta']).map((f) => f.value)).toEqual(['tagging', 'zeta', 'alpha']);
  });
  it('is empty for no items', () => {
    expect(kindFacets([])).toEqual([]);
  });
});

describe('choices', () => {
  const facets = [
    { value: 'supplementing', count: 3 },
    { value: 'tagging', count: 2 },
  ];
  it('nothing chosen keeps everything', () => {
    expect(passesChoice('tagging', [])).toBe(true);
    expect(passesChoice(undefined, [])).toBe(true);
  });
  it('something chosen keeps only the chosen values', () => {
    expect(passesChoice('supplementing', ['supplementing'])).toBe(true);
    expect(passesChoice('tagging', ['supplementing'])).toBe(false);
    expect(passesChoice(undefined, ['supplementing'])).toBe(false);
  });
  it('ignores chosen values that the items do not have', () => {
    expect(presentChoices(['commenting', 'tagging'], facets)).toEqual(['tagging']);
    expect(presentChoices(['commenting'], facets)).toEqual([]);
    expect(presentChoices([], facets)).toEqual([]);
  });
});

describe('narrowByKindAndUnit', () => {
  const hit = { motivations: ['highlighting'], granularity: 'word' };
  const line = { motivations: ['supplementing'], granularity: 'line' };
  const region = { motivations: ['tagging'] };
  it('keeps the search hits whatever the kind or unit, in their place', () => {
    expect(narrowByKindAndUnit([line, hit, region], ['tagging'], null).annotations).toEqual([hit, region]);
    expect(narrowByKindAndUnit([line, hit, region], [], 'line').annotations).toEqual([line, hit]);
  });
  it('does not offer the search hits as a kind or their unit', () => {
    const r = narrowByKindAndUnit([line, hit, region], [], null);
    expect(r.kindFacets.map((f) => f.value)).toEqual(['supplementing', 'tagging']);
    expect(r.granularities).toEqual(['line']);
  });
  it('says whether a kind or unit narrows the annotations', () => {
    expect(narrowByKindAndUnit([line, region], [], null).narrowing).toBe(false);
    expect(narrowByKindAndUnit([line, region], ['tagging'], null).narrowing).toBe(true);
    expect(narrowByKindAndUnit([line, region], ['commenting'], null).narrowing).toBe(false);
  });
});
