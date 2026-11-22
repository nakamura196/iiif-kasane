import { describe, expect, it } from 'vitest';
import {
  alignmentOf,
  candidatesOfManifest,
  compareDetailWidthOf,
  cropSide,
  curationCandidatesOf,
  parseAlignment,
  warpAt,
  fitSide,
  fitSidesPhysically,
  infoCandidateOf,
  isCollectionJson,
  isImageInfoJson,
  memberManifestUrlsOf,
  type CompareSide,
} from './compareSources';

const canvas = (id: string, w: number, h: number, label: string) => ({
  id,
  type: 'Canvas',
  label: { none: [label] },
  width: w,
  height: h,
  items: [
    {
      type: 'AnnotationPage',
      items: [
        {
          type: 'Annotation',
          motivation: 'painting',
          body: {
            id: `${id}/full/max/0/default.jpg`,
            type: 'Image',
            width: w,
            height: h,
            service: [{ id: `${id}-img`, type: 'ImageService3' }],
          },
          target: id,
        },
      ],
    },
  ],
});

describe('compareSources', () => {
  it('info.json を見分ける', () => {
    expect(isImageInfoJson({ '@context': 'http://iiif.io/api/image/2/context.json', '@id': 'u', width: 1, height: 1 })).toBe(true);
    expect(isImageInfoJson({ protocol: 'http://iiif.io/api/image', width: 1, height: 1 })).toBe(true);
    expect(isImageInfoJson({ type: 'Manifest', '@context': 'http://iiif.io/api/presentation/3/context.json' })).toBe(false);
    expect(isImageInfoJson({ '@type': 'sc:Manifest' })).toBe(false);
  });

  it('info.json から 1 枚の候補を作る（名前は info.json の前の部分）', () => {
    const c = infoCandidateOf(
      { '@context': 'http://iiif.io/api/image/2/context.json', '@id': 'https://e.org/iiif/map.jp2', width: 400, height: 300 },
      'https://e.org/iiif/map.jp2/info.json',
    );
    expect(c?.label).toBe('map.jp2');
    expect(c?.side).toMatchObject({ width: 400, height: 300 });
    expect(c?.side.layers[0].service).toEqual({ id: 'https://e.org/iiif/map.jp2', version: 2 });
  });

  it('Manifest: Canvas が 1 つなら Manifest の名前、複数なら「Manifest — Canvas」', () => {
    const one = { type: 'Manifest', label: { ja: ['地図'] }, items: [canvas('c1', 100, 50, 'p1')] };
    expect(candidatesOfManifest(one, 'ja').map((c) => c.label)).toEqual(['地図']);
    const two = { ...one, items: [canvas('c1', 100, 50, 'p1'), canvas('c2', 80, 80, 'p2')] };
    const out = candidatesOfManifest(two, 'ja');
    expect(out.map((c) => c.label)).toEqual(['地図 — p1', '地図 — p2']);
    expect(out[1].side).toMatchObject({ width: 80, height: 80 });
  });

  it('Collection の Manifest だけを拾う', () => {
    const col = { type: 'Collection', items: [{ id: 'm1', type: 'Manifest' }, { id: 'c', type: 'Collection' }, { id: 'm2', type: 'Manifest' }] };
    expect(isCollectionJson(col)).toBe(true);
    expect(memberManifestUrlsOf(col)).toEqual(['m1', 'm2']);
  });

  it('fitSide: A の枠に縦横比を保って収め、中央に置く', () => {
    const layer = { url: 'u', rotation: 0, mirror: false, annotations: [] };
    const b: CompareSide = { layers: [layer], width: 100, height: 100 };
    const fitted = fitSide(b, { width: 400, height: 200 });
    expect(fitted).toMatchObject({ width: 400, height: 200 });
    expect(fitted.layers[0].target).toEqual({ x: 100, y: 0, w: 200, h: 200 });
    // 同じ大きさなら、そのまま
    expect(fitSide(b, { width: 100, height: 100 })).toBe(b);
  });

  it('fitSidesPhysically: places two sides in a shared millimetre frame', () => {
    const layer = { url: 'u', rotation: 0, mirror: false, annotations: [] };
    const large: CompareSide = {
      layers: [layer],
      width: 1000,
      height: 500,
      physdim: { scale: 0.731, units: 'cm' }, // 7310 x 3655 mm
    };
    const small: CompareSide = {
      layers: [layer],
      width: 1000,
      height: 500,
      physdim: { scale: 0.968, units: 'mm' }, // 968 x 484 mm
    };
    const pair = fitSidesPhysically(large, small);
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    expect(a.width).toBeCloseTo(7310, 5);
    expect(a.height).toBeCloseTo(3655, 5);
    expect(b.width).toBeCloseTo(7310, 5);
    expect(b.height).toBeCloseTo(3655, 5);
    expect(a.layers[0].target).toEqual({ x: 0, y: 0, w: 7310, h: 3655 });
    expect(b.layers[0].target?.w).toBeCloseTo(968, 5);
    expect(b.layers[0].target?.h).toBeCloseTo(484, 5);
    expect(b.layers[0].target?.x).toBeCloseTo((7310 - 968) / 2, 5);
    expect(b.layers[0].target?.y).toBeCloseTo((3655 - 484) / 2, 5);
    expect(fitSidesPhysically(large, { layers: [layer], width: 100, height: 100 })).toBeNull();
  });

  it('compareDetailWidthOf: B の細かさを A の枠の幅に直して比べる', () => {
    const layer = { url: 'u', rotation: 0, mirror: false, annotations: [] };
    const a: CompareSide = { layers: [{ ...layer, width: 1000 }], width: 400, height: 200 };
    const b = fitSide({ layers: [{ ...layer, width: 5000 }], width: 100, height: 100 }, a);
    // B は枠の幅 400 のうち 200 を使う → 5000 px が 200 に入る → 枠の幅では 10000
    expect(compareDetailWidthOf(a, b)).toBe(10000);
  });
});

describe('キュレーションの見比べ', () => {
  const m = { id: 'https://ex/m', type: 'Manifest', label: { none: ['本'] }, items: [canvas('https://ex/c1', 4000, 3000, '1')] };
  const curation = {
    '@type': 'cr:Curation',
    label: '引目',
    selections: [
      {
        '@type': 'sc:Range',
        within: { '@id': 'https://ex/m', '@type': 'sc:Manifest' },
        members: [
          { '@id': 'https://ex/c1#xywh=100,200,300,400', label: '[1]' },
          { '@id': 'https://ex/c9#xywh=0,0,1,1', label: '[2]' },
        ],
      },
    ],
  };

  it('member ごとに、領域で切り出した画像になる（Canvas の無い member は飛ばす）', () => {
    const got = curationCandidatesOf(curation, new Map([['https://ex/m', m]]), 'ja');
    expect(got).toHaveLength(1);
    expect(got[0].label).toBe('引目 — [1]');
    expect(got[0].id).toBe('https://ex/c1#xywh=100,200,300,400');
    expect(got[0].side.width).toBe(300);
    expect(got[0].side.height).toBe(400);
    expect(got[0].side.layers[0].regionSpec).toBe('100,200,300,400');
    expect(got[0].side.layers[0].target).toEqual({ x: 0, y: 0, w: 300, h: 400 });
  });

  it('画像の画素と Canvas の単位が違っても、画像の側の領域を頼む', () => {
    const layer = { url: 'u', width: 8000, height: 6000, rotation: 0, mirror: false, annotations: [] };
    const got = cropSide({ layers: [layer], width: 4000, height: 3000 }, { x: 100, y: 200, w: 300, h: 400 });
    expect(got.layers[0].regionSpec).toBe('200,400,600,800');
  });

  it('位置合わせの組を引く（逆向きの組は逆変換）', () => {
    const al = parseAlignment({
      pairs: [
        { a: 'A1', b: 'B1', matrix: [2, 0, 0, 2, 10, 20] },
        { a: 'A2', b: 'B2', matrix: null },
      ],
    });
    expect(alignmentOf(al, 'A1', 'B1')).toEqual({ matrix: [2, 0, 0, 2, 10, 20] });
    expect(alignmentOf(al, 'B1', 'A1')).toEqual({ matrix: [0.5, -0, -0, 0.5, -5, -10] });
    expect(alignmentOf(al, 'A2', 'B2')).toBeNull();
    expect(alignmentOf(al, 'A3', 'B3')).toBeUndefined();
  });

  it('局所補正の格子を読み、点ごとのずれを双線形で引く（逆向きの組では格子を使わない）', () => {
    const warp = { x: [0, 10], y: [0, 20], d: [0, 0, 2, 0, 0, 4, 2, 4] };
    const al = parseAlignment({
      pairs: [
        { a: 'A1', b: 'B1', matrix: [1, 0, 0, 1, 0, 0], warp },
        { a: 'A2', b: 'B2', matrix: [1, 0, 0, 1, 0, 0], warp: { x: [0, 10], y: [0, 20], d: [1, 2] } },
      ],
    });
    const t = alignmentOf(al, 'A1', 'B1');
    expect(t?.warp).toEqual(warp);
    expect(warpAt(t!.warp!, 5, 10)).toEqual([1, 2]);
    expect(warpAt(t!.warp!, 10, 0)).toEqual([2, 0]);
    expect(warpAt(t!.warp!, 30, -5)).toEqual([2, 0]);
    expect(alignmentOf(al, 'B1', 'A1')?.warp).toBeUndefined();
    expect(alignmentOf(al, 'A2', 'B2')).toEqual({ matrix: [1, 0, 0, 1, 0, 0] });
  });
});
