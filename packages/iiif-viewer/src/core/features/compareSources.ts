// compareSources: 見比べる画像を、Choice の候補ではなく別々の資料（Manifest・Collection・info.json）から集める。
// React に依存しない。

import { labelIn } from '../services/paintedModels';
import { manifestItemsOf } from './annotations';
import { curationSelectionsOf, languageMapOf } from './curation';
import {
  canvasImagesOf,
  chosenLayersOf,
  detailWidthOf,
  parseImageInfo,
  paintsImage,
  type CanvasImages,
  type CanvasPainting,
  resolveRegion,
  type ImageLayer,
  type ImageRegion,
} from './image';
import { collectionEntriesOf, splitId } from './structure';
import { physdimOf, unitFactor, type Physdim } from './physdim';

/** One side of a comparison: the images drawn on a frame of this size. */
export interface CompareSide {
  layers: ImageLayer[];
  width: number;
  height: number;
  /** Physical dimensions of the Canvas, when advertised via IIIF physdim. */
  physdim?: Physdim;
}

/** An image that can be put on either side, with the name shown in the A / B menus. */
export interface CompareCandidate {
  label: string;
  side: CompareSide;
  /** Where the image is, to open it in the viewer: the Manifest URL and the Canvas index (0-based). Not set for a bare info.json. */
  manifest?: string;
  canvas?: number;
  /** The Canvas id as the source writes it (with `#xywh=` for a member of a Curation): the key of an alignment. */
  id?: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const text = (v: unknown): string => asList(v).filter((x): x is string => typeof x === 'string').join(' ');

/** An Image API info.json (not a Manifest). */
export const isImageInfoJson = (json: unknown): boolean => {
  if (!isObj(json) || json.type === 'Manifest' || json.type === 'Collection') return false;
  if (/sc:(Manifest|Collection)/.test(String(json['@type'] ?? ''))) return false;
  return /iiif\.io\/api\/image/.test(`${text(json['@context'])} ${text(json.protocol)} ${text(json.profile)}`);
};

/** The two sides of a Choice of one Canvas (undefined while the Canvas size is not known). */
export const choiceSidesOf = (
  images: CanvasImages,
  choice: CanvasPainting,
  pick: [number, number],
): [CompareSide, CompareSide] | undefined => {
  const { width, height } = images;
  if (!width || !height) return undefined;
  const paintings = images.paintings.filter(paintsImage);
  const side = (i: 0 | 1): CompareSide => ({
    layers: chosenLayersOf(paintings, (p) => (p.id === choice.id ? pick[i] : 0)),
    width,
    height,
  });
  return [side(0), side(1)];
};

/** The candidate of an info.json: one layer that is the whole image. `url` is where it was read. */
export const infoCandidateOf = (json: unknown, url: string): CompareCandidate | null => {
  const info = parseImageInfo(json);
  if (!info) return null;
  const j = (isObj(json) ? json : {}) as Json;
  const id = String(j.id ?? j['@id'] ?? url.replace(/\/info\.json(\?.*)?$/, '')).replace(/\/+$/, '');
  const parts = id.split('/').filter(Boolean);
  const label = decodeURIComponent(parts[parts.length - 1] ?? id);
  const layer: ImageLayer = {
    url: `${id}/full/max/0/default.jpg`,
    service: { id, version: info.version },
    width: info.width,
    height: info.height,
    rotation: 0,
    mirror: false,
    annotations: [],
  };
  return { label, side: { layers: [layer], width: info.width, height: info.height } };
};

/**
 * The candidates of a Manifest (as Presentation 3): every Canvas that paints an image, with the
 * first candidate of each painting. With more than one Canvas the name is "<Manifest> — <Canvas>".
 */
export const candidatesOfManifest = (raw: unknown, locale: string, fallbackLabel = ''): CompareCandidate[] => {
  const canvases = manifestItemsOf(raw);
  const manifestLabel = (isObj(raw) ? labelIn(raw.label, locale) : '') || fallbackLabel;
  const out: CompareCandidate[] = [];
  canvases.forEach((canvas, i) => {
    const images = canvasImagesOf(canvas);
    const layers = chosenLayersOf(images.paintings.filter(paintsImage), () => 0);
    if (layers.length === 0 || !images.width || !images.height) return;
    const own = labelIn(canvas.label, locale) || String(i + 1);
    const physdim = physdimOf(canvas);
    out.push({
      label: canvases.length > 1 ? `${manifestLabel} — ${own}` : manifestLabel || own,
      side: { layers, width: images.width, height: images.height, ...(physdim ? { physdim } : {}) },
      canvas: i,
    });
  });
  return out;
};

/** Is this (Presentation 3) JSON a Collection? */
export const isCollectionJson = (raw: unknown): boolean => isObj(raw) && raw.type === 'Collection';

/** The URLs of the Manifests listed in a Collection (nested Collections are left out). */
export const memberManifestUrlsOf = (raw: unknown): string[] =>
  collectionEntriesOf(raw)
    .filter((e) => e.type === 'Manifest')
    .map((e) => e.id);

/**
 * B put into the frame of A, keeping its aspect ratio, fitted and centred (the layers' target
 * rectangles are scaled from B's Canvas into A's units). The same size: B as it is.
 */
export const fitSide = (side: CompareSide, frame: { width: number; height: number }): CompareSide => {
  if (side.width === frame.width && side.height === frame.height) return side;
  const k = Math.min(frame.width / side.width, frame.height / side.height);
  const ox = (frame.width - side.width * k) / 2;
  const oy = (frame.height - side.height * k) / 2;
  const layers = side.layers.map((l) => {
    const t = l.target ?? { x: 0, y: 0, w: side.width, h: side.height };
    return { ...l, target: { x: ox + t.x * k, y: oy + t.y * k, w: t.w * k, h: t.h * k } };
  });
  return { layers, width: frame.width, height: frame.height };
};

const placeSideInFrame = (
  side: CompareSide,
  scale: number,
  frameW: number,
  frameH: number,
): CompareSide => {
  const w = side.width * scale;
  const h = side.height * scale;
  const ox = (frameW - w) / 2;
  const oy = (frameH - h) / 2;
  const layers = side.layers.map((l) => {
    const t = l.target ?? { x: 0, y: 0, w: side.width, h: side.height };
    return { ...l, target: { x: ox + t.x * scale, y: oy + t.y * scale, w: t.w * scale, h: t.h * scale } };
  });
  return { layers, width: frameW, height: frameH, physdim: { scale: 1, units: 'mm' } };
};

/**
 * Place both sides into a shared frame in millimetres so their real-world sizes match.
 * Returns null if either side has no physdim service.
 */
export const fitSidesPhysically = (
  a: CompareSide,
  b: CompareSide,
): [CompareSide, CompareSide] | null => {
  if (!a.physdim || !b.physdim) return null;
  const aMm = a.physdim.scale * unitFactor(a.physdim.units, 'mm');
  const bMm = b.physdim.scale * unitFactor(b.physdim.units, 'mm');
  if (!(aMm > 0) || !(bMm > 0)) return null;
  const frameW = Math.max(a.width * aMm, b.width * bMm);
  const frameH = Math.max(a.height * aMm, b.height * bMm);
  if (!(frameW > 0) || !(frameH > 0)) return null;
  return [placeSideInFrame(a, aMm, frameW, frameH), placeSideInFrame(b, bMm, frameW, frameH)];
};

/** Width of the sharper of the two sides, in the frame's units (it decides how far one can zoom in). */
export const compareDetailWidthOf = (a: CompareSide, b: CompareSide): number | undefined => {
  const inFrame = (l: ImageLayer) => ((l.width ?? 0) * a.width) / (l.target?.w ?? a.width);
  return Math.max(0, detailWidthOf(a.layers) ?? 0, ...b.layers.map(inFrame)) || undefined;
};

const intersect = (a: ImageRegion, b: ImageRegion): ImageRegion | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

/**
 * A part of a side (a region of its Canvas, in Canvas units) as a side of its own: the frame is the region.
 * Each layer asks the server only for its part (Image API region). A turned or mirrored layer, or one
 * whose source size is not known, is moved as it is (what lies outside the frame is not cut).
 */
export const cropSide = (side: CompareSide, region: ImageRegion): CompareSide => {
  const layers: ImageLayer[] = [];
  for (const l of side.layers) {
    const t = l.target ?? { x: 0, y: 0, w: side.width, h: side.height };
    const part = intersect(t, region);
    if (!part) continue;
    if (l.rotation || l.mirror || !l.width || !l.height) {
      layers.push({ ...l, target: { x: t.x - region.x, y: t.y - region.y, w: t.w, h: t.h } });
      continue;
    }
    const src = resolveRegion(l.regionSpec, l.width, l.height);
    const kx = src.w / t.w;
    const ky = src.h / t.h;
    const r = (v: number) => Math.round(v);
    const regionSpec = `${r(src.x + (part.x - t.x) * kx)},${r(src.y + (part.y - t.y) * ky)},${r(part.w * kx)},${r(part.h * ky)}`;
    layers.push({ ...l, regionSpec, target: { x: part.x - region.x, y: part.y - region.y, w: part.w, h: part.h } });
  }
  return { layers, width: region.w, height: region.h, ...(side.physdim ? { physdim: side.physdim } : {}) };
};

/**
 * The candidates of a CODH Curation: every member, in order, cut to its region (`#xywh=`).
 * `manifests`: the Manifests it draws from (as Presentation 3), by URL. Members whose Canvas is not
 * found are left out. The name is "<Curation> — <member>".
 */
export const curationCandidatesOf = (
  curation: unknown,
  manifests: Map<string, unknown>,
  locale: string,
): CompareCandidate[] => {
  const own = isObj(curation) ? labelIn(languageMapOf(curation.label), locale) : '';
  const out: CompareCandidate[] = [];
  for (const sel of curationSelectionsOf(curation)) {
    const manifest = manifests.get(sel.manifestUrl);
    if (!sel.readable || !manifest) continue;
    const canvases = manifestItemsOf(manifest);
    for (const [n, m] of sel.members.entries()) {
      const index = canvases.findIndex((c) => c.id === m.canvasId);
      if (index < 0) continue;
      const images = canvasImagesOf(canvases[index]);
      const layers = chosenLayersOf(images.paintings.filter(paintsImage), () => 0);
      if (layers.length === 0 || !images.width || !images.height) continue;
      const physdim = physdimOf(canvases[index]);
      const whole: CompareSide = { layers, width: images.width, height: images.height, ...(physdim ? { physdim } : {}) };
      const xywh = splitId(m.id).fragment.xywh;
      const side = xywh ? cropSide(whole, { x: xywh[0], y: xywh[1], w: xywh[2], h: xywh[3] }) : whole;
      const name = labelIn(m.label, locale) || String(n + 1);
      out.push({ label: own ? `${own} — ${name}` : name, side, manifest: sel.manifestUrl, canvas: index, id: m.id });
    }
  }
  return out;
};

/** A 2D affine transform in CSS `matrix()` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AlignMatrix = [number, number, number, number, number, number];

const invertAlignMatrix = ([a, b, c, d, e, f]: AlignMatrix): AlignMatrix | null => {
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

/**
 * What is left after the matrix: a slowly varying shift (the paper or the block bent a little), on a grid
 * over A's frame. `x`, `y`: the columns and rows (A's frame units, increasing); `d`: dx, dy of each node,
 * row by row. At a point p of A goes the B point that the matrix sends to p + d(p) (d read bilinearly).
 */
export interface AlignWarp {
  x: number[];
  y: number[];
  d: number[];
}

/** How B is laid on A: the matrix (from B's frame units into A's), and the grid that bends it further. */
export interface AlignTransform {
  matrix: AlignMatrix;
  warp?: AlignWarp;
}

/**
 * An alignment file: for pairs of images (by `id`), how B is laid on A.
 * `{ pairs: [{ a, b, matrix, warp? }] }`; a pair whose matrix is null could not be aligned.
 */
export type Alignment = Map<string, AlignTransform | null>;

const pairKey = (a: string, b: string) => `${a}\n${b}`;

const isNums = (v: unknown, n?: number): v is number[] =>
  Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

const warpOf = (w: unknown): AlignWarp | undefined => {
  if (!isObj(w) || !isNums(w.x) || !isNums(w.y) || !isNums(w.d)) return undefined;
  if (w.x.length < 2 || w.y.length < 2 || w.d.length !== w.x.length * w.y.length * 2) return undefined;
  return { x: w.x, y: w.y, d: w.d };
};

export const parseAlignment = (json: unknown): Alignment => {
  const out: Alignment = new Map();
  if (!isObj(json)) return out;
  for (const p of asList(json.pairs)) {
    if (!isObj(p) || typeof p.a !== 'string' || typeof p.b !== 'string') continue;
    if (!isNums(p.matrix, 6)) {
      out.set(pairKey(p.a, p.b), null);
      continue;
    }
    const warp = warpOf(p.warp);
    out.set(pairKey(p.a, p.b), { matrix: p.matrix as AlignMatrix, ...(warp ? { warp } : {}) });
  }
  return out;
};

/** The shift of the grid at a point of A (bilinear; held at the edges). */
export const warpAt = (w: AlignWarp, x: number, y: number): [number, number] => {
  const cell = (xs: number[], v: number): [number, number] => {
    let i = 0;
    while (i < xs.length - 2 && v > xs[i + 1]) i++;
    const t = (v - xs[i]) / (xs[i + 1] - xs[i] || 1);
    return [i, Math.min(1, Math.max(0, t))];
  };
  const [i, tx] = cell(w.x, x);
  const [j, ty] = cell(w.y, y);
  const n = w.x.length;
  const at = (c: number, r: number, k: number) => w.d[(r * n + c) * 2 + k];
  const lerp = (k: number) =>
    (1 - ty) * ((1 - tx) * at(i, j, k) + tx * at(i + 1, j, k)) + ty * ((1 - tx) * at(i, j + 1, k) + tx * at(i + 1, j + 1, k));
  return [lerp(0), lerp(1)];
};

/**
 * How B is laid on A, also when the pair is listed the other way round (then by the inverse matrix only,
 * without the grid). Undefined: not listed.
 */
export const alignmentOf = (alignment: Alignment, a: string | undefined, b: string | undefined): AlignTransform | null | undefined => {
  if (!a || !b) return undefined;
  const k = pairKey(a, b);
  if (alignment.has(k)) return alignment.get(k);
  const r = pairKey(b, a);
  if (alignment.has(r)) {
    const m = alignment.get(r)?.matrix;
    const inv = m ? invertAlignMatrix(m) : null;
    return inv ? { matrix: inv } : null;
  }
  return undefined;
};
