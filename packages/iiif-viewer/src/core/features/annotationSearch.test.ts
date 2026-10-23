import { describe, expect, it } from 'vitest';
import type { AnnotationBodyItem } from './annotationBody';
import {
  annotationSearchText,
  canvasAnnotationTags,
  canvasTagFacets,
  focusBoxOf,
  matchesCanvasAnnotation,
  matchesSearchTerms,
  presentCanvasTags,
  searchTerms,
} from './annotationSearch';

describe('annotationSearchText', () => {
  it('reads plain text, HTML without tags, and links', () => {
    const text = annotationSearchText({
      bodies: [
        { kind: 'text', value: '雅屯河' },
        { kind: 'text', value: '<p>Yellow <b>River</b></p>', format: 'text/html' },
        { kind: 'resource', url: 'https://www.wikidata.org/entity/Q1', label: { ja: ['黄河'] } },
      ],
    });
    expect(text).toContain('雅屯河');
    expect(text).toContain('river');
    expect(text).not.toContain('<b>');
    expect(text).toContain('wikidata.org');
    expect(text).toContain('黄河');
  });

  it('reads a tag as "key: value", as the 3D list does', () => {
    const text = annotationSearchText({
      bodies: [{ kind: 'text', value: 'Europe', tagging: true, label: { en: ['region'] } }],
    });
    expect(matchesSearchTerms(text, searchTerms('region: europe'))).toBe(true);
  });

  it('ignores the width of characters and case', () => {
    const text = annotationSearchText({ bodies: [{ kind: 'text', value: 'ＡＢＣ１２' }] });
    expect(matchesSearchTerms(text, searchTerms('abc12'))).toBe(true);
  });
});

describe('searchTerms / matchesSearchTerms', () => {
  it('needs all the words', () => {
    const text = annotationSearchText({ bodies: [{ kind: 'text', value: '雅屯河 北岸' }] });
    expect(matchesSearchTerms(text, searchTerms('河　北岸'))).toBe(true); // 全角スペースでも区切る
    expect(matchesSearchTerms(text, searchTerms('河 南岸'))).toBe(false);
  });

  it('matches everything with no words', () => {
    expect(searchTerms('  ')).toEqual([]);
    expect(matchesSearchTerms('x', [])).toBe(true);
  });
});

describe('focusBoxOf', () => {
  const canvas = { width: 1000, height: 2000 };

  it('gives room around a small region', () => {
    expect(focusBoxOf({ type: 'rect', x: 100, y: 200, w: 10, h: 10 }, canvas)).toEqual([80, 180, 50, 50]);
    expect(focusBoxOf({ type: 'rect', x: 100, y: 200, w: 100, h: 40 }, canvas)).toEqual([0, 160, 300, 120]);
  });

  it('makes a box around a point', () => {
    expect(focusBoxOf({ type: 'point', x: 500, y: 500 }, canvas)).toEqual([475, 475, 50, 50]);
  });

  it('does not move for the whole Canvas or an unknown size', () => {
    expect(focusBoxOf({ type: 'canvas' }, canvas)).toBeUndefined();
    expect(focusBoxOf({ type: 'point', x: 1, y: 1 }, { width: 0, height: 0 })).toBeUndefined();
  });
});

const tag = (value: string, key?: unknown, extra: Partial<AnnotationBodyItem> = {}): AnnotationBodyItem => ({
  kind: 'text',
  value,
  tagging: true,
  ...(key ? { label: key } : {}),
  ...extra,
});

describe('canvasAnnotationTags', () => {
  it('reads tags as "key: value" in the reader\'s language, and a tag without a key as its value', () => {
    const a = {
      bodies: [
        { kind: 'text' as const, value: '説明' },
        tag('Europe', { en: ['region'], ja: ['地域'] }),
        tag('globe'),
      ],
    };
    expect(canvasAnnotationTags(a, 'ja')).toEqual(['地域: Europe', 'globe']);
    expect(canvasAnnotationTags(a, 'en')).toEqual(['region: Europe', 'globe']);
  });

  it('takes the tag of the reader\'s language among the alternatives of a Choice', () => {
    const a = { bodies: [tag('国', undefined, { choice: 0, language: 'ja' }), tag('country', undefined, { choice: 0, language: 'en' })] };
    expect(canvasAnnotationTags(a, 'en')).toEqual(['country']);
    expect(canvasAnnotationTags(a, 'ja')).toEqual(['国']);
  });
});

describe('canvasTagFacets', () => {
  it('counts the regions that have a tag (not the annotations), the most used first', () => {
    const facets = canvasTagFacets(
      [
        // one region, two annotations with the same tag: counted once
        { annotations: [{ bodies: [tag('a')] }, { bodies: [tag('a'), tag('b')] }] },
        { annotations: [{ bodies: [tag('b')] }] },
        { annotations: [{ bodies: [tag('b')] }] },
        { annotations: [{ bodies: [{ kind: 'text', value: 'no tag' }] }] },
      ],
      'en',
    );
    expect(facets).toEqual([
      { value: 'b', count: 3 },
      { value: 'a', count: 1 },
    ]);
  });
});

describe('presentCanvasTags', () => {
  it('keeps only the chosen tags that the annotations have', () => {
    expect(presentCanvasTags([{ bodies: [tag('a')] }], ['a', 'z'], 'en')).toEqual(['a']);
    expect(presentCanvasTags([], ['a'], 'en')).toEqual([]);
  });
});

describe('matchesCanvasAnnotation', () => {
  const a = { bodies: [{ kind: 'text' as const, value: '雅屯河' }, tag('Asia', { en: ['region'] })] };
  const b = { bodies: [{ kind: 'text' as const, value: '雅屯河' }, tag('Europe', { en: ['region'] })] };

  it('keeps an annotation with one of the chosen tags (OR)', () => {
    expect(matchesCanvasAnnotation(a, [], ['region: Asia', 'region: Africa'], 'en')).toBe(true);
    expect(matchesCanvasAnnotation(b, [], ['region: Asia', 'region: Africa'], 'en')).toBe(false);
  });

  it('needs the words of the search too (AND)', () => {
    expect(matchesCanvasAnnotation(a, searchTerms('雅屯河'), ['region: Asia'], 'en')).toBe(true);
    expect(matchesCanvasAnnotation(a, searchTerms('黄河'), ['region: Asia'], 'en')).toBe(false);
  });

  it('keeps everything with no words and no tags', () => {
    expect(matchesCanvasAnnotation({ bodies: [] }, [], [], 'en')).toBe(true);
  });
});
