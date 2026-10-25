// 3D で一覧する（/browse/）の、React にも three.js にも依存しない部分。
// IIIF の Collection / Manifest / Curation を、ページが並べる「カード」の配列にする。
// 元は nakamura196/iiif-3d-gallery の src/lib/data.ts（Presentation 2 の変換は Kasane のものを使う）。

import { upgradeToV3, labelIn, contentParam, metadataRecordOf } from '@nakamura196/iiif-viewer/core';

type Json = Record<string, unknown>;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * 並べ方。元にあった flat（2D）は table と同じ並びで回転を止めるだけだったので、
 * 並べ方からは外し、「回さない」（lockRotation）に分けた。古いリンクの `?layout=flat` は table + 回さない で開く
 */
export type BrowseLayout = 'table' | 'sphere' | 'helix' | 'grid';
export const BROWSE_LAYOUTS: BrowseLayout[] = ['table', 'sphere', 'helix', 'grid'];

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
  /** Curation の member のカードのとき、その番号（1 から）。manifestUrl は Curation の URL で、ビューアは pos で開く */
  pos?: number;
  /** 元の資料の metadata（項目名 → 値。ページの言語で）。グループ・キューブの分け方に使う */
  metadata?: Record<string, string[]>;
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
        metadata: metadataRecordOf(item.metadata, locale),
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
        metadata: metadataRecordOf(canvas.metadata, locale),
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


// ---- グループ・キューブの分け方 ----

/** 「資料ごと」に分けるときの名前（URL の `group=manifest`）。Curation の範囲・Collection の Manifest の元の資料 */
export const BY_SOURCE = 'manifest';
/** 値の無いカードの束（画面では「（なし）」）。いちばん後ろに置く */
export const NONE_KEY = '';
/** 数が多すぎてまとめた値（画面では「その他」） */
export const OTHER_KEY = '\u0000other';

export interface FieldInfo {
  /** 項目名（BY_SOURCE は資料ごと） */
  name: string;
  /** 値の種類の数（値の無いものは数えない） */
  distinct: number;
}

/** カードの、ある分け方での値。値が複数あるときは最初の 1 つ */
export function valueOf(item: BrowseItem, by: string): string {
  if (by === BY_SOURCE) return item.group;
  return item.metadata?.[by]?.[0] ?? NONE_KEY;
}

/** 先頭が数（年など）なら、その数。「1858年」→ 1858。数でなければ null */
export function numericOf(v: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
}

/**
 * 分け方に使える項目。カードの 3 割以上が値を持ち、値の種類が 2 から maxDistinct まで のもの。
 * ほとんど 1 件ずつ違う項目（ID・URL・信頼度のような数）や、長い文の項目は外す。
 * 「資料ごと」（BY_SOURCE）は、元の資料が 2 つ以上あるときに先頭に入れる。
 */
export function groupableFields(items: BrowseItem[], maxDistinct = 40): FieldInfo[] {
  const out: FieldInfo[] = [];
  const n = items.length;
  if (n === 0) return out;
  const sources = new Set(items.map((it) => it.group).filter(Boolean));
  if (sources.size >= 2 && sources.size <= Math.max(maxDistinct, n)) {
    out.push({ name: BY_SOURCE, distinct: sources.size });
  }
  const names: string[] = [];
  for (const it of items) for (const k of Object.keys(it.metadata ?? {})) if (!names.includes(k)) names.push(k);
  for (const name of names) {
    const values = items.map((it) => valueOf(it, name)).filter((v) => v !== NONE_KEY);
    const distinct = new Set(values).size;
    if (values.length < n * 0.3 || distinct < 2 || distinct > maxDistinct) continue;
    // ほとんどが 1 件ずつ違う（10 件以上で、種類が件数の半分を超える）
    if (values.length >= 10 && distinct > values.length / 2) continue;
    const avg = values.reduce((a, v) => a + v.length, 0) / values.length;
    if (avg > 40 || values.some((v) => /^https?:\/\//i.test(v))) continue;
    out.push({ name, distinct });
  }
  return out;
}

/** 値の並べ順: 数（年など）は小さい順で先に、ほかは数の多い順（同じなら名前順）。「なし」「その他」は後ろ */
function sortValues(values: string[], counts: Map<string, number>): string[] {
  const rank = (v: string) => (v === NONE_KEY ? 2 : v === OTHER_KEY ? 1 : 0);
  return [...values].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const na = numericOf(a);
    const nb = numericOf(b);
    if (na !== null && nb !== null) return na - nb || a.localeCompare(b);
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
  });
}

export interface BrowseGroup {
  /** 値（NONE_KEY は値なし） */
  key: string;
  /** その束のカードの番号（元の順） */
  indexes: number[];
}

/**
 * カードを束に分ける。資料ごと（BY_SOURCE）は元の順のまま、項目ごとは数の値なら小さい順、
 * ほかは大きい束から。値の無いカードは最後の「なし」の束。
 */
export function groupItems(items: BrowseItem[], by: string): BrowseGroup[] {
  const map = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = valueOf(it, by);
    const list = map.get(k);
    if (list) list.push(i);
    else map.set(k, [i]);
  });
  const keys = [...map.keys()];
  const counts = new Map(keys.map((k) => [k, map.get(k)!.length]));
  const order =
    by === BY_SOURCE
      ? [...keys.filter((k) => k !== NONE_KEY), ...keys.filter((k) => k === NONE_KEY)]
      : sortValues(keys, counts);
  return order.map((key) => ({ key, indexes: map.get(key)! }));
}

// ---- URL ----

export interface BrowseParams {
  url: string | null;
  layout: BrowseLayout | null;
  limit: number | null;
  /** 回さない（ずらす・拡大のみ）。`?lock=1`、または古いリンクの `?layout=flat` */
  lockRotation: boolean;
  /** グループの分け方（`?group=`）。無ければ null（資料ごと） */
  group: string | null;
}

/**
 * ページの URL の引数。資料の URL は Kasane の `iiif-content`・`curation`、元の iiif-3d-gallery の
 * `manifest`、美術館と同じ `u` のどれでも受ける（旧サイトからの転送は `manifest` のまま渡る）。
 */
export function readBrowseParams(
  params: URLSearchParams,
  fromContent: (p: URLSearchParams) => string | null
): BrowseParams {
  const rawLayout = params.get('layout');
  const flat = rawLayout === 'flat';
  const layout = (flat ? 'table' : rawLayout) as BrowseLayout | null;
  const limit = Number(params.get('limit'));
  const raw = fromContent(params) ?? params.get('u');
  return {
    url: raw ? unwrapIiifUrl(raw, fromContent) : null,
    layout: layout && BROWSE_LAYOUTS.includes(layout) ? layout : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
    lockRotation: flat || params.get('lock') === '1',
    group: params.get('group') || null,
  };
}

/**
 * 貼られた URL が Kasane などのページの URL（`?u=`・`?iiif-content=`・`?manifest=` に資料の URL を持つもの）なら、
 * その中の資料の URL を取り出す。例: `https://kasane.ldas.jp/ja/search/?u=<curation.json>` → `<curation.json>`。
 * 入れ子は 3 段まで。取り出せなければ、そのまま返す。
 */
export function unwrapIiifUrl(
  input: string,
  fromContent: (p: URLSearchParams) => string | null
): string {
  let url = input.trim();
  for (let i = 0; i < 3; i++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const inner = fromContent(parsed.searchParams) ?? parsed.searchParams.get('u');
    if (!inner || !/^https?:\/\//i.test(inner)) return url;
    url = inner.trim();
  }
  return url;
}

/** /browse/ へのリンクの ? 以降。既定の並べ方（table）は書かない。回さないときは `lock=1` */
export function browseQuery(
  url: string,
  opts: {
    layout?: BrowseLayout;
    limit?: number;
    lockRotation?: boolean;
    group?: string | null;
  } = {}
): string {
  const q = [contentParam(url)];
  if (opts.layout && opts.layout !== 'table') q.push(`layout=${opts.layout}`);
  if (opts.limit && opts.limit > 0) q.push(`limit=${Math.floor(opts.limit)}`);
  if (opts.lockRotation) q.push('lock=1');
  // 分け方は、その並べ方のときだけ書く（資料ごとは既定なので書かない）
  if (opts.layout === 'grid' && opts.group && opts.group !== BY_SOURCE) {
    q.push(`group=${encodeURIComponent(opts.group)}`);
  }
  return q.join('&');
}

/** Kasane のビューアのリンク（/viewer?...）。Canvas のカードはその Canvas を開く。 */
export function viewerQuery(item: BrowseItem): string {
  const q = [contentParam(item.manifestUrl)];
  if (item.pos) q.push(`pos=${item.pos}`);
  else if (item.canvasIndex !== null && item.canvasIndex > 0) q.push(`canvas=${item.canvasIndex + 1}`);
  return q.join('&');
}

/** 比較のリンク（/compare?...）。Keep した 2 枚以上を並べる。渡せないとき（2 枚未満）は null。 */
export function compareQuery(items: BrowseItem[]): string | null {
  // Curation の member（範囲）は比較のページに渡す形が無い
  if (items.length < 2 || items.some((it) => it.pos)) return null;
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
