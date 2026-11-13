import { describe, expect, it } from 'vitest';
import { readCanvasAnnotations } from '../annotations';
import {
  annotationPlainText,
  collectManifestAnnotations,
  foldForSearch,
  manifestHasCanvasAnnotations,
  searchLocalAnnotations,
} from './local';
import { contentSearchAnnotationPage } from './index';

const C1 = 'https://example.org/canvas/1';
const C2 = 'https://example.org/canvas/2';

const anno = (id: string, value: string, target: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'Annotation',
  motivation: 'commenting',
  body: { type: 'TextualBody', value, ...extra },
  target,
});

const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'AnnotationPage', items, ...extra });

const manifest = {
  id: 'https://example.org/manifest',
  type: 'Manifest',
  items: [
    {
      id: C1,
      type: 'Canvas',
      width: 1000,
      height: 800,
      annotations: [page([anno('a1', 'Ｔｏｋｙｏ の地図。tokyo 駅', `${C1}#xywh=10,20,30,40`)])],
    },
    { id: C2, type: 'Canvas', width: 1000, height: 800, annotations: ['https://example.org/page/2'] },
  ],
};

describe('foldForSearch', () => {
  it('ignores case and full/half width, and maps back to the original', () => {
    const { folded, at } = foldForSearch('ＡbＣ');
    expect(folded).toBe('abc');
    expect(at).toEqual([0, 1, 2, 3]);
  });
  it('keeps the map when one character becomes several', () => {
    const { folded, at } = foldForSearch('㈱x');
    expect(folded).toBe('(株)x');
    expect(at).toEqual([0, 0, 0, 1, 2]);
  });
});

describe('annotationPlainText', () => {
  it('strips HTML and decodes entities', () => {
    const [a] = readCanvasAnnotations(C1, [page([anno('h', '<p>A &amp; B<br>C&#x3042;</p>', C1, { format: 'text/html' })])]);
    expect(annotationPlainText(a)).toBe('A & B Cあ');
  });
});

describe('searchLocalAnnotations', () => {
  const annotations = readCanvasAnnotations(C1, manifest.items[0].annotations as unknown[], { width: 1000, height: 800 });

  it('finds every occurrence, with the text around it and the region', () => {
    const ms = searchLocalAnnotations([{ canvasId: C1, annotations }], 'tokyo');
    expect(ms.map((m) => m.match)).toEqual(['Ｔｏｋｙｏ', 'tokyo']);
    expect(ms[0].after).toBe(' の地図。tokyo 駅');
    expect(ms[1].before).toBe('Ｔｏｋｙｏ の地図。');
    expect(ms[0].regions[0].xywh).toEqual([10, 20, 30, 40]);
    expect(new Set(ms.map((m) => m.id)).size).toBe(2);
  });

  it('matches Japanese and counts the same annotation once', () => {
    const ms = searchLocalAnnotations(
      [
        { canvasId: C1, annotations },
        { canvasId: C1, annotations },
      ],
      '地図',
    );
    expect(ms).toHaveLength(1);
  });

  it('keeps the granularity and turns into marks on the image', () => {
    const ocr = readCanvasAnnotations(C2, [
      page([{ ...anno('l1', '吾輩は猫である', `${C2}#xywh=1,2,3,4`), motivation: 'supplementing', textGranularity: 'line' }]),
    ]);
    const ms = searchLocalAnnotations([{ canvasId: C2, annotations: ocr }], '猫');
    expect(ms[0].granularity).toBe('line');
    const marks = contentSearchAnnotationPage(C2, ms) as { items: { id: string; target: string }[] };
    expect(marks.items).toEqual([expect.objectContaining({ id: ms[0].id, target: `${C2}#xywh=1,2,3,4` })]);
  });

  it('returns nothing for an empty query', () => {
    expect(searchLocalAnnotations([{ canvasId: C1, annotations }], '  ')).toEqual([]);
  });
});

describe('collectManifestAnnotations', () => {
  it('reads written annotations and fetches the referred pages', async () => {
    const fetched: string[] = [];
    const fetchJson = async (url: string) => {
      fetched.push(url);
      if (url === 'https://example.org/page/2') return page([anno('b1', 'second page', `${C2}#xywh=5,5,5,5`)], { next: 'https://example.org/page/2b' });
      if (url === 'https://example.org/page/2b') return page([anno('b2', 'more', C2)]);
      throw new Error('404');
    };
    const progress: [number, number][] = [];
    const { sources, failed, skipped } = await collectManifestAnnotations(manifest, fetchJson, {
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(fetched).toEqual(['https://example.org/page/2', 'https://example.org/page/2b']);
    expect(sources.find((s) => s.canvasId === C2)?.annotations.map((a) => a.id)).toEqual(['b1', 'b2']);
    expect(failed).toBe(0);
    expect(skipped).toBe(0);
    expect(progress.at(-1)).toEqual([1, 1]);
  });

  it('counts pages it could not fetch or did not fetch', async () => {
    const many = {
      ...manifest,
      items: [1, 2, 3].map((n) => ({ id: `${C1}/${n}`, type: 'Canvas', annotations: [`https://example.org/missing/${n}`] })),
    };
    const r = await collectManifestAnnotations(many, async () => Promise.reject(new Error('404')), { maxFetches: 2 });
    expect(r.failed).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it('tells whether any Canvas has annotations', () => {
    expect(manifestHasCanvasAnnotations(manifest)).toBe(true);
    expect(manifestHasCanvasAnnotations({ items: [{ id: C1, type: 'Canvas' }] })).toBe(false);
  });
});

describe('annotationPlainText and tags', () => {
  const read = (items: unknown[]) => readCanvasAnnotations(C1, [page(items)], {}, new Set([C1]));
  it('leaves out tagging bodies (by purpose, or by the sole motivation)', () => {
    const [byPurpose, byMotivation, text] = read([
      anno('t1', 'block_fig', `${C1}#xywh=0,0,10,10`, { purpose: 'tagging' }),
      { ...anno('t2', 'block_fig', `${C1}#xywh=0,0,10,10`), motivation: 'tagging' },
      { ...anno('s1', 'はといひければ', `${C1}#xywh=0,0,10,10`), motivation: 'supplementing' },
    ]);
    expect(annotationPlainText(byPurpose)).toBe('');
    expect(annotationPlainText(byMotivation)).toBe('');
    expect(annotationPlainText(text)).toBe('はといひければ');
  });
  it('does not match a class name in search', () => {
    const annotations = read([anno('t1', 'block_fig', `${C1}#xywh=0,0,10,10`, { purpose: 'tagging' })]);
    expect(searchLocalAnnotations([{ canvasId: C1, annotations }], 'fig')).toEqual([]);
  });
});
