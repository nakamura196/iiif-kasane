import {
  NDL_DET_SIZE,
  NDL_REC,
  NDL_REC_H,
  NDL_REC_RETRY,
  NDL_REC_SPLIT,
  decodeParseq,
  ndlDetTensor,
  ndlFirstRecognizer,
  NDL_CLASSES,
  ndlOcrLines,
  ndlOcrRegions,
  ndlParseqTensor,
} from '../../../core';
import type { ModelRunner } from './types';
// 字の一覧（ndlocr-lite の src/config/NDLmoji.yaml。CC BY 4.0、国立国会図書館）。NDL古典籍OCR-Lite の一覧とは別物
import chars from './ndlOcrLite.chars.json';

const rgbaOf = (bitmap: ImageBitmap, w: number, h: number, fill?: string): Uint8ClampedArray => {
  const cv = new OffscreenCanvas(w, h);
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  if (fill) {
    c.fillStyle = fill;
    c.fillRect(0, 0, w, h);
  }
  c.drawImage(bitmap, 0, 0);
  return c.getImageData(0, 0, w, h).data;
};

const crop = (px: Uint8ClampedArray, W: number, x: number, y: number, w: number, h: number): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(px.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
};

const REC_FILES = ['rec30', 'rec50', 'rec100'] as const;

export const run: ModelRunner = async ({ ort, bitmap, session, progress }) => {
  const W = bitmap.width;
  const H = bitmap.height;

  // 1. レイアウトの検出: 紙面を正方形の左上に置き（右か下は黒）、800 角にする
  progress('detect', 0, 1);
  const side = Math.max(W, H);
  const S = NDL_DET_SIZE;
  const input = ndlDetTensor(rgbaOf(bitmap, side, side, '#000'), side);
  const det = await session('detector', 'webgpu');
  const r = await det.session.run({
    images: new ort.Tensor('float32', input, [1, 3, S, S]),
    orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(S), BigInt(S)]), [1, 2]),
  });
  const num = (t: { data: unknown }) => Array.from(t.data as ArrayLike<number | bigint>, Number);
  const lines = ndlOcrLines(num(r.labels), r.boxes.data as Float32Array, r.scores.data as Float32Array, num(r.char_count), W, H);
  // 行以外の区分（本文の塊・図版・表・柱・ノンブルなど）も、検出したまま結果に入れる
  const regions = ndlOcrRegions(num(r.labels), r.boxes.data as Float32Array, r.scores.data as Float32Array, num(r.char_count), W, H);
  progress('detect', 1, 1);

  // 2. 文字の読み取り（process_cascade）: 文字数の見込みで 30 字用・50 字用・100 字用を選び、あふれたら次の大きさで読み直す。
  //    100 字用でもあふれた横書きの行は、左右の半分に分けて読む。どれも wasm（WebGPU のほうが遅かった）
  const page = rgbaOf(bitmap, W, H);
  const read = async (k: 0 | 1 | 2, px: Uint8ClampedArray, w: number, h: number): Promise<string> => {
    if (w <= 0 || h <= 0) return '';
    const { width, chars: n } = NDL_REC[k];
    const rec = await session(REC_FILES[k], 'wasm');
    const t = ndlParseqTensor(px, w, h, width);
    const out = await rec.session.run({ [rec.session.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, NDL_REC_H, width]) });
    return decodeParseq(out[rec.session.outputNames[0]].data as Float32Array, n + 1, chars as string[]);
  };
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    progress('read', i, lines.length);
    const l = lines[i];
    // 原本は numpy の切り出しなので、画像の外にはみ出した分は切り詰められる
    const w = Math.min(l.x + l.w, W) - l.x;
    const h = Math.min(l.y + l.h, H) - l.y;
    const px = w > 0 && h > 0 ? crop(page, W, l.x, l.y, w, h) : new Uint8ClampedArray(0);
    let k = ndlFirstRecognizer(l.charCount);
    let text = await read(k, px, w, h);
    if (k === 0 && text.length >= NDL_REC_RETRY[0]) text = await read((k = 1), px, w, h);
    if (k === 1 && text.length >= NDL_REC_RETRY[1]) text = await read((k = 2), px, w, h);
    if (k === 2 && text.length >= NDL_REC_SPLIT && h < w) {
      const half = w >> 1;
      text = (await read(2, crop(px, w, 0, 0, half, h), half, h)) + (await read(2, crop(px, w, half, 0, w - half, h), w - half, h));
    }
    items.push({ x: l.x, y: l.y, w: l.w, h: l.h, score: l.score, label: l.type, text });
  }
  progress('read', lines.length, lines.length);
  return { kind: 'lines', items: [...items, ...regions], imageWidth: W, imageHeight: H, language: 'ja', classes: NDL_CLASSES };
};
