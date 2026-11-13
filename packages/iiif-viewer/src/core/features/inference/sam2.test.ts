import { describe, expect, it } from 'vitest';
import {
  imageToCanvasOf,
  maskToPolygon,
  readCanvasAnnotations,
  sam2BoxInput,
  sam2Crop,
  sam2MaskToCrop,
  sam2Outline,
  sam2PointInput,
  sam2ViewCrop,
  SAM2_MASK,
  simplifyRing,
  toAnnotationPage,
  traceBoundary,
  type InferenceOutput,
} from '..';

const grid = (rows: string[]) => ({
  mask: Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0)),
  w: rows[0].length,
  h: rows.length,
});

describe('マスクの輪郭', () => {
  it('四角の外周を、角の 4 点に間引く', () => {
    const { mask, w, h } = grid(['.....', '.###.', '.###.', '.###.', '.....']);
    expect(traceBoundary(mask, w, h)).toHaveLength(8);
    expect(maskToPolygon(mask, w, h)).toEqual([
      [1.5, 1.5],
      [3.5, 1.5],
      [3.5, 3.5],
      [1.5, 3.5],
    ]);
  });

  it('細いくびれで止まらずに一周する。離れた小さなかけらは捨てる', () => {
    const { mask, w, h } = grid([
      '##....##',
      '##....##',
      '.######.',
      '........',
      '#.......',
    ]);
    const ring = traceBoundary(mask, w, h);
    // 左上の 2x2、横棒、右上の 2x2 の外周をすべて通る
    expect(ring).toContainEqual([7, 0]);
    expect(ring).toContainEqual([6, 2]);
    const poly = maskToPolygon(mask, w, h, 0)!;
    expect(poly.some(([x, y]) => x === 0.5 && y === 4.5)).toBe(false);
  });

  it('空のマスクは null', () => {
    expect(maskToPolygon(new Uint8Array(9), 3, 3)).toBeNull();
  });

  it('間引きは一直線上の点を落とす', () => {
    expect(simplifyRing([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]], 0.1)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });
});

describe('SAM 2.1', () => {
  it('枠のまわりを 2.5 倍で切り出し、画像の端で止める', () => {
    expect(sam2Crop({ x0: 100, y0: 100, x1: 140, y1: 140 }, 1000, 1000)).toEqual({ x0: 40, y0: 40, x1: 200, y1: 200 });
    expect(sam2Crop({ x0: 0, y0: 0, x1: 100, y1: 50 }, 1000, 1000)).toEqual({ x0: 0, y0: 0, x1: 175, y1: 150 });
  });

  it('枠を、切り出した部分を 1,024 角に引き伸ばした座標にする', () => {
    expect(sam2BoxInput({ x0: 50, y0: 60, x1: 100, y1: 110 }, { x0: 0, y0: 10, x1: 200, y1: 410 })).toEqual([256, 128, 512, 256]);
  });

  it('クリックのときは、画面に見えている部分を切り出す。狭すぎれば広げ、画像の端で止める', () => {
    expect(sam2ViewCrop({ x0: -50, y0: 100, x1: 600, y1: 700 }, 1000, 800)).toEqual({ x0: 0, y0: 100, x1: 600, y1: 700 });
    expect(sam2ViewCrop({ x0: 480, y0: 10, x1: 520, y1: 50 }, 1000, 800)).toEqual({ x0: 372, y0: 0, x1: 628, y1: 256 });
    expect(sam2ViewCrop({ x0: 0, y0: 0, x1: 50, y1: 50 }, 100, 100)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
  });

  it('クリックした点を、切り出した部分を 1,024 角に引き伸ばした座標と、内（1）・外（0）にする', () => {
    const crop = { x0: 100, y0: 0, x1: 300, y1: 400 };
    expect(sam2PointInput([{ x: 200, y: 100, positive: true }, { x: 150, y: 300, positive: false }], crop)).toEqual({
      coords: [512, 256, 256, 768],
      labels: [1, 0],
    });
  });

  it('256 角のマスクを、切り出した部分の大きさにする', () => {
    const m = new Float32Array(4).fill(-1);
    m[3] = 1; // 2x2 の右下だけ内側
    expect(Array.from(sam2MaskToCrop(m, 4, 4, 2))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('3 つのマスクのうち、確からしさの高いものを画像の座標の多角形にする', () => {
    const plane = SAM2_MASK * SAM2_MASK;
    const masks = new Float32Array(3 * plane).fill(-1);
    // 2 つ目のマスクの左上 1/4 を内側に
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) masks[plane + y * SAM2_MASK + x] = 1;
    const poly = sam2Outline(masks, [0.1, 0.9, 0.5], { x0: 100, y0: 200, x1: 300, y1: 400 })!;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100.5);
    expect(Math.max(...xs)).toBeCloseTo(199.5);
    expect(Math.min(...ys)).toBeCloseTo(200.5);
    expect(Math.max(...ys)).toBeCloseTo(299.5);
  });
});

describe('輪郭のある領域の注釈', () => {
  const out: InferenceOutput = {
    kind: 'regions',
    items: [
      { x: 10, y: 10, w: 20, h: 20, score: 0.9, label: 'face', polygon: [[10, 10], [30, 10], [20, 30]] },
      { x: 50, y: 50, w: 10, h: 10, score: 0.8, label: 'face' },
    ],
    imageWidth: 100,
    imageHeight: 100,
  };
  const canvasId = 'https://example.org/canvas/1';
  let n = 0;
  const page = toAnnotationPage(out, {
    canvasId,
    map: imageToCanvasOf({ rotation: 0, mirror: false }, { width: 1000, height: 1000 }, 100, 100)!,
    newId: () => `urn:test:${n++}`,
    generator: { id: 'https://huggingface.co/x', name: 'Model' },
  });

  it('輪郭があれば SvgSelector、無ければ xywh の FragmentSelector。どちらも区分名の styleClass と色を持つ', () => {
    const items = page.items as Record<string, unknown>[];
    expect(items[0].target).toEqual({
      type: 'SpecificResource',
      source: { id: canvasId, type: 'Canvas' },
      selector: { type: 'SvgSelector', value: "<svg xmlns='http://www.w3.org/2000/svg'><polygon points='100,100 300,100 200,300'/></svg>" },
      styleClass: 'face',
    });
    expect(items[1].target).toMatchObject({
      selector: { type: 'FragmentSelector', value: 'xywh=500,500,100,100' },
      styleClass: 'face',
    });
    expect(items[0].stylesheet).toEqual({ type: 'CssStylesheet', value: '.face { border-color: #2563eb; background-color: transparent; }' });
  });

  it('ビューアの注釈の読み取りで、多角形として読める', () => {
    const annos = readCanvasAnnotations(canvasId, [page]);
    expect(annos[0].region).toMatchObject({ type: 'polygon', rings: [[[100, 100], [300, 100], [200, 300]]] });
    expect(annos[1].region).toEqual({ type: 'rect', x: 500, y: 500, w: 100, h: 100 });
  });
});
