import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fetchAllV3 } from './json';
import {
  collectionReader,
  curationReader,
  facetsOf,
  filterItems,
  loadSearchSource,
  matchesQuery,
  metadataRecordOf,
  sizeParam,
  type FetchJson,
  type ReadResult,
  type SearchItem,
} from '.';

// CODH の Curation API のサンプルと、参照先の 2 冊（curation.test.ts と同じもの）
const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../services/__fixtures__/${name}`, import.meta.url)), 'utf8'));
const M1 = 'http://codh.rois.ac.jp/pmjt/book/200014778/manifest.json';
const M2 = 'http://codh.rois.ac.jp/pmjt/book/200003067/manifest.json';

// 取り直しの待ち時間を飛ばす
const fetchOptions = { sleep: async () => {} };

const fetchFrom = (docs: Record<string, unknown>): FetchJson => async (url: string) => {
  if (!(url in docs)) throw new Error(`404 ${url}`);
  return docs[url];
};

describe('metadataRecordOf', () => {
  it('reads Presentation 2 and 3 metadata, picking the locale and stripping HTML', () => {
    const v2 = [
      { label: '作品', value: '江戸の花見' },
      { label: 'Subject', value: [{ '@value': 'Sakura', '@language': 'en' }, { '@value': '桜', '@language': 'ja' }] },
    ];
    expect(metadataRecordOf(v2, 'ja')).toEqual({ 作品: ['江戸の花見'], Subject: ['Sakura', '桜'] });
    const v3 = [
      { label: { en: ['Date'], ja: ['年'] }, value: { none: ['1850'] } },
      { label: { en: ['Note'] }, value: { en: ['<b>bold</b> &amp; plain'] } },
      { label: { en: ['Empty'] }, value: { en: [''] } },
    ];
    expect(metadataRecordOf(v3, 'ja')).toEqual({ 年: ['1850'], Note: ['bold & plain'] });
  });
});

describe('curationReader', () => {
  it('makes one item per member, in order, with a cropped thumbnail and the member metadata', async () => {
    const curation = fixture('codh-curation.json');
    // 顔貌コレクションのように、member に metadata を持たせる
    curation.selections[1].members[0].metadata = [{ label: '性別', value: '女' }];
    const fetchJson = fetchFrom({ [M1]: fixture('codh-manifest-200014778.json'), [M2]: fixture('codh-manifest-200003067.json') });
    const { items, failed } = await curationReader.read(curation, { url: 'https://x/c.json', fetchJson, locale: 'ja', fetchOptions });
    expect(failed).toBe(0);
    expect(items).toHaveLength(8);
    expect(items.map((i) => i.target)).toContainEqual({ content: 'https://x/c.json', pos: 8 });
    expect(items.map((i) => i.target.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const first2 = items.find((i) => i.metadata['性別']);
    expect(first2?.target.pos).toBe(5);
    // pos=8 は 2 冊目の canvas/00010#xywh=2850,1000,730,680（curation.test.ts と同じ）。長い辺（幅）だけを指定する
    expect(items[7].thumbnail).toMatch(/\/2850,1000,730,680\/240,\/0\/default\.jpg$/);
  });

  it('counts manifests that could not be read and still lists their members (without a thumbnail)', async () => {
    const fetchJson = fetchFrom({ [M1]: fixture('codh-manifest-200014778.json') });
    const { items, failed } = await curationReader.read(fixture('codh-curation.json'), { url: 'https://x/c.json', fetchJson, locale: 'ja', fetchOptions });
    expect(failed).toBe(1);
    expect(items).toHaveLength(8);
    expect(items[7].thumbnail).toBeUndefined();
  });
});

describe('collectionReader', () => {
  const manifest = (id: string, date: string, place?: string) => ({
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id,
    type: 'Manifest',
    label: { en: [id.split('/').pop()] },
    metadata: [
      { label: { en: ['Date'] }, value: { none: [date] } },
      ...(place ? [{ label: { en: ['Place'] }, value: { none: [place] } }] : []),
    ],
    thumbnail: [{ id: `${id}/thumb.jpg`, type: 'Image' }],
    items: [],
  });
  const docs = {
    'https://x/sub': {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://x/sub',
      type: 'Collection',
      label: { none: ['sub'] },
      items: [{ id: 'https://x/m3', type: 'Manifest', label: { none: ['m3'] } }],
    },
    'https://x/m1': manifest('https://x/m1', '1850', 'Edo'),
    'https://x/m2': manifest('https://x/m2', '1860', 'Osaka'),
    'https://x/m3': manifest('https://x/m3', '1850'),
  };
  const top = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: 'https://x/top',
    type: 'Collection',
    label: { none: ['top'] },
    items: [
      { id: 'https://x/m1', type: 'Manifest', label: { none: ['m1'] } },
      { id: 'https://x/m2', type: 'Manifest', label: { none: ['m2'] } },
      { id: 'https://x/sub', type: 'Collection', label: { none: ['sub'] } },
      { id: 'https://x/missing', type: 'Manifest', label: { none: ['missing'] } },
    ],
  };

  it('fetches every manifest (also inside nested collections) and reads its metadata', async () => {
    const progress: number[] = [];
    const { items, failed } = await collectionReader.read(top, {
      url: 'https://x/top',
      fetchJson: fetchFrom(docs),
      locale: 'en',
      fetchOptions,
      onProgress: (done) => progress.push(done),
    });
    expect(items.map((i) => i.target.content)).toEqual(['https://x/m1', 'https://x/m2', 'https://x/m3', 'https://x/missing']);
    expect(items[0].metadata).toEqual({ Date: ['1850'], Place: ['Edo'] });
    expect(items[0].thumbnail).toBe('https://x/m1/thumb.jpg');
    expect(items[3]).toMatchObject({ label: 'missing', metadata: {} });
    expect(failed).toBe(1);
    expect(progress.at(-1)).toBe(4);
  });

  it('reports what it has read so far, while a slow manifest is still pending', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = fetchFrom(docs);
    const fetchJson: FetchJson = async (url) => {
      if (url === 'https://x/m2') await gate;
      return read(url);
    };
    const partials: ReadResult[] = [];
    const done = collectionReader.read(top, {
      url: 'https://x/top',
      fetchJson,
      locale: 'en',
      fetchOptions,
      onPartial: (p) => partials.push(p),
    });
    // m2 を待っているあいだに、読めた m1 のメタデータが届く
    await vi.waitFor(() => expect(partials.at(-1)?.items[0].metadata).toEqual({ Date: ['1850'], Place: ['Edo'] }));
    const partial = partials.at(-1)!;
    expect(partial.items.map((i) => i.key)).toEqual(['1', '2', '3', '4']);
    expect(partial.items[1]).toMatchObject({ label: 'm2', metadata: {} });
    release();
    expect((await done).items[1].metadata).toEqual({ Date: ['1860'], Place: ['Osaka'] });
  });

  it('loadSearchSource tells a collection from a curation, and refuses a single manifest', async () => {
    const fetchJson = fetchFrom({ ...docs, 'https://x/top': top });
    const src = await loadSearchSource({ url: 'https://x/top', fetchJson, locale: 'en', fetchOptions });
    expect(src.kind).toBe('collection');
    expect(src.label).toBe('top');
    await expect(loadSearchSource({ url: 'https://x/m1', fetchJson, locale: 'en' })).rejects.toThrow();
  });
});

describe('curationReader, partial results', () => {
  it('lists the members and their metadata before any manifest is read', async () => {
    const curation = fixture('codh-curation.json');
    curation.selections[1].members[0].metadata = [{ label: '性別', value: '女' }];
    const partials: ReadResult[] = [];
    const full = await curationReader.read(curation, {
      url: 'https://x/c.json',
      fetchJson: fetchFrom({ [M1]: fixture('codh-manifest-200014778.json'), [M2]: fixture('codh-manifest-200003067.json') }),
      locale: 'ja',
      fetchOptions,
      onPartial: (p) => partials.push(p),
    });
    expect(partials[0].items).toHaveLength(8);
    expect(partials[0].items[4].metadata).toEqual({ 性別: ['女'] });
    expect(partials[0].items.map((i) => i.key)).toEqual(full.items.map((i) => i.key));
  });
});

describe('fetchAllV3', () => {
  it('retries a refused request, waiting longer each time, and gives up after the retries', async () => {
    const calls = new Map<string, number>();
    const waits: number[] = [];
    // a は 2 回断られてから読める。b はずっと断られる（同時に頼みすぎたときの 503 の代わり）
    const fetchJson: FetchJson = async (url) => {
      const n = (calls.get(url) ?? 0) + 1;
      calls.set(url, n);
      if (url === 'a' && n > 2) return { '@context': 'http://iiif.io/api/presentation/3/context.json', id: 'a', type: 'Manifest' };
      throw new Error('503');
    };
    const out = await fetchAllV3(['a', 'b'], fetchJson, {
      concurrency: 1,
      retries: 3,
      retryDelay: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(out.get('a')).toMatchObject({ id: 'a' });
    expect(out.get('b')).toBeNull();
    expect(calls.get('a')).toBe(3);
    expect(calls.get('b')).toBe(4);
    expect(waits).toEqual([100, 300, 100, 300, 900]);
  });
});

describe('sizeParam', () => {
  it('asks for the longer side only, never larger than the source', () => {
    expect(sizeParam(730, 680, 240)).toBe('240,');
    expect(sizeParam(104, 107, 240)).toBe(',107');
    expect(sizeParam(3000, 4000, 240)).toBe(',240');
  });
});

describe('facets and filtering', () => {
  const item = (key: string, metadata: Record<string, string[]>, label = key): SearchItem => ({
    key,
    label,
    metadata,
    target: { content: 'https://x/m' },
  });
  const items = [
    item('1', { 性別: ['女'], 作品: ['A'], id: ['x1'] }, '江戸名所'),
    item('2', { 性別: ['男'], 作品: ['A'], id: ['x2'] }),
    item('3', { 性別: ['女'], 作品: ['B'], id: ['x3'] }),
    item('4', { 性別: ['不明'], 作品: ['B'], id: ['x4'] }),
  ];

  it('matches every word against the label and the metadata values', () => {
    expect(matchesQuery(items[0], '江戸 女')).toBe(true);
    expect(matchesQuery(items[0], '江戸 男')).toBe(false);
  });

  it('ORs values within a key and ANDs keys', () => {
    expect(filterItems(items, '', { 性別: ['女', '男'], 作品: ['A'] }).map((i) => i.key)).toEqual(['1', '2']);
  });

  it('counts each facet without its own selection, and keeps a selected value at 0', () => {
    const facets = facetsOf(items, '', { 性別: ['女'], 作品: ['A'] });
    const sex = facets.find((f) => f.key === '性別');
    // 作品=A だけで絞った数: 女 1・男 1（不明 0 は出さない）
    expect(sex?.values).toEqual([
      { value: '女', count: 1 },
      { value: '男', count: 1 },
    ]);
    const work = facets.find((f) => f.key === '作品');
    expect(work?.values).toEqual([
      { value: 'A', count: 1 },
      { value: 'B', count: 1 },
    ]);
    expect(facetsOf(items, '', { 性別: ['なし'] }).find((f) => f.key === '性別')?.values.at(-1)).toEqual({
      value: 'なし',
      count: 0,
    });
  });

  it('leaves out keys with a single value and identifier-like keys', () => {
    const many = Array.from({ length: 30 }, (_, i) => item(`${i}`, { id: [`x${i}`], kind: ['face'], 性別: [i % 2 ? '女' : '男'] }));
    expect(facetsOf(many, '', {}).map((f) => f.key)).toEqual(['性別']);
  });
});
