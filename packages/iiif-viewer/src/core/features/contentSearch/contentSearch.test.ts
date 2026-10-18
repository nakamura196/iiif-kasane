import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { upgradeToV3 } from '../../services/upgradeV2';
import {
  contentSearchAnnotationPage,
  contentSearchTargetOf,
  contentSearchUrl,
  fetchContentSearchTerms,
  findContentSearchService,
  groupMatchesByCanvas,
  parseAutocompleteResponse,
  parseContentSearchResponse,
  runContentSearch,
} from './index';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

// 2026-10-15 に取った実物（件数を減らしてある）と、2.0 の仕様の例に沿って手で書いたもの。
// 2.0 の窓口を持つ公開の資料は見つからなかった。

describe('findContentSearchService label', () => {
  it('picks the label in the locale asked for', () => {
    const manifest = {
      service: [{ id: 'https://example.org/s', type: 'SearchService2', label: { ja: ['本文を探す'], en: ['Search text'] } }],
    };
    expect(findContentSearchService(manifest, 'en')?.label).toBe('Search text');
    expect(findContentSearchService(manifest, 'ja')?.label).toBe('本文を探す');
  });
});

describe('findContentSearchService', () => {
  it('finds a 2.0 service and its autocomplete, and prefers it to 1.0', () => {
    const manifest = {
      service: [
        { id: 'https://example.org/s1', type: 'SearchService1', profile: 'http://iiif.io/api/search/1/search' },
        {
          id: 'https://example.org/s2',
          type: 'SearchService2',
          service: [{ id: 'https://example.org/ac2', type: 'AutoCompleteService2' }],
        },
      ],
    };
    expect(findContentSearchService(manifest)).toEqual({
      id: 'https://example.org/s2',
      version: 2,
      autocomplete: { id: 'https://example.org/ac2', version: 2 },
    });
  });

  it('reads a Wellcome v3 manifest that declares 1.0 with @id / @type', () => {
    const manifest = {
      service: [
        {
          '@id': 'https://iiif.wellcomecollection.org/search/v1/b21450638',
          '@type': 'SearchService1',
          profile: 'http://iiif.io/api/search/1/search',
          label: 'Search within this manifest',
          service: {
            '@id': 'https://iiif.wellcomecollection.org/search/autocomplete/v1/b21450638',
            '@type': 'AutoCompleteService1',
            profile: 'http://iiif.io/api/search/1/autocomplete',
          },
        },
      ],
    };
    expect(findContentSearchService(manifest)).toEqual({
      id: 'https://iiif.wellcomecollection.org/search/v1/b21450638',
      version: 1,
      label: 'Search within this manifest',
      autocomplete: { id: 'https://iiif.wellcomecollection.org/search/autocomplete/v1/b21450638', version: 1 },
    });
  });

  it('keeps the service of a Presentation 2 manifest through the upgrade (MDZ: profile only, no type)', () => {
    const v2 = {
      '@context': 'http://iiif.io/api/presentation/2/context.json',
      '@id': 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest',
      '@type': 'sc:Manifest',
      label: 'x',
      service: {
        '@context': 'http://iiif.io/api/search/1/context.json',
        '@id': 'https://api.digitale-sammlungen.de/iiif/services/search/v1/bsb00026283',
        profile: 'http://iiif.io/api/search/1/search',
      },
      sequences: [{ '@type': 'sc:Sequence', canvases: [] }],
    };
    expect(findContentSearchService(upgradeToV3(v2))).toMatchObject({
      id: 'https://api.digitale-sammlungen.de/iiif/services/search/v1/bsb00026283',
      version: 1,
    });
  });

  it('ignores other services and a lone autocomplete', () => {
    expect(
      findContentSearchService({
        service: [
          { id: 'https://example.org/img', type: 'ImageService3', profile: 'level1' },
          { '@id': 'https://example.org/ac', profile: 'http://iiif.io/api/search/1/autocomplete', '@context': 'http://iiif.io/api/search/1/context.json' },
        ],
      }),
    ).toBeUndefined();
    expect(findContentSearchService(null)).toBeUndefined();
  });
});

describe('contentSearchUrl', () => {
  it('adds q, with & when the id already has a query', () => {
    expect(contentSearchUrl({ id: 'https://example.org/s' }, ' 東京 ')).toBe('https://example.org/s?q=%E6%9D%B1%E4%BA%AC');
    expect(contentSearchUrl({ id: 'https://example.org/s?x=1' }, 'a b')).toBe('https://example.org/s?x=1&q=a%20b');
  });
});

describe('contentSearchTargetOf', () => {
  it('reads a string with #xywh, a SpecificResource and a plain Canvas', () => {
    expect(contentSearchTargetOf('https://e.org/c1#xywh=1,2,3,4')).toEqual({ canvasId: 'https://e.org/c1', xywh: [1, 2, 3, 4] });
    expect(contentSearchTargetOf('https://e.org/c1#xywh=pixel:1,2,3,4')).toEqual({ canvasId: 'https://e.org/c1', xywh: [1, 2, 3, 4] });
    expect(
      contentSearchTargetOf({ type: 'SpecificResource', source: { id: 'https://e.org/c1' }, selector: { type: 'FragmentSelector', value: 'xywh=5,6,7,8' } }),
    ).toEqual({ canvasId: 'https://e.org/c1', xywh: [5, 6, 7, 8] });
    // 1.0 の書き方（full）
    expect(contentSearchTargetOf({ '@type': 'oa:SpecificResource', full: 'https://e.org/c1', selector: { value: 'xywh=1,1,2,2' } })).toEqual({
      canvasId: 'https://e.org/c1',
      xywh: [1, 1, 2, 2],
    });
    expect(contentSearchTargetOf({ id: 'https://e.org/c1', type: 'Canvas' })).toEqual({ canvasId: 'https://e.org/c1', xywh: undefined });
  });
});

describe('parseContentSearchResponse', () => {
  it('reads MDZ 1.0: hits give the words before and after, within gives the total, next the following page', () => {
    const page = parseContentSearchResponse(fixture('mdz-search1.json'));
    expect(page.total).toBe(422);
    expect(page.next).toBe('https://api.digitale-sammlungen.de/iiif/services/search/v1/bsb00026283?q=der&page=2');
    expect(page.matches).toHaveLength(3);
    const m = page.matches[0];
    expect(m.canvasId).toBe('https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/canvas/1');
    expect(m.regions[0].xywh).toEqual([2854, 1631, 141, 162]);
    expect(m.match).toBe('der');
    expect(m.before).toMatch(/ob $/);
    expect(m.after).toBeTruthy();
  });

  it('reads Wellcome 1.0 (no paging)', () => {
    const page = parseContentSearchResponse(fixture('wellcome-search1.json'));
    expect(page.total).toBe(41);
    expect(page.next).toBeUndefined();
    expect(page.matches.map((m) => m.match)).toEqual(['CHOLERA', 'CHOLERA,']);
    expect(page.matches[1].canvasId).toBe('https://iiif.wellcomecollection.org/presentation/b21450638/canvases/b21450638_0003.jp2');
  });

  it('reads 2.0: contextualizing gives the quote; a phrase over two words is one match with two regions', () => {
    const page = parseContentSearchResponse(fixture('search2-handmade.json'));
    expect(page.total).toBe(5);
    expect(page.next).toBe('https://example.org/service/book1/search?q=bird&page=2');
    expect(page.matches).toHaveLength(2);
    const [line, phrase] = page.matches;
    expect(line).toMatchObject({ match: 'bird', before: 'A ', after: ' in the hand', granularity: 'line' });
    expect(line.regions[0]).toMatchObject({ canvasId: 'https://example.org/book1/canvas/p1', xywh: [100, 100, 250, 20] });
    expect(phrase).toMatchObject({ match: 'blue bird', canvasId: 'https://example.org/book1/canvas/p2', granularity: 'word' });
    expect(phrase.regions.map((r) => r.xywh)).toEqual([
      [200, 300, 40, 18],
      [60, 320, 38, 18],
    ]);
  });

  it('makes one match per annotation when there is no context', () => {
    const page = parseContentSearchResponse({
      type: 'AnnotationPage',
      items: [{ id: 'a1', type: 'Annotation', body: { type: 'TextualBody', value: 'x' }, target: 'https://e.org/c1#xywh=0,0,1,1' }],
    });
    expect(page.matches).toEqual([
      { id: 'a1', canvasId: 'https://e.org/c1', match: 'x', regions: [{ annotationId: 'a1', canvasId: 'https://e.org/c1', xywh: [0, 0, 1, 1], text: 'x' }] },
    ]);
    expect(parseContentSearchResponse('nope')).toEqual({ matches: [] });
  });
});

describe('autocomplete', () => {
  it('reads 1.0 TermList (Wellcome) and 2.0 TermPage', () => {
    expect(parseAutocompleteResponse(fixture('wellcome-autocomplete1.json')).map((t) => t.value)).toEqual(['cholera', 'choleric']);
    expect(parseAutocompleteResponse(fixture('autocomplete2-handmade.json'))).toEqual([
      { value: 'bird', count: 15 },
      { value: 'birds', count: 5 },
      { value: 'birdsong', count: 2, label: 'birdsong' },
    ]);
  });

  it('does not ask for an empty word', async () => {
    const calls: string[] = [];
    const fetchJson = async (u: string) => (calls.push(u), {});
    expect(await fetchContentSearchTerms({ id: 'https://e.org/ac' }, '  ', fetchJson)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('runContentSearch', () => {
  const pageOf = (n: number, next?: string) => ({
    within: { total: 7 },
    resources: Array.from({ length: 3 }, (_, i) => ({ '@id': `a${n}-${i}`, on: `https://e.org/c${n}#xywh=0,0,1,1`, resource: { chars: 'w' } })),
    ...(next ? { next } : {}),
  });

  it('follows next up to the page limit and says when it stopped early', async () => {
    const calls: string[] = [];
    const fetchJson = async (u: string) => {
      calls.push(u);
      const n = Number(new URL(u).searchParams.get('page') ?? '1');
      return pageOf(n, n < 3 ? `https://e.org/s?q=w&page=${n + 1}` : undefined);
    };
    const all = await runContentSearch({ id: 'https://e.org/s' }, 'w', fetchJson);
    expect(all.matches).toHaveLength(9);
    expect(all).toMatchObject({ total: 7, truncated: false });
    expect(calls).toEqual(['https://e.org/s?q=w', 'https://e.org/s?q=w&page=2', 'https://e.org/s?q=w&page=3']);

    const two = await runContentSearch({ id: 'https://e.org/s' }, 'w', fetchJson, { maxPages: 2 });
    expect(two.matches).toHaveLength(6);
    expect(two.truncated).toBe(true);
  });

  it('stops when next points back to a page already read', async () => {
    const fetchJson = async () => pageOf(1, 'https://e.org/s?q=w');
    const r = await runContentSearch({ id: 'https://e.org/s' }, 'w', fetchJson);
    expect(r.matches).toHaveLength(3);
    expect(r.truncated).toBe(false);
  });
});

describe('contentSearchAnnotationPage', () => {
  it('makes highlighting annotations for one Canvas, keeping the granularity', () => {
    const { matches } = parseContentSearchResponse(fixture('search2-handmade.json'));
    const byCanvas = groupMatchesByCanvas(matches);
    expect([...byCanvas.keys()]).toEqual(['https://example.org/book1/canvas/p1', 'https://example.org/book1/canvas/p2']);
    const page = contentSearchAnnotationPage('https://example.org/book1/canvas/p2', byCanvas.get('https://example.org/book1/canvas/p2')!) as {
      items: Record<string, unknown>[];
    };
    expect(page.items.map((a) => [a.id, a.target, a.textGranularity, a.motivation])).toEqual([
      ['https://example.org/book1/annotation/word-12', 'https://example.org/book1/canvas/p2#xywh=200,300,40,18', 'word', 'highlighting'],
      ['https://example.org/book1/annotation/word-12#1', 'https://example.org/book1/canvas/p2#xywh=60,320,38,18', 'word', 'highlighting'],
    ]);
  });
});
