import { describe, expect, it } from 'vitest';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';
import {
  BY_SOURCE,
  NONE_KEY,
  browseQuery,
  groupItems,
  groupableFields,
  numericOf,
  readBrowseParams,
  valueOf,
  type BrowseItem,
} from './browse';

const CURATION_URL = 'https://nakamura196.github.io/ndl-face-finder/curations/faces.json';

const WORKS = [
  '絵本江戸土産',
  '名所江戸百景',
  '北斎漫画',
  '東海道五十三次',
  '東京名所図会',
] as const;

/**
 * 顔検出 Curation を模した 40 枚のカード。
 * - 作品: 5 作品（偏りあり: 12, 9, 7, 5, 3 枚）+ メタデータなし 4 枚
 * - 年: '1847年', '1850年', '1858年', '1875年', '不明'
 * - 年代: '江戸時代', '明治時代', '不明'
 * - 性別: '男', '女', '不明'
 * - 信頼度: 0.30〜0.95 のほぼ一意な小数（36 枚中 34 種類）
 * - 検出器: すべて 'kaokore'（1 種類のみ）
 */
function buildFaceCurationItems(): BrowseItem[] {
  const workDistribution: Array<{
    work: (typeof WORKS)[number];
    year: string;
    era: string;
    count: number;
  }> = [
    { work: '絵本江戸土産', year: '1850年', era: '江戸時代', count: 12 },
    { work: '名所江戸百景', year: '1858年', era: '江戸時代', count: 9 },
    { work: '北斎漫画', year: '1847年', era: '江戸時代', count: 7 },
    { work: '東海道五十三次', year: '不明', era: '不明', count: 5 },
    { work: '東京名所図会', year: '1875年', era: '明治時代', count: 3 },
  ];

  const genders = ['男', '男', '女', '男', '女', '不明'];
  const items: BrowseItem[] = [];
  let idx = 0;

  for (const { work, year, era, count } of workDistribution) {
    for (let i = 0; i < count; i++) {
      const gender = genders[idx % genders.length];
      // 0.30 から 0.96 まで少しずつ変え、ほぼ一意な値にする（2 組だけ重複）
      const score = (0.3 + ((idx === 35 ? 0 : idx === 34 ? 1 : idx) * 0.018)).toFixed(3);
      items.push({
        id: `${CURATION_URL}#member-${idx + 1}`,
        label: `顔 ${idx + 1}`,
        manifestUrl: CURATION_URL,
        canvasIndex: null,
        thumbnail: `https://example.org/iiif/${idx + 1}/full/240,/0/default.jpg`,
        group: work,
        summary: work,
        pos: idx + 1,
        metadata: {
          作品: [work],
          年: [year],
          年代: [era],
          性別: [gender],
          信頼度: [score],
          検出器: ['kaokore'],
        },
      });
      idx++;
    }
  }

  // メタデータを持たないカード 4 枚（合計 40 枚）
  for (let i = 0; i < 4; i++) {
    items.push({
      id: `${CURATION_URL}#member-${idx + 1}`,
      label: `未整理 ${i + 1}`,
      manifestUrl: CURATION_URL,
      canvasIndex: null,
      thumbnail: '',
      group: '',
      summary: '',
      pos: idx + 1,
    });
    idx++;
  }

  return items;
}

const faceItems = buildFaceCurationItems();

describe('numericOf', () => {
  it('parses leading integers and decimals, including units like 年', () => {
    expect(numericOf('1858')).toBe(1858);
    expect(numericOf('1858年')).toBe(1858);
    expect(numericOf(' 0.842 ')).toBe(0.842);
    expect(numericOf('-12.5度')).toBe(-12.5);
  });

  it('returns null for non-numeric strings and empty values', () => {
    expect(numericOf('江戸時代')).toBeNull();
    expect(numericOf('不明')).toBeNull();
    expect(numericOf(NONE_KEY)).toBeNull();
  });
});

describe('valueOf', () => {
  it('reads group for BY_SOURCE and first metadata value for named fields', () => {
    expect(valueOf(faceItems[0], BY_SOURCE)).toBe('絵本江戸土産');
    expect(valueOf(faceItems[0], '年')).toBe('1850年');
    expect(valueOf(faceItems[0], '存在しない項目')).toBe(NONE_KEY);
    // メタデータなしカードは NONE_KEY を返す
    expect(valueOf(faceItems[39], '作品')).toBe(NONE_KEY);
    expect(valueOf(faceItems[39], BY_SOURCE)).toBe(NONE_KEY);
  });
});

describe('groupableFields', () => {
  it('selects categorical and year fields while excluding single-value and near-unique fields', () => {
    expect(faceItems).toHaveLength(40);
    const fields = groupableFields(faceItems);
    const names = fields.map((f) => f.name);

    // 資料ごと（BY_SOURCE）が先頭に入り、作品・年・年代・性別が選ばれる
    expect(names).toEqual([BY_SOURCE, '作品', '年', '年代', '性別']);

    const byName = Object.fromEntries(fields.map((f) => [f.name, f.distinct]));
    expect(byName[BY_SOURCE]).toBe(5);
    expect(byName['作品']).toBe(5);
    expect(byName['年']).toBe(5); // 1847年, 1850年, 1858年, 1875年, 不明
    expect(byName['年代']).toBe(3); // 江戸時代, 明治時代, 不明
    expect(byName['性別']).toBe(3); // 男, 女, 不明

    // 1 種類しかない「検出器」と、ほぼ 1 件ずつ違う「信頼度」は除外される
    expect(names).not.toContain('検出器');
    expect(names).not.toContain('信頼度');
  });

  it('excludes fields with URLs, long text, or fewer than 30% populated items', () => {
    const items = faceItems.map((it, i) => ({
      ...it,
      metadata: {
        ...it.metadata,
        参照URL: i < 20 ? ['https://example.org/ref/1'] : ['https://example.org/ref/2'],
        解説: i < 20 ? ['あ'.repeat(45)] : ['い'.repeat(45)],
        // 5/40 = 12.5% (< 30%)。無い項目は鍵ごと省く
        ...(i < 5 ? { まれな注記: [`注記${i % 2}`] } : {}),
      },
    }));
    const names = groupableFields(items).map((f) => f.name);
    expect(names).not.toContain('参照URL');
    expect(names).not.toContain('解説');
    expect(names).not.toContain('まれな注記');
  });

  it('returns an empty list for empty input and omits BY_SOURCE when all items share one source', () => {
    expect(groupableFields([])).toEqual([]);
    const singleSource = faceItems.map((it) => ({ ...it, group: '同じ資料' }));
    const names = groupableFields(singleSource).map((f) => f.name);
    expect(names).not.toContain(BY_SOURCE);
  });
});

describe('groupItems', () => {
  it('sorts categorical fields by descending count, with NONE_KEY last', () => {
    const groups = groupItems(faceItems, '作品');
    expect(groups.map((g) => [g.key, g.indexes.length])).toEqual([
      ['絵本江戸土産', 12],
      ['名所江戸百景', 9],
      ['北斎漫画', 7],
      ['東海道五十三次', 5],
      ['東京名所図会', 3],
      [NONE_KEY, 4],
    ]);
  });

  it('sorts numeric (year) values in ascending numeric order before non-numeric values and NONE_KEY last', () => {
    const groups = groupItems(faceItems, '年');
    // 年の数値は小さい順（件数順ではない）、数値でない「不明」はその次、値なし（NONE_KEY）が最後
    expect(groups.map((g) => g.key)).toEqual([
      '1847年',
      '1850年',
      '1858年',
      '1875年',
      '不明',
      NONE_KEY,
    ]);
    expect(groups.map((g) => g.indexes.length)).toEqual([7, 12, 9, 3, 5, 4]);
  });

  it('preserves original source order for BY_SOURCE while placing NONE_KEY at the end', () => {
    // 先頭に group なしのカードが来ても NONE_KEY は末尾に回ることを確認
    const reordered = [faceItems[39], ...faceItems.slice(0, 39)];
    const groups = groupItems(reordered, BY_SOURCE);
    expect(groups.map((g) => g.key)).toEqual([...WORKS, NONE_KEY]);
    expect(groups.at(-1)?.indexes).toEqual([0, 37, 38, 39]);
  });
});

describe('URL group round-trip', () => {
  const parse = (q: string) => readBrowseParams(new URLSearchParams(q), manifestFromParams);

  it('round-trips grid layout with a custom group field', () => {
    const q = browseQuery(CURATION_URL, { layout: 'grid', group: '性別' });
    expect(q).toContain('layout=grid');
    expect(q).toContain(`group=${encodeURIComponent('性別')}`);

    const parsed = parse(q);
    expect(parsed.url).toBe(CURATION_URL);
    expect(parsed.layout).toBe('grid');
    expect(parsed.group).toBe('性別');
  });

  it('omits group param when group is BY_SOURCE (default) or layout is not grid', () => {
    const defaultGrid = browseQuery(CURATION_URL, { layout: 'grid', group: BY_SOURCE });
    expect(defaultGrid).not.toContain('group=');
    expect(parse(defaultGrid).group).toBeNull();

    const sphereWithGroup = browseQuery(CURATION_URL, { layout: 'sphere', group: '性別' });
    expect(sphereWithGroup).not.toContain('group=');
  });

  it('falls back to the default layout for a removed layout name', () => {
    expect(parse('layout=cube').layout).toBeNull();
  });
});
