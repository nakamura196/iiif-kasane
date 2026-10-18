// contentSearch: IIIF Content Search API（1.0 と 2.0。0.9 は 1.0 として扱う）で、資料の中の文字を探す。
// マニフェストの service から窓口を見つけ → 問い合わせ → 版の違いをならして「当たり」の並びにする。
// 当たりは Canvas 上の位置を持つので、画像の上の印（手元の AnnotationPage）にも変えられる。
// React に依存しない。取りに行く処理は呼ぶ側が渡す（テストで差し替える）。
//
// 仕様: https://iiif.io/api/search/2.0/ ・ https://iiif.io/api/search/1.0/
// 単位（行・語など）は Text Granularity 拡張: https://iiif.io/api/extension/text-granularity/

export type ContentSearchVersion = 1 | 2;

export interface ContentSearchService {
  id: string;
  version: ContentSearchVersion;
  label?: string;
  autocomplete?: { id: string; version: ContentSearchVersion };
}

/** 当たり 1 つが指す、Canvas 上の 1 か所（語が 2 行にまたがれば 2 か所）。 */
export interface ContentSearchRegion {
  /** 結果の Annotation の id */
  annotationId: string;
  canvasId: string;
  /** Canvas 座標の矩形。無ければ Canvas 全体 */
  xywh?: [number, number, number, number];
  /** 3D の Scene 上の点（PointSelector）。canvasId は Scene の id になる */
  point?: [number, number, number];
  /** 結果の Annotation の label（言語ごとの辞書）。3D の当たりの見出しに使う */
  label?: unknown;
  text?: string;
  /** Text Granularity の単位（page / block / paragraph / line / word / glyph） */
  granularity?: string;
}

/** 当たり 1 つ。一覧の 1 行になる。 */
export interface ContentSearchMatch {
  id: string;
  canvasId: string;
  regions: ContentSearchRegion[];
  /** 当たった文字列 */
  match: string;
  before?: string;
  after?: string;
  granularity?: string;
  /** 字幕の当たり: 台詞の時刻（秒、始まりと終わり） */
  time?: [number, number];
  /** 字幕・文字起こしのファイルの中の当たり */
  transcript?: boolean;
}

export interface ContentSearchPage {
  matches: ContentSearchMatch[];
  /** 全体の件数（窓口が教えてくれたとき） */
  total?: number;
  /** 続きのページの URL */
  next?: string;
}

export interface ContentSearchTerm {
  value: string;
  count?: number;
  label?: string;
}

export type ContentSearchFetch = (url: string) => Promise<unknown>;

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const idOf = (v: unknown): string | undefined =>
  typeof v === 'string' ? str(v) : isObj(v) ? str(v.id ?? v['@id']) : undefined;
const typeOf = (v: unknown): string => (isObj(v) ? String(v.type ?? v['@type'] ?? '') : '');
const textOf = (v: unknown): string => asList(v).map((x) => String(x)).join(' ');

// ---- 窓口を見つける ---------------------------------------------------------------

const searchVersionOf = (s: Json): ContentSearchVersion | undefined => {
  const type = typeOf(s);
  const profile = textOf(s.profile);
  const context = textOf(s['@context']);
  if (type === 'SearchService2') return 2;
  if (type === 'SearchService1' || type === 'SearchService0') return 1;
  if (/autocomplete/i.test(profile)) return undefined;
  // 2.0 の窓口には profile が無い（type で見分ける）。1.0・0.9 は profile か @context で見分ける
  if (/\/search\/[01]\/search$/.test(profile)) return 1;
  if (!profile && /\/search\/[01]\/context\.json$/.test(context)) return 1;
  return undefined;
};

const autocompleteOf = (s: Json): ContentSearchService['autocomplete'] => {
  for (const sub of asList(s.service)) {
    if (!isObj(sub)) continue;
    const id = idOf(sub);
    const type = typeOf(sub);
    if (!id) continue;
    if (type === 'AutoCompleteService2') return { id, version: 2 };
    if (type === 'AutoCompleteService1' || type === 'AutoCompleteService0' || /autocomplete/i.test(textOf(sub.profile))) {
      return { id, version: 1 };
    }
  }
  return undefined;
};

/**
 * マニフェスト（または Canvas・Range）の service から検索の窓口を探す。2.0 があれば 2.0 を選ぶ。
 * Presentation 2 から直したマニフェストでは `@id` `@type` のまま残るので、両方の書き方を見る。
 */
export function findContentSearchService(resource: unknown): ContentSearchService | undefined {
  if (!isObj(resource)) return undefined;
  const found: ContentSearchService[] = [];
  for (const s of [...asList(resource.service), ...asList(resource.services)]) {
    if (!isObj(s)) continue;
    const id = idOf(s);
    const version = searchVersionOf(s);
    if (!id || !version) continue;
    const label = str(s.label) ?? (isObj(s.label) ? textOf(Object.values(s.label)[0]) : undefined);
    found.push({ id, version, ...(label ? { label } : {}), ...(autocompleteOf(s) ? { autocomplete: autocompleteOf(s) } : {}) });
  }
  return found.find((s) => s.version === 2) ?? found[0];
}

const withQuery = (base: string, params: Record<string, string>): string => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
};

/** 検索の URL。`q` だけを送る（motivation などの絞り込みは窓口ごとの対応がまちまちなので使わない）。 */
export const contentSearchUrl = (service: { id: string }, q: string): string => withQuery(service.id, { q: q.trim() });

// ---- 当たりの位置 ---------------------------------------------------------------

const XYWH = /(?:^|[#&])xywh=(?:pixel:)?(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)/;

const parseXywh = (s: string | undefined): ContentSearchRegion['xywh'] => {
  const m = s ? XYWH.exec(s) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : undefined;
};

/** Annotation の target（1.0 は on）から Canvas（3D なら Scene）の id と矩形・点を取り出す。 */
export function contentSearchTargetOf(
  target: unknown,
): { canvasId: string; xywh?: ContentSearchRegion['xywh']; point?: ContentSearchRegion['point'] } | undefined {
  const t = asList(target)[0];
  if (typeof t === 'string') {
    const [canvasId, fragment] = t.split('#');
    return canvasId ? { canvasId, xywh: parseXywh(fragment ? `#${fragment}` : undefined) } : undefined;
  }
  if (!isObj(t)) return undefined;
  const rawSource = t.source ?? t.full;
  if (rawSource === undefined) {
    // 位置の無い Canvas そのもの（{ id, type: 'Canvas' }）
    const canvasId = idOf(t);
    return canvasId ? contentSearchTargetOf(canvasId) : undefined;
  }
  // 3D の注釈は source を配列で書くことがある（[{ id, type: 'Scene' }]）
  const source = asList(rawSource)[0];
  const sources = asList(t.selector).filter(isObj);
  let point: ContentSearchRegion['point'];
  for (const sel of sources) {
    const [x, y, z] = [num(sel.x), num(sel.y), num(sel.z)];
    if (typeOf(sel) === 'PointSelector' && x !== undefined && y !== undefined && z !== undefined) {
      point = [x, y, z];
      break;
    }
  }
  const sourceId = idOf(source);
  // Scene の id は `…#scene` のように断片を含むことがあるので、切らない
  const canvasId = typeOf(source) === 'Scene' || point ? sourceId : sourceId?.split('#')[0];
  if (!canvasId) return undefined;
  if (point) return { canvasId, point };
  for (const sel of sources) {
    const xywh = parseXywh(str(sel.value));
    if (xywh) return { canvasId, xywh };
  }
  return { canvasId, xywh: parseXywh(sourceId) };
}

const granularityOf = (anno: Json): string | undefined => str(anno.textGranularity);

const bodyText = (anno: Json): string | undefined => {
  // 2.0: body（TextualBody の value）。1.0: resource（cnt:ContentAsText の chars）
  for (const b of [...asList(anno.body), ...asList(anno.resource)]) {
    if (typeof b === 'string') return b;
    if (isObj(b)) {
      const v = str(b.value) ?? str(b.chars);
      if (v) return v;
    }
  }
  return undefined;
};

const regionOf = (anno: unknown): ContentSearchRegion | undefined => {
  if (!isObj(anno)) return undefined;
  const annotationId = idOf(anno);
  const where = contentSearchTargetOf(anno.target ?? anno.on);
  if (!annotationId || !where) return undefined;
  const text = bodyText(anno);
  const granularity = granularityOf(anno);
  return {
    annotationId,
    canvasId: where.canvasId,
    ...(where.xywh ? { xywh: where.xywh } : {}),
    ...(where.point ? { point: where.point } : {}),
    ...(where.point && anno.label ? { label: anno.label } : {}),
    ...(text ? { text } : {}),
    ...(granularity ? { granularity } : {}),
  };
};

// ---- 応答をならす -----------------------------------------------------------------

interface Context {
  ids: string[];
  match?: string;
  before?: string;
  after?: string;
}

// 1.0: hits（search:Hit）。annotations に当たりの Annotation の id が並ぶ。
const hitsV1 = (json: Json): Context[] =>
  asList(json.hits)
    .filter(isObj)
    .map((h) => ({
      ids: asList(h.annotations).map(idOf).filter((x): x is string => !!x),
      match: str(h.match),
      before: str(h.before),
      after: str(h.after),
    }));

// 2.0: annotations の中の contextualizing の Annotation。target が当たりの Annotation を指し、
// TextQuoteSelector に前後の文がある。
const hitsV2 = (json: Json): Context[] => {
  const out: Context[] = [];
  for (const page of asList(json.annotations)) {
    for (const a of asList(isObj(page) ? page.items : undefined)) {
      if (!isObj(a)) continue;
      const ids: string[] = [];
      let quote: Json | undefined;
      for (const t of asList(a.target)) {
        const id = isObj(t) ? idOf(t.source) : idOf(t);
        if (id) ids.push(id);
        for (const sel of asList(isObj(t) ? t.selector : undefined)) {
          if (isObj(sel) && typeOf(sel) === 'TextQuoteSelector') quote = sel;
        }
      }
      if (ids.length === 0) continue;
      out.push({ ids, match: str(quote?.exact), before: str(quote?.prefix), after: str(quote?.suffix) });
    }
  }
  return out;
};

const nextOf = (json: Json): string | undefined => idOf(json.next);

const totalOf = (json: Json): number | undefined => {
  const within = isObj(json.within) ? json.within : isObj(json.partOf) ? json.partOf : undefined;
  return num(within?.total);
};

/**
 * 検索の応答（1.0 の AnnotationList、2.0 の AnnotationPage）を、当たりの並びにする。
 * 前後の文（hits / contextualizing）があれば、それで当たりをまとめる（語が 2 か所にまたがるとき 1 件になる）。
 * 無ければ、結果の Annotation 1 つを 1 件にする。
 */
export function parseContentSearchResponse(response: unknown): ContentSearchPage {
  if (!isObj(response)) return { matches: [] };
  const regions = new Map<string, ContentSearchRegion>();
  for (const a of [...asList(response.items), ...asList(response.resources)]) {
    const r = regionOf(a);
    if (r && !regions.has(r.annotationId)) regions.set(r.annotationId, r);
  }
  const contexts = [...hitsV2(response), ...hitsV1(response)];
  const used = new Set<string>();
  const matches: ContentSearchMatch[] = [];
  const add = (id: string, rs: ContentSearchRegion[], c?: Context) => {
    const first = rs[0];
    const match = c?.match ?? rs.map((r) => r.text ?? '').join(' ').trim();
    const granularity = rs.find((r) => r.granularity)?.granularity;
    matches.push({
      id,
      canvasId: first.canvasId,
      regions: rs,
      match,
      ...(c?.before ? { before: c.before } : {}),
      ...(c?.after ? { after: c.after } : {}),
      ...(granularity ? { granularity } : {}),
    });
  };
  for (const c of contexts) {
    const rs = c.ids.map((id) => regions.get(id)).filter((r): r is ContentSearchRegion => !!r);
    if (rs.length === 0) continue;
    rs.forEach((r) => used.add(r.annotationId));
    add(rs[0].annotationId, rs, c);
  }
  for (const r of regions.values()) {
    if (!used.has(r.annotationId)) add(r.annotationId, [r]);
  }
  const total = totalOf(response);
  const next = nextOf(response);
  return { matches, ...(total !== undefined ? { total } : {}), ...(next ? { next } : {}) };
}

/** 候補語の応答（1.0 の TermList、2.0 の TermPage）を、語の並びにする。 */
export function parseAutocompleteResponse(response: unknown): ContentSearchTerm[] {
  if (!isObj(response)) return [];
  const out: ContentSearchTerm[] = [];
  for (const t of [...asList(response.items), ...asList(response.terms)]) {
    if (!isObj(t)) continue;
    const value = str(t.value) ?? str(t.match);
    if (!value) continue;
    const count = num(t.total ?? t.count);
    const label = str(t.label) ?? (isObj(t.label) ? textOf(Object.values(t.label)[0]) : undefined);
    out.push({ value, ...(count !== undefined ? { count } : {}), ...(label ? { label } : {}) });
  }
  return out;
}

export interface RunContentSearchOptions {
  /** たどるページの上限（1.0 の MDZ は 1 ページ 50 件） */
  maxPages?: number;
  /** 集める当たりの上限 */
  maxMatches?: number;
  signal?: AbortSignal;
  onPage?: (soFar: ContentSearchPage) => void;
}

export interface ContentSearchResult {
  matches: ContentSearchMatch[];
  total?: number;
  /** 上限で打ち切った（続きがまだある） */
  truncated: boolean;
}

/** 検索して、続きのページを上限までたどる。 */
export async function runContentSearch(
  service: { id: string },
  q: string,
  fetchJson: ContentSearchFetch,
  { maxPages = 10, maxMatches = 1000, signal, onPage }: RunContentSearchOptions = {},
): Promise<ContentSearchResult> {
  const matches: ContentSearchMatch[] = [];
  const seenPages = new Set<string>();
  let url: string | undefined = contentSearchUrl(service, q);
  let total: number | undefined;
  let pages = 0;
  while (url && pages < maxPages && matches.length < maxMatches && !seenPages.has(url)) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    seenPages.add(url);
    const page = parseContentSearchResponse(await fetchJson(url));
    pages += 1;
    total ??= page.total;
    matches.push(...page.matches);
    url = page.next;
    onPage?.({ matches: [...matches], ...(total !== undefined ? { total } : {}) });
  }
  const truncated = !!url && !seenPages.has(url);
  return { matches: matches.slice(0, maxMatches), ...(total !== undefined ? { total } : {}), truncated: truncated || matches.length > maxMatches };
}

/** 候補語を取りに行く。 */
export async function fetchContentSearchTerms(
  autocomplete: { id: string },
  q: string,
  fetchJson: ContentSearchFetch,
): Promise<ContentSearchTerm[]> {
  if (!q.trim()) return [];
  return parseAutocompleteResponse(await fetchJson(withQuery(autocomplete.id, { q: q.trim() })));
}

/** 当たりを Canvas ごとに分ける（一覧の見出しと、画像の上の印に使う）。 */
export function groupMatchesByCanvas(matches: ContentSearchMatch[]): Map<string, ContentSearchMatch[]> {
  const out = new Map<string, ContentSearchMatch[]>();
  for (const m of matches) {
    const list = out.get(m.canvasId) ?? [];
    list.push(m);
    out.set(m.canvasId, list);
  }
  return out;
}

/**
 * 1 つの Canvas の当たりを、画像の上の印にする AnnotationPage にする（motivation は highlighting）。
 * 印の id は当たりの id にそろえるので、一覧で選ぶと画像の上の同じ印が選ばれる。
 * 2 か所にまたがる当たりは、2 つ目以降の id に `#<番号>` を付ける。
 */
export function contentSearchAnnotationPage(canvasId: string, matches: ContentSearchMatch[]): Record<string, unknown> {
  const items: Json[] = [];
  for (const m of matches) {
    m.regions
      .filter((r) => r.canvasId === canvasId)
      .forEach((r, i) => {
        const target = r.xywh ? `${canvasId}#xywh=${r.xywh.join(',')}` : canvasId;
        items.push({
          id: i === 0 ? m.id : `${m.id}#${i}`,
          type: 'Annotation',
          motivation: 'highlighting',
          ...(r.granularity ? { textGranularity: r.granularity } : {}),
          body: { type: 'TextualBody', value: r.text ?? m.match, format: 'text/plain' },
          target,
        });
      });
  }
  return {
    '@context': ['http://iiif.io/api/extension/text-granularity/context.json', 'http://iiif.io/api/presentation/3/context.json'],
    id: `${canvasId}#content-search`,
    type: 'AnnotationPage',
    items,
  };
}

/** Text Granularity の決まった単位。大きい順。 */
export const TEXT_GRANULARITIES = ['page', 'block', 'paragraph', 'line', 'word', 'glyph'] as const;

export * from './local';
export * from './scene';
export * from './transcripts';
