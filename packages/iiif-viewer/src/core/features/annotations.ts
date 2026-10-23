// annotations: Canvas 上の注釈（コメント・タグ・領域・ホットスポット）の読み取り。React に依存しない。この機能の担当だけがこのファイルを書く。
//
// 読むもの: Canvas の `annotations`（AnnotationPage の並び）と、テキストを画像に描く
// painting の注釈。painting（画像など）と supplementing（字幕など）は別の場所で扱うので除く。
// ただし画像の一部を指す supplementing（OCR の行など）は、ほかの注釈と同じに出す。
// 領域は Canvas 座標の「矩形・点・多角形・Canvas 全体」にそろえる。

import type { ManifestV4 } from '../types/iiif';

import { annotationTitleOf, readAnnotationBodies, type AnnotationBodyItem } from './annotationBody';
import { parseStyleClasses, readStylesheetField, type AnnotationStyleSource } from './annotationStyle';
import { targetTimeOf } from './temporal';

export { sanitizeAnnotationHtml, safeAnnotationUrl } from './annotationHtml';
export { pickBodies, type AnnotationBodyItem } from './annotationBody';

type Json = Record<string, unknown>;
type Point = [number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnnotationRegion =
  | { type: 'canvas' }
  | ({ type: 'rect' } & Box)
  | { type: 'point'; x: number; y: number }
  | { type: 'polygon'; rings: Point[][]; bbox: Box };

export interface AnnotationCollectionRef {
  id: string;
  label?: unknown;
  total?: number;
}

export interface CanvasAnnotation extends AnnotationStyleSource {
  id: string;
  motivations: string[];
  /** The heading (IIIF language map or string): the annotation's label, else its main text body's label. */
  title?: unknown;
  region: AnnotationRegion;
  bodies: AnnotationBodyItem[];
  /** The AnnotationCollection the page belongs to (`partOf`), if any. */
  collection?: AnnotationCollectionRef;
  /** The motivation is painting: the text is drawn on the Canvas itself. */
  painted?: boolean;
  /**
   * The annotation belongs to one image layer of a Choice (recipe 0326), not to the Canvas as a whole.
   * The layer draws it itself, so the overlay on the Canvas skips it; the list shows it with the layer's name.
   */
  layer?: { id: string; label?: unknown };
  /**
   * The part of a video or audio the annotation is about, in seconds (`#t=10,12` in the target,
   * a FragmentSelector, or a PointSelector's `instant`). Without `end` it runs to the end of the media
   * (`#t=10`), except for an `instant`, which is a single moment.
   */
  time?: { start: number; end?: number; instant?: true };
  /** Text Granularity extension: the unit of text the annotation stands for (line, word …). */
  granularity?: string;
  /**
   * Shared Region extension: the id of the target Specific Resource. Annotations with the same regionId
   * annotate the same region and are drawn as one box.
   */
  regionId?: string;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
};

// ---- regions -----------------------------------------------------------------

export const bboxOf = (rings: Point[][]): Box => {
  const pts = rings.flat();
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

// "xywh=10,20,30,40" / "xywh=pixel:..." / "xywh=percent:..." (the rest of the fragment is ignored)
export const parseXywh = (fragment: string, canvasW?: number, canvasH?: number): Box | null => {
  const m = /(?:^|[#&])?xywh=(pixel:|percent:)?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(
    fragment,
  );
  if (!m) return null;
  let [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(parseFloat);
  if (m[1] === 'percent:') {
    if (!canvasW || !canvasH) return null;
    x = (x / 100) * canvasW;
    w = (w / 100) * canvasW;
    y = (y / 100) * canvasH;
    h = (h / 100) * canvasH;
  }
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
};

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, z: 0, c: 6, s: 4, q: 4, t: 2, a: 7 };

// The outline of an SVG path as a list of points. Curves are reduced to their end points.
export const pathPoints = (d: string): Point[][] => {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const rings: Point[][] = [];
  let ring: Point[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let i = 0;
  const push = (x: number, y: number) => {
    cx = x;
    cy = y;
    ring.push([x, y]);
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'z' || cmd === 'Z') {
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }
    const lower = cmd.toLowerCase();
    const n = ARGS[lower];
    if (n === undefined || n === 0) {
      i++;
      continue;
    }
    const a = tokens.slice(i, i + n).map(parseFloat);
    if (a.length < n || a.some((v) => !Number.isFinite(v))) break;
    i += n;
    const rel = cmd === lower;
    if (lower === 'm') {
      if (ring.length > 1) rings.push(ring);
      ring = [];
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      sx = x;
      sy = y;
      push(x, y);
      cmd = rel ? 'l' : 'L'; // further pairs are implicit line-tos
    } else if (lower === 'h') push(rel ? cx + a[0] : a[0], cy);
    else if (lower === 'v') push(cx, rel ? cy + a[0] : a[0]);
    else push(rel ? cx + a[n - 2] : a[n - 2], rel ? cy + a[n - 1] : a[n - 1]);
  }
  if (ring.length > 1) rings.push(ring);
  return rings;
};

const attrOf = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2]) : undefined;
};

const pairs = (s: string): Point[] => {
  const n = (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(parseFloat);
  const out: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};

const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 48 }, (_, k) => {
    const t = (k / 48) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Point;
  });

// Shapes of an SVG string (path, polygon, polyline, rect, circle, ellipse) as rings of points.
export const svgRings = (svg: string): Point[][] => {
  const rings: Point[][] = [];
  for (const m of svg.matchAll(/<(path|polygon|polyline|rect|circle|ellipse)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const n = (name: string) => num(attrOf(attrs, name)) ?? 0;
    if (tag === 'path') rings.push(...pathPoints(attrOf(attrs, 'd') ?? ''));
    else if (tag === 'polygon' || tag === 'polyline') {
      const p = pairs(attrOf(attrs, 'points') ?? '');
      if (p.length > 1) rings.push(p);
    } else if (tag === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      if (w > 0 && h > 0) rings.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    } else if (tag === 'circle') {
      if (n('r') > 0) rings.push(ellipse(n('cx'), n('cy'), n('r'), n('r')));
    } else if (n('rx') > 0 && n('ry') > 0) rings.push(ellipse(n('cx'), n('cy'), n('rx'), n('ry')));
  }
  return rings;
};

const idOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : str(isObj(v) ? v.id ?? v['@id'] : undefined));
const stripFragment = (url: string): string => url.split('#')[0];

interface ParsedTarget {
  canvasId?: string;
  region: AnnotationRegion;
}

const regionFromSelector = (sel: Json, w?: number, h?: number): AnnotationRegion | null => {
  switch (sel.type) {
    case 'PointSelector': {
      const x = num(sel.x);
      const y = num(sel.y);
      return x !== undefined && y !== undefined ? { type: 'point', x, y } : null;
    }
    case 'SvgSelector': {
      const rings = svgRings(str(sel.value) ?? '');
      return rings.length ? { type: 'polygon', rings, bbox: bboxOf(rings) } : null;
    }
    case 'ImageApiSelector': {
      // pixels of the image (at `size` when given); the caller scales them onto the Canvas
      const m = /^(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)$/.exec(str(sel.region) ?? '');
      if (!m) return null;
      const [x, y, w, h] = m.slice(1).map(parseFloat);
      return w > 0 && h > 0 ? { type: 'rect', x, y, w, h } : null;
    }
    case 'FragmentSelector': {
      const box = parseXywh(str(sel.value) ?? '', w, h);
      return box ? { type: 'rect', ...box } : null;
    }
    default:
      return null;
  }
};

// styleClass of the target (a SpecificResource) / of the body (Choice: its items too)
const bodyClassesOf = (body: unknown): string[] => {
  const out: string[] = [];
  for (const b of asList(body)) {
    if (!isObj(b)) continue;
    out.push(...parseStyleClasses(b.styleClass));
    if (b.type === 'Choice') out.push(...bodyClassesOf(b.items));
  }
  return [...new Set(out)];
};

const parseTarget = (target: unknown, w?: number, h?: number): ParsedTarget | null => {
  const t = asList(target)[0];
  if (typeof t === 'string') {
    const box = parseXywh(t.includes('#') ? t.slice(t.indexOf('#')) : '', w, h);
    return { canvasId: stripFragment(t), region: box ? { type: 'rect', ...box } : { type: 'canvas' } };
  }
  if (!isObj(t)) return null;
  // the Shared Region extension writes `source` as a list (as the 3D form does)
  const source = asList(t.source)[0] ?? t.id;
  const sourceId = idOf(source);
  if (!sourceId) return null;
  let region: AnnotationRegion | null = null;
  if (isObj(source) || typeof source === 'string') {
    const box = parseXywh(sourceId.includes('#') ? sourceId.slice(sourceId.indexOf('#')) : '', w, h);
    if (box) region = { type: 'rect', ...box };
  }
  for (const sel of [...asList(t.selector), ...asList(t.selectors)]) {
    if (region) break;
    if (isObj(sel)) region = regionFromSelector(sel, w, h);
  }
  return { canvasId: stripFragment(sourceId), region: region ?? { type: 'canvas' } };
};

// Shared Region extension: only a Specific Resource target carries a region id.
const regionIdOf = (target: unknown): string | undefined =>
  isObj(target) && target.type === 'SpecificResource' ? str(target.id) : undefined;

// ---- pages and annotations ---------------------------------------------------

const motivationsOf = (anno: Json): string[] =>
  asList(anno.motivation ?? anno.motivations).filter((m): m is string => typeof m === 'string');

const collectionOf = (page: Json): AnnotationCollectionRef | undefined => {
  for (const p of asList(page.partOf)) {
    if (!isObj(p)) {
      const id = str(p);
      if (id) return { id };
      continue;
    }
    const id = idOf(p);
    if (!id) continue;
    return { id, label: p.label, total: num(p.total) };
  }
  return undefined;
};

/** The Canvases (and other items) of a manifest: converted, or as served. */
export const manifestItemsOf = (manifest: unknown): Json[] => {
  const items = (manifest as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as Json[]) : [];
};

/** The Canvas as written in the manifest (the converter keeps flat-media Canvases as they are). */
export const rawCanvasOf = (manifest: unknown, canvasId: string): Json | undefined =>
  manifestItemsOf(manifest).find((c) => c?.id === canvasId);

export interface CanvasAnnotationSources {
  /** Pages written into the manifest (with their annotations). */
  pages: Json[];
  /** Pages the manifest only refers to; fetch them and give the result to `readCanvasAnnotations`. */
  references: string[];
}

// Annotations written inside an image of a Choice (recipe 0326: an X-ray layer with its own tags).
// They target the image (or its service), not the Canvas, so each page is marked with the layer it belongs to.
const layerPagesOf = (paintingPage: Json): Json[] => {
  const out: Json[] = [];
  const visit = (body: unknown, label: unknown) => {
    for (const b of asList(body)) {
      if (!isObj(b)) continue;
      if (b.type === 'Choice') {
        visit(b.items, undefined);
        continue;
      }
      const inner = b.type === 'SpecificResource' && isObj(b.source) ? b.source : b;
      const ids = [idOf(inner), ...asList(inner.service).map(idOf)].filter((x): x is string => !!x);
      const layerLabel = b.label ?? inner.label ?? label;
      for (const page of asList(inner.annotations)) {
        if (!isObj(page) || !Array.isArray(page.items)) continue;
        out.push({
          ...page,
          __layer: { ids, label: layerLabel, width: num(inner.width), height: num(inner.height) },
        });
      }
    }
  };
  for (const anno of asList(paintingPage.items)) if (isObj(anno)) visit(anno.body, undefined);
  return out;
};

export const annotationSourcesOf = (canvas: Json | undefined): CanvasAnnotationSources => {
  const pages: Json[] = [];
  const references: string[] = [];
  if (!canvas) return { pages, references };
  for (const raw of asList(canvas.annotations)) {
    if (typeof raw === 'string') {
      references.push(raw);
    } else if (isObj(raw)) {
      if (Array.isArray(raw.items)) pages.push(raw);
      else if (raw.type === 'Annotation') pages.push({ type: 'AnnotationPage', items: [raw] });
      else if (str(raw.id)) references.push(String(raw.id));
    }
  }
  // text painted onto the Canvas (recipe 0561) sits among the painting annotations
  for (const page of asList(canvas.items)) {
    if (isObj(page) && Array.isArray(page.items)) {
      pages.push({ ...page, __painting: true });
      pages.push(...layerPagesOf(page));
    }
  }
  return { pages, references };
};

/** The page that follows (`next`), as an address. */
export const nextPageOf = (page: unknown): string | undefined => (isObj(page) ? idOf(page.next) : undefined);

/**
 * Reads the annotations of the pages that target `canvasId`.
 * `canvasIds`: every Canvas of the manifest, given only when the pages are the Canvas's own
 * (`annotations`). An annotation there whose target names none of them is taken to be on this Canvas
 * (Cookbook 0464 reuses the Canvas of 0008 and its annotation targets a Canvas URI that does not exist).
 */
export const readCanvasAnnotations = (
  canvasId: string,
  pages: unknown[],
  canvasSize?: { width?: number; height?: number },
  canvasIds?: ReadonlySet<string>,
): CanvasAnnotation[] => {
  const out: CanvasAnnotation[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!isObj(page)) continue;
    const collection = collectionOf(page);
    for (const raw of asList(page.items)) {
      if (!isObj(raw)) continue;
      const motivations = motivationsOf(raw);
      const bodies = readAnnotationBodies(raw);
      const painting = motivations.includes('painting');
      if (painting && !bodies.some((b) => b.kind === 'text')) continue; // images etc. are painted elsewhere
      const layerInfo = isObj(page.__layer) ? (page.__layer as Json) : undefined;
      const layerIds = (layerInfo?.ids as string[] | undefined) ?? [];
      const target = parseTarget(raw.target, canvasSize?.width, canvasSize?.height);
      if (!target) continue;
      let layer: CanvasAnnotation['layer'];
      if (layerInfo && target.canvasId !== undefined && layerIds.includes(target.canvasId)) {
        // inside an image layer: the region is in pixels of that image; scale it onto the Canvas
        const t = asList(raw.target)[0];
        const sel = isObj(t) ? asList(t.selector).find(isObj) : undefined;
        const size = /^\^?(\d+),(\d+)$/.exec(str(sel?.size) ?? '');
        const iw = size ? Number(size[1]) : (layerInfo.width as number | undefined);
        const ih = size ? Number(size[2]) : (layerInfo.height as number | undefined);
        const cw = canvasSize?.width;
        const ch = canvasSize?.height;
        if (target.region.type === 'rect' && iw && ih && cw && ch) {
          const r = target.region;
          target.region = { type: 'rect', x: (r.x / iw) * cw, y: (r.y / ih) * ch, w: (r.w / iw) * cw, h: (r.h / ih) * ch };
        }
        layer = { id: layerIds[0], label: layerInfo.label };
        target.canvasId = canvasId;
      }
      if (canvasIds && target.canvasId !== undefined && !canvasIds.has(target.canvasId)) target.canvasId = canvasId;
      if (target.canvasId !== canvasId) continue;
      // supplementing on the whole Canvas (captions, transcripts) is shown elsewhere; on a region of the
      // image it is text read from that place (OCR), and is drawn like other annotations
      if (motivations.includes('supplementing') && target.region.type === 'canvas') continue;
      const id = str(raw.id) ?? `${canvasId}#annotation-${out.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const targetClasses = parseStyleClasses(isObj(asList(raw.target)[0]) ? (asList(raw.target)[0] as Json).styleClass : undefined);
      const bodyClasses = bodyClassesOf(raw.body);
      const sheet = readStylesheetField(raw.stylesheet);
      const rawTarget = asList(raw.target)[0];
      const time = targetTimeOf(rawTarget);
      const instant =
        !!time &&
        time.end === undefined &&
        asList(isObj(rawTarget) ? rawTarget.selector : undefined).some(
          (sel) => isObj(sel) && sel.type === 'PointSelector' && num(sel.instant) === time.start,
        );
      const title = annotationTitleOf(raw);
      out.push({
        id,
        motivations,
        ...(title !== undefined ? { title } : {}),
        ...sheet,
        ...(targetClasses.length ? { targetClasses } : {}),
        ...(bodyClasses.length ? { bodyClasses } : {}),
        region: target.region,
        bodies,
        ...(collection ? { collection } : {}),
        ...(painting ? { painted: true } : {}),
        ...(layer ? { layer } : {}),
        ...(time
          ? { time: { start: time.start, ...(time.end !== undefined ? { end: time.end } : {}), ...(instant ? { instant: true as const } : {}) } }
          : {}),
        ...(str(raw.textGranularity) ? { granularity: str(raw.textGranularity) } : {}),
        ...(regionIdOf(rawTarget) ? { regionId: regionIdOf(rawTarget) } : {}),
      });
    }
  }
  return out;
};

/** Everything that is written into the manifest for a Canvas (no fetching). */
export const embeddedCanvasAnnotations = (
  manifest: ManifestV4 | null | undefined,
  canvasId: string,
  size?: { width?: number; height?: number },
): CanvasAnnotation[] =>
  readCanvasAnnotations(canvasId, annotationSourcesOf(rawCanvasOf(manifest, canvasId)).pages, size, canvasIdsOf(manifest));

/** The ids of the Canvases of a manifest (for `readCanvasAnnotations`). */
export const canvasIdsOf = (manifest: unknown): Set<string> =>
  new Set(manifestItemsOf(manifest).map((c) => c?.id).filter((id): id is string => typeof id === 'string'));

/**
 * Whether an annotation is shown at `seconds` of the media. An annotation without a time is always shown;
 * one at a single instant is shown for `instantWindow` seconds from it.
 */
export const isAnnotationAt = (a: CanvasAnnotation, seconds: number, instantWindow = 1): boolean => {
  if (!a.time) return true;
  const end = a.time.end ?? (a.time.instant ? a.time.start + instantWindow : Infinity);
  return seconds >= a.time.start && seconds < end;
};

// ---- placing on the image ----------------------------------------------------

export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The bounding box of a region as percentages of the Canvas (null: no box, e.g. a point). */
export const regionBoxPercent = (region: AnnotationRegion, canvasW: number, canvasH: number): PercentBox | null => {
  if (!(canvasW > 0) || !(canvasH > 0)) return null;
  let b: Box | null = null;
  if (region.type === 'rect') b = region;
  else if (region.type === 'polygon') b = region.bbox;
  else if (region.type === 'canvas') b = { x: 0, y: 0, w: canvasW, h: canvasH };
  if (!b) return null;
  return {
    left: (b.x / canvasW) * 100,
    top: (b.y / canvasH) * 100,
    width: (b.w / canvasW) * 100,
    height: (b.h / canvasH) * 100,
  };
};

/** A point as percentages of the Canvas. */
export const pointPercent = (x: number, y: number, canvasW: number, canvasH: number): { left: number; top: number } => ({
  left: (x / canvasW) * 100,
  top: (y / canvasH) * 100,
});
