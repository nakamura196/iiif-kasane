import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containersOf, type ContainerInfo } from '../services/containers';
import { convertToV4 } from '../services/manifestConverter';
import {
  canvasBehaviorsOf,
  canvasParamTarget,
  collectionEntriesOf,
  contentStateOf,
  groupSpreads,
  hasToc,
  isTocNodeActive,
  compareIndexesOf,
  matchTarget,
  matchTargets,
  remoteGroupsOf,
  resolveCompareItems,
  navigableTree,
  orderOf,
  parseContentState,
  parseDroppedText,
  parseFragment,
  rangesOf,
  sequencesOf,
  splitId,
  startOf,
  pageThumbnailUrl,
  stepArrows,
  viewingOf,
} from './structure';

// Cookbook の v3 レシピ（iiif.io から 2026-10-12 に保存）
const raw = (n: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/structure/${n}.json`, import.meta.url)), 'utf8'));
const load = (n: string) => {
  const manifest = convertToV4(raw(n));
  return { manifest, containers: containersOf(manifest) };
};
const toBase64Url = (s: string) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('断片', () => {
  it('xywh と t を読む', () => {
    expect(parseFragment('xywh=1,2,3,4')).toEqual({ xywh: [1, 2, 3, 4] });
    expect(parseFragment('#t=302.05,3971.24')).toEqual({ t: [302.05, 3971.24] });
    expect(parseFragment('t=3971.24')).toEqual({ t: [3971.24, undefined] });
    expect(parseFragment('xywh=a,b')).toEqual({});
  });
  it('id から断片を分ける', () => {
    expect(splitId('https://x/canvas/1#t=0,9')).toEqual({ id: 'https://x/canvas/1', fragment: { t: [0, 9] } });
  });
  it('splits at a media fragment key even when the values do not parse', () => {
    expect(splitId('https://x/canvas/1#xywh=percent:10,10,20,20')).toEqual({ id: 'https://x/canvas/1', fragment: {} });
    expect(splitId('https://x/canvas/1#t=npt:00:01:00')).toEqual({ id: 'https://x/canvas/1', fragment: {} });
    expect(splitId('https://x/canvas/1#xywh=1,2,3')).toEqual({ id: 'https://x/canvas/1', fragment: {} });
    expect(splitId('https://x/canvas/1#xywh=1,2,3,4&t=5')).toEqual({
      id: 'https://x/canvas/1',
      fragment: { xywh: [1, 2, 3, 4], t: [5, undefined] },
    });
  });
  it('keeps a # that does not start a media fragment key in the id', () => {
    expect(splitId('https://x/m#p1')).toEqual({ id: 'https://x/m#p1', fragment: {} });
    expect(splitId('https://x/m#p1#xywh=1,2,3,4')).toEqual({ id: 'https://x/m#p1', fragment: { xywh: [1, 2, 3, 4] } });
  });
  it('matches the Canvas for fragments that do not parse (canvas=, start)', () => {
    const list = [{ id: 'https://x/canvas/1' }, { id: 'https://x/m#p1' }] as unknown as ContainerInfo[];
    expect(canvasParamTarget('https://x/canvas/1#xywh=percent:10,10,20,20', list)?.index).toBe(0);
    expect(canvasParamTarget('https://x/m#p1#xywh=1,2,3,4', list)).toMatchObject({ index: 1, xywh: [1, 2, 3, 4] });
    expect(startOf({ start: { id: 'https://x/canvas/1#t=npt:00:01:00', type: 'Canvas' } }, list)?.index).toBe(0);
  });
});

describe('読む向きと前へ／次へ の矢印', () => {
  it('左から右・右から左は横の矢印。右から左は「次へ」を左に置く', () => {
    expect(stepArrows('left-to-right')).toEqual({ prev: '←', next: '→', nextFirst: false, vertical: false });
    expect(stepArrows('right-to-left')).toEqual({ prev: '→', next: '←', nextFirst: true, vertical: false });
  });
  it('上から下・下から上は縦の矢印。下から上は「次へ」が上（先）', () => {
    expect(stepArrows('top-to-bottom')).toEqual({ prev: '↑', next: '↓', nextFirst: false, vertical: true });
    expect(stepArrows('bottom-to-top')).toEqual({ prev: '↓', next: '↑', nextFirst: true, vertical: true });
  });
});

describe('見せ方 0009・0010・0011', () => {
  it('0009 behavior: paged、左から右', () => {
    expect(viewingOf(raw('0009'))).toMatchObject({ mode: 'paged', direction: 'left-to-right' });
  });
  it('0010 viewingDirection: right-to-left', () => {
    expect(viewingOf(raw('0010'))).toMatchObject({ mode: 'individuals', direction: 'right-to-left' });
  });
  it('0011 behavior: continuous', () => {
    expect(viewingOf(raw('0011')).mode).toBe('continuous');
  });
  it('既定は individuals', () => {
    expect(viewingOf({})).toMatchObject({ mode: 'individuals', direction: 'left-to-right' });
  });
  it('paged の見開き: 先頭は単独、あとは 2 枚ずつ', () => {
    expect(groupSpreads([0, 1, 2, 3, 4], 'paged', () => false)).toEqual([[0], [1, 2], [3, 4]]);
    expect(groupSpreads([0, 1, 2, 3, 4], 'paged', (i) => i === 2)).toEqual([[0], [1], [2], [3, 4]]);
    expect(groupSpreads([0, 1, 2], 'individuals', () => false)).toEqual([[0], [1], [2]]);
  });
  it('Canvas ごとの behavior', () => {
    const m = { items: [{ id: 'a', behavior: ['non-paged'] }, { id: 'b' }] };
    expect(canvasBehaviorsOf(m).get('a')).toEqual(['non-paged']);
    expect(canvasBehaviorsOf(m).get('b')).toEqual([]);
  });
});

describe('start 0015・0202', () => {
  it('0202 start が Canvas（p2）を指す', () => {
    const { manifest, containers } = load('0202');
    const s = startOf(manifest, containers);
    expect(s?.canvasId).toMatch(/canvas\/p2$/);
    expect(s?.index).toBe(1);
  });
  it('0015 start が SpecificResource（PointSelector の t=120.5）', () => {
    const { manifest, containers } = load('0015');
    const s = startOf(manifest, containers);
    expect(s).toMatchObject({ index: 0, t: [120.5, undefined] });
  });
  it('start が無ければ null', () => {
    const { manifest, containers } = load('0009');
    expect(startOf(manifest, containers)).toBeNull();
  });
});

describe('URL の canvas 引数', () => {
  it('1 から数えたコマの番号', () => {
    const { containers } = load('0202');
    expect(canvasParamTarget('2', containers)).toEqual({ canvasId: containers[1].id, index: 1 });
  });
  it('Canvas の URI（断片つき）', () => {
    const { containers } = load('0202');
    const t = canvasParamTarget(`${containers[1].id}#xywh=10,20,30,40`, containers);
    expect(t).toMatchObject({ canvasId: containers[1].id, index: 1, xywh: [10, 20, 30, 40] });
  });
  it('範囲の外・0・知らない URI・空は null', () => {
    const { containers } = load('0202');
    expect(canvasParamTarget(String(containers.length + 1), containers)).toBeNull();
    expect(canvasParamTarget('0', containers)).toBeNull();
    expect(canvasParamTarget('https://example.org/none', containers)).toBeNull();
    expect(canvasParamTarget(null, containers)).toBeNull();
  });
});

describe('目次 0024・0025・0026・0027・0031・0064・0065・0229', () => {
  it('0024 Range の入れ子（目次 > 章 > 曜日）', () => {
    const [root] = rangesOf(raw('0024'));
    expect(root.children).toHaveLength(2);
    const [r1, r2] = root.children;
    expect(r1.canvases.map((c) => c.canvasId.split('/').pop())).toEqual(['p1', 'p2']);
    expect(r1.target?.canvasId).toMatch(/p1$/);
    expect(r2.children).toHaveLength(2);
    expect(r2.target?.canvasId).toMatch(/p3$/);
  });
  it('0025 SpecificResource の領域（xywh）へ飛ぶ', () => {
    const [root] = rangesOf(raw('0025'));
    const article = root.children[0];
    expect(article.canvases).toHaveLength(4);
    expect(article.target).toMatchObject({ canvasId: expect.stringMatching(/canvas\/p2$/), xywh: [553, 1157, 470, 1103] });
  });
  it('0026・0064 Canvas の時間の範囲（#t=）', () => {
    const [root] = rangesOf(raw('0064'));
    const act1 = root.children[0];
    const first = act1.children[0];
    expect(first.target).toMatchObject({ canvasId: expect.stringMatching(/canvas\/1$/), t: [0, 302.05] });
    expect(rangesOf(raw('0026'))[0].children[1].target?.t).toEqual([3971.24, undefined]);
  });
  it('0065 複数の Canvas にまたがる', () => {
    const [root] = rangesOf(raw('0065'));
    expect(root.children[1].target?.canvasId).toMatch(/canvas\/2$/);
    expect(root.children[1].target?.t).toEqual([0, 3307.22]);
  });
  it('0031 製本された複数巻', () => {
    const [root] = rangesOf(raw('0031'));
    expect(root.children.length).toBeGreaterThanOrEqual(3);
  });
  it('0229 no-nav は出さず、thumbnail-nav の Range に縮小画像がある', () => {
    const tree = rangesOf(raw('0229'));
    expect(tree[0].behavior).toContain('thumbnail-nav');
    expect(tree[0].children[0].noNav).toBe(true);
    const nav = navigableTree(tree);
    expect(nav[0].children.some((c) => c.noNav)).toBe(false);
    expect(nav[0].children[0].thumbnail).toMatch(/thumb-nav-01\.png$/);
    expect(hasToc(raw('0229'))).toBe(true);
  });
  it('0027 代替のページ順（sequence）', () => {
    const m = raw('0027');
    expect(rangesOf(m)).toEqual([]);
    expect(hasToc(m)).toBe(false);
    const seqs = sequencesOf(m);
    expect(seqs).toHaveLength(2);
    const { containers } = load('0027');
    expect(orderOf(containers, null)).toEqual([0, 1, 2, 3]);
    expect(orderOf(containers, seqs[1])).toEqual([1, 2, 3, 0]);
  });
  it('構造の無いマニフェストでは空', () => {
    expect(rangesOf(raw('0009'))).toEqual([]);
    expect(sequencesOf(raw('0009'))).toEqual([]);
  });
});

describe('content state 0485・0540・0599', () => {
  it('0485 Canvas の領域を指す Annotation（JSON）', () => {
    const state = contentStateOf(raw('0485'));
    expect(state?.manifestUrl).toBe('https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json');
    expect(state?.targets).toEqual([
      {
        canvasId: 'https://iiif.io/api/cookbook/recipe/0009-book-1/canvas/p2',
        xywh: [1528, 3024, 344, 408],
        manifestUrl: 'https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json',
      },
    ]);
    const { containers } = load('0009');
    expect(matchTarget(state!.targets, containers)).toMatchObject({ index: 1, xywh: [1528, 3024, 344, 408] });
  });
  it('base64url（URL エンコードした JSON）も、素の JSON も読める', () => {
    const json = JSON.stringify(raw('0485'));
    const viaUri = toBase64Url(encodeURIComponent(json));
    const plain = toBase64Url(json);
    expect(parseContentState(viaUri)?.targets[0].xywh).toEqual([1528, 3024, 344, 408]);
    expect(parseContentState(plain)?.targets[0].xywh).toEqual([1528, 3024, 344, 408]);
    expect(parseContentState(encodeURIComponent(json))?.targets).toHaveLength(1);
  });
  it('0540 複数の Canvas（別々の Manifest）を指す', () => {
    const state = contentStateOf({
      type: 'Annotation',
      motivation: ['contentState'],
      target: [
        { id: 'https://ex.org/a/canvas/2', type: 'Canvas', partOf: [{ id: 'https://ex.org/a/manifest.json', type: 'Manifest' }] },
        { id: 'https://ex.org/b/canvas/p2', type: 'Canvas', partOf: [{ id: 'https://ex.org/b/manifest.json', type: 'Manifest' }] },
      ],
    });
    expect(state?.manifestUrl).toBe('https://ex.org/a/manifest.json');
    expect(state?.targets.map((t) => t.manifestUrl)).toEqual([
      'https://ex.org/a/manifest.json',
      'https://ex.org/b/manifest.json',
    ]);
  });
  it('0540 レシピの content state が指す Canvas をすべて探す', () => {
    const state = contentStateOf(raw('0540'));
    const base = 'https://iiif.io/api/cookbook/recipe/0540-link-for-opening-multiple-canvases';
    expect(state?.targets.map((t) => t.canvasId)).toEqual([`${base}/canvas/2`, `${base}/canvas/p2`]);
    expect(state?.targets.map((t) => t.manifestUrl)).toEqual([`${base}/manifest-2.json`, `${base}/manifest.json`]);
    // 2 つの Manifest の Canvas を、1 つの container の並びに入れた場合（比較ビュー）
    const a = load('0540-manifest-2').containers;
    const b = load('0540-manifest').containers;
    const matched = matchTargets(state!.targets, [...b, ...a]);
    expect(matched.map((m) => m.canvasId)).toEqual([`${base}/canvas/2`, `${base}/canvas/p2`]);
    expect(matched.map((m) => m.index)).toEqual([2, 1]);
    expect(compareIndexesOf(matched)).toEqual([2, 1]);
    // 開いた Manifest に含まれる Canvas だけが当たる。先頭は matchTarget と同じ
    expect(matchTargets(state!.targets, b).map((m) => m.index)).toEqual([1]);
    expect(compareIndexesOf(matchTargets(state!.targets, b))).toEqual([]);
    expect(matchTarget(state!.targets, [...b, ...a])).toEqual(matched[0]);
    expect(matchTargets(state!.targets, [])).toEqual([]);
  });
  it('0540 別々のマニフェストの Canvas: マニフェストごとにまとめ、target の順に並べる', () => {
    const state = contentStateOf(raw('0540'))!;
    const base = 'https://iiif.io/api/cookbook/recipe/0540-link-for-opening-multiple-canvases';
    const a = load('0540-manifest-2').containers;
    const b = load('0540-manifest').containers;
    // manifest-2 を開いた場合、足りない Canvas は manifest.json にある
    expect(remoteGroupsOf(state.targets, a).map((g) => [g.manifestUrl, g.targets.map((t) => t.canvasId)])).toEqual([
      [`${base}/manifest.json`, [`${base}/canvas/p2`]],
    ]);
    // 同じマニフェストの Canvas だけなら、取りに行くものは無い（従来どおり）
    expect(remoteGroupsOf(state.targets, [...a, ...b])).toEqual([]);
    expect(remoteGroupsOf([{ canvasId: a[0].id }], a)).toEqual([]);
    const items = resolveCompareItems(state.targets, [
      { label: 'A', containers: a },
      { manifestUrl: `${base}/manifest.json`, label: 'B', containers: b },
    ]);
    expect(items.map((i) => [i.container.id, i.manifestLabel])).toEqual([
      [`${base}/canvas/2`, 'A'],
      [`${base}/canvas/p2`, 'B'],
    ]);
    // 読めなかったマニフェストの分は欠け、残りだけ返る
    const partial = resolveCompareItems(state.targets, [{ label: 'A', containers: a }]);
    expect(partial.map((i) => i.manifestLabel)).toEqual(['A']);
    // manifestUrl が違う source からは拾わない
    expect(
      resolveCompareItems(state.targets, [
        { label: 'A', containers: a },
        { manifestUrl: 'https://ex.org/other.json', label: 'X', containers: b },
      ]).map((i) => i.manifestLabel),
    ).toEqual(['A']);
  });
  it('matchTargets: 同じ Canvas・領域の重複は 1 つにまとめ、領域が違えば別に数える', () => {
    const { containers } = load('0009');
    const id = containers[1].id;
    const same = matchTargets([{ canvasId: id }, { canvasId: id }], containers);
    expect(same).toHaveLength(1);
    const regions = matchTargets([{ canvasId: id, xywh: [0, 0, 1, 1] }, { canvasId: id, xywh: [2, 2, 3, 3] }], containers);
    expect(regions).toHaveLength(2);
    expect(compareIndexesOf(regions)).toEqual([]);
  });
  it('0599 マニフェストを指す Annotation（ドロップ）', () => {
    const state = contentStateOf(raw('0599'));
    expect(state).toEqual({
      manifestUrl: 'https://iiif.io/api/cookbook/recipe/0006-text-language/manifest.json',
      targets: [],
    });
    const dropped = parseDroppedText('https://viewer.example/?iiif-content=' + encodeURIComponent('https://ex.org/m.json'));
    expect(dropped?.manifestUrl).toBe('https://ex.org/m.json');
    expect(parseDroppedText('https://ex.org/m.json')?.manifestUrl).toBe('https://ex.org/m.json');
  });
  it('SpecificResource の source と FragmentSelector', () => {
    const state = contentStateOf({
      type: 'Annotation',
      target: {
        type: 'SpecificResource',
        source: { id: 'https://ex.org/c/1', type: 'Canvas', partOf: [{ id: 'https://ex.org/m', type: 'Manifest' }] },
        selector: { type: 'FragmentSelector', value: 'xywh=10,20,30,40' },
      },
    });
    expect(state?.targets[0]).toMatchObject({ canvasId: 'https://ex.org/c/1', xywh: [10, 20, 30, 40] });
    expect(state?.manifestUrl).toBe('https://ex.org/m');
  });
  it('読めない値は null', () => {
    expect(parseContentState('!!!')).toBeNull();
    expect(parseContentState(null)).toBeNull();
  });
});

describe('Collection 0030・0032・0068', () => {
  it('0032 項目はマニフェスト 2 件', () => {
    const entries = collectionEntriesOf(raw('0032'));
    expect(entries.map((e) => e.type)).toEqual(['Manifest', 'Manifest']);
    expect(entries[0].id).toMatch(/manifest-01\.json$/);
  });
  it('0068 入れ子の Collection も拾う', () => {
    const entries = collectionEntriesOf(raw('0068'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.id.startsWith('https://'))).toBe(true);
  });
  it('0030 複数巻', () => {
    expect(collectionEntriesOf(raw('0030')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('0464 他のマニフェストの Canvas を再利用', () => {
  it('Canvas の id が元のレシピのもの', () => {
    const { containers } = load('0464');
    expect(containers[0].id).toMatch(/0008-rights\/canvas\/p1$/);
  });
});

describe('サムネイル', () => {
  it('IIIF Image API の URL を小さくする', () => {
    const { containers } = load('0009');
    const url = pageThumbnailUrl(containers[0]);
    expect(url).toBeDefined();
  });
  it('Canvas の thumbnail を優先する', () => {
    const { containers } = load('0009');
    expect(pageThumbnailUrl(containers[0], { thumbnail: [{ id: 'https://ex.org/t.jpg' }] })).toBe('https://ex.org/t.jpg');
  });
});

describe('目次の「いま見ている所」（時間つき）', () => {
  const canvas = 'https://example.org/c1';
  const range = (id: string, t: string) => ({
    id,
    type: 'Range',
    label: { en: [id] },
    items: [{ type: 'SpecificResource', source: canvas, selector: { type: 'FragmentSelector', value: `t=${t}` } }],
  });
  const manifest = {
    structures: [
      { id: 'all', type: 'Range', items: [range('intro', '0,8'), range('middle', '8,14'), range('end', '14')] },
    ],
  };
  const tree = rangesOf(manifest);
  const active = (time: number) => {
    const out: string[] = [];
    const walk = (nodes: typeof tree) =>
      nodes.forEach((n) => {
        if (isTocNodeActive(n, canvas, time)) out.push(n.id);
        walk(n.children);
      });
    walk(tree);
    return out;
  };

  it('再生位置が入る範囲の項目だけが当たる（親は子に当たれば当たる）', () => {
    expect(active(0)).toEqual(['all', 'intro']);
    expect(active(7.99)).toEqual(['all', 'intro']);
    expect(active(8)).toEqual(['all', 'middle']);
    expect(active(100)).toEqual(['all', 'end']);
  });

  it('別の Canvas では当たらない', () => {
    expect(isTocNodeActive(tree[0].children[0], 'https://example.org/other', 1)).toBe(false);
    expect(isTocNodeActive(tree[0].children[0], undefined, 1)).toBe(false);
  });

  it('時間の無い項目は Canvas が同じなら当たる', () => {
    const plain = rangesOf({
      structures: [{ id: 'p', type: 'Range', items: [{ id: canvas, type: 'Canvas' }] }],
    });
    expect(isTocNodeActive(plain[0], canvas, 999)).toBe(true);
  });
});
