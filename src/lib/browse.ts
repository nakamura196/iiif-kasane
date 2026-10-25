// 3D で一覧する（/browse/）の、React にも three.js にも依存しない部分。
// IIIF の Collection / Manifest / Curation を、ページが並べる「カード」の配列にする。
// 元は nakamura196/iiif-3d-gallery の src/lib/data.ts（Presentation 2 の変換は Kasane のものを使う）。

import { upgradeToV3, labelIn, contentParam } from '@nakamura196/iiif-viewer/core';

type Json = Record<string, unknown>;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 並べ方。flat は 2D（回転なしの平面） */
export type BrowseLayout = 'table' | 'sphere' | 'helix' | 'grid' | 'flat';
export const BROWSE_LAYOUTS: BrowseLayout[] = ['table', 'sphere', 'helix', 'grid', 'flat'];

export interface BrowseItem {
  /** Manifest または Canvas の id（一覧の中で一意） */
  id: string;
  label: string;
  /** 詳細・比較に渡す Manifest の URL */
  manifestUrl: string;
  /** Canvas のカードのとき、その Canvas の番号（0 から）。Manifest のカードは null */
  canvasIndex: number | null;
  /** 一覧に出すときの小さな画像。Collection が持っていなければ空（あとで Manifest から補う） */
  thumbnail: string;
  /** グリッドの並べ方で束ねる名前（入れ子の Collection の名前など）。無ければ空 */
  group: string;
  /** 「書名」のように、元の資料が持つ見出し（あれば）。サイドバーの説明に出す */
  summary: string;
}

export interface BrowseSource {
  kind: 'collection' | 'manifest';
  title: string;
  items: BrowseItem[];
}

/** サムネイルの大きさ（px） */
export const THUMB_SIZE = 240;

/** IIIF Image API の URL（service の id）から、幅を決めた JPEG の URL を作る。 */
export function imageUrlFromService(serviceId: string, width = THUMB_SIZE): string {
  return `${serviceId.replace(/\/$/, '')}/full/${width},/0/default.jpg`;
}

function serviceIdOf(body: unknown): string {
  for (const s of asList(isObj(body) ? body.service : null)) {
    if (isObj(s)) {
      const id = str(s.id) || str(s['@id']);
      if (id) return id;
    }
  }
  return '';
}

/** thumbnail 欄（v3: 配列、v2 を直したあと: 配列）から URL を取る。service だけあるときは size を付けて作る。 */
function thumbnailField(node: unknown): string {
  for (const t of asList(isObj(node) ? node.thumbnail : null)) {
    if (typeof t === 'string' && t) return t;
    if (!isObj(t)) continue;
    const id = str(t.id) || str(t['@id']);
    if (id) return id;
    const svc = serviceIdOf(t);
    if (svc) return imageUrlFromService(svc);
  }
  return '';
}

function firstPaintingBody(canvas: unknown, depth = 0): unknown {
  if (depth > 6 || !isObj(canvas)) return null;
  for (const page of asList(canvas.items)) {
    for (const anno of asList(isObj(page) ? page.items : null)) {
      if (!isObj(anno)) continue;
      const body = asList(anno.body)[0];
      if (isObj(body)) {
        // Choice は最初の候補
        const first = body.type === 'Choice' ? asList(body.items)[0] : body;
        if (isObj(first)) return first;
      }
    }
  }
  return null;
}

/** Canvas の小さな画像: Canvas の thumbnail、無ければ画像の service か本体。 */
export function thumbnailOfCanvas(canvas: unknown): string {
  const t = thumbnailField(canvas);
  if (t) return t;
  const body = firstPaintingBody(canvas);
  if (!body) return '';
  const svc = serviceIdOf(body);
  if (svc) return imageUrlFromService(svc);
  return isObj(body) && (body.type === 'Image' || !body.type) ? str(body.id) : '';
}

/** Manifest の小さな画像: Manifest の thumbnail、無ければ最初の Canvas のもの。 */
export function thumbnailOfManifest(manifest: unknown): string {
  const t = thumbnailField(manifest);
  if (t) return t;
  const first = asList(isObj(manifest) ? manifest.items : null)[0];
  return first ? thumbnailOfCanvas(first) : '';
}

function resolveUrl(u: string, base: string): string {
  if (!u || /^(https?:|data:)/i.test(u)) return u;
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
}

/** 資料が持つ見出し（「書名」「Title」など）を 1 つ。グリッドの束ねと説明に使う。 */
function summaryOf(node: unknown, locale: string): string {
  if (!isObj(node)) return '';
  for (const m of asList(node.metadata)) {
    if (!isObj(m)) continue;
    const key = labelIn(m.label, locale);
    if (key === '書名' || key.toLowerCase() === 'title') return labelIn(m.value, locale);
  }
  return '';
}

const typeOf = (n: unknown): string => (isObj(n) ? str(n.type) : '');

/** Collection の中の Manifest（入れ子の Collection が中身を持っていれば、その中も）を順に集める。 */
function collectManifests(
  coll: Json,
  locale: string,
  base: string,
  group: string,
  out: BrowseItem[]
): void {
  for (const item of asList(coll.items)) {
    if (!isObj(item)) continue;
    const type = typeOf(item);
    if (type === 'Collection') {
      collectManifests(item, locale, base, labelIn(item.label, locale) || group, out);
    } else if (type === 'Manifest') {
      const id = str(item.id);
      if (!id) continue;
      const summary = summaryOf(item, locale);
      out.push({
        id,
        label: labelIn(item.label, locale) || `Item ${out.length + 1}`,
        manifestUrl: id,
        canvasIndex: null,
        thumbnail: resolveUrl(thumbnailField(item), base),
        group: group || summary,
        summary,
      });
    }
  }
}

/**
 * Presentation 3 の Collection か Manifest を、カードの配列にする。
 * Collection は Manifest 1 つが 1 枚、Manifest は Canvas 1 つが 1 枚。
 * 3 でないもの（Presentation 2）は、先に Kasane の変換を通す。
 * Collection・Manifest 以外（読めない形）は null。
 */
export function sourceFromResource(raw: unknown, url: string, locale: string): BrowseSource | null {
  const v3 = upgradeToV3(raw);
  if (!isObj(v3)) return null;
  const type = typeOf(v3);
  const title = labelIn(v3.label, locale);
  if (type === 'Collection') {
    const items: BrowseItem[] = [];
    collectManifests(v3, locale, url, '', items);
    return { kind: 'collection', title, items };
  }
  if (type === 'Manifest') {
    const items: BrowseItem[] = [];
    asList(v3.items).forEach((canvas, i) => {
      if (!isObj(canvas)) return;
      const id = str(canvas.id) || `${url}#canvas-${i + 1}`;
      items.push({
        id,
        label: labelIn(canvas.label, locale) || `${title || 'Canvas'} ${i + 1}`,
        manifestUrl: str(v3.id) || url,
        canvasIndex: i,
        thumbnail: resolveUrl(thumbnailOfCanvas(canvas), url),
        group: '',
        summary: '',
      });
    });
    return { kind: 'manifest', title, items };
  }
  return null;
}

/** 資料が Collection か、Canvas が 2 つ以上ある Manifest か。「ほかの表示」に出すかの判定。 */
export function canOpenInBrowse(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  const type = str(raw.type) || str(raw['@type']);
  if (type === 'Collection' || type === 'sc:Collection') return true;
  if (type === 'Manifest') return asList(raw.items).length > 1;
  if (type === 'sc:Manifest') {
    return asList(raw.sequences).some((s) => isObj(s) && asList(s.canvases).length > 1);
  }
  return false;
}

/** グリッドで束ねる名前の一覧（初めて出た順）と、各カードがどの束か。 */
export function groupsOf(items: BrowseItem[]): { names: string[]; of: number[] } {
  const names: string[] = [];
  const of = items.map((it) => {
    let i = names.indexOf(it.group);
    if (i < 0) i = names.push(it.group) - 1;
    return i;
  });
  return { names, of };
}

// ---- URL ----

export interface BrowseParams {
  url: string | null;
  layout: BrowseLayout | null;
  limit: number | null;
}

/**
 * ページの URL の引数。資料の URL は Kasane の `iiif-content`・`curation`、元の iiif-3d-gallery の
 * `manifest`、美術館と同じ `u` のどれでも受ける（旧サイトからの転送は `manifest` のまま渡る）。
 */
export function readBrowseParams(
  params: URLSearchParams,
  fromContent: (p: URLSearchParams) => string | null
): BrowseParams {
  const layout = params.get('layout') as BrowseLayout | null;
  const limit = Number(params.get('limit'));
  return {
    url: fromContent(params) ?? params.get('u'),
    layout: layout && BROWSE_LAYOUTS.includes(layout) ? layout : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
  };
}

/** /browse/ へのリンクの ? 以降。既定の並べ方（table）は書かない。 */
export function browseQuery(
  url: string,
  opts: { layout?: BrowseLayout; limit?: number } = {}
): string {
  const q = [contentParam(url)];
  if (opts.layout && opts.layout !== 'table') q.push(`layout=${opts.layout}`);
  if (opts.limit && opts.limit > 0) q.push(`limit=${Math.floor(opts.limit)}`);
  return q.join('&');
}

/** Kasane のビューアのリンク（/viewer?...）。Canvas のカードはその Canvas を開く。 */
export function viewerQuery(item: BrowseItem): string {
  const q = [contentParam(item.manifestUrl)];
  if (item.canvasIndex !== null && item.canvasIndex > 0) q.push(`canvas=${item.canvasIndex + 1}`);
  return q.join('&');
}

/** 比較のリンク（/compare?...）。Keep した 2 枚以上を並べる。渡せないとき（2 枚未満）は null。 */
export function compareQuery(items: BrowseItem[]): string | null {
  if (items.length < 2) return null;
  const canvases =
    items.every((it) => it.canvasIndex !== null) &&
    new Set(items.map((i) => i.manifestUrl)).size === 1;
  if (canvases) {
    // 同じ Manifest の Canvas 2 枚: 1 つの資料の a 番目と b 番目の画像を並べる
    return `${contentParam(items[0].manifestUrl)}&a=${items[0].canvasIndex}&b=${items[1].canvasIndex}`;
  }
  return items
    .slice(0, 4)
    .map((it) => `src=${encodeURIComponent(it.manifestUrl)}`)
    .join('&');
}

/** 拡大表示に使う、大きめの画像の URL。IIIF の画像 URL でなければサムネイルのまま。 */
export function largeImageUrl(thumbnail: string, width = 1200): string {
  return thumbnail.replace(/\/full\/[^/]+\/0\/default\.(jpg|png)$/, `/full/${width},/0/default.$1`);
}

/** 一度に並べる枚数の既定（3D で重くならない範囲）と、選べる上限 */
export const DEFAULT_BROWSE_LIMIT = 60;
export const BROWSE_LIMITS = [30, 60, 120, 240] as const;
