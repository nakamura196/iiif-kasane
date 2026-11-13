// contentSearch: search the text inside a resource with the IIIF Content Search API (1.0 and 2.0; 0.9 is treated as 1.0).
// Find the search service in the manifest's service, query it, and normalize version differences into a list of hits.
// Hits carry a position on the Canvas, so they can also be turned into markers on the image (a local AnnotationPage).
// No React dependency. The fetching function is supplied by the caller (replaced in tests).
//
// Spec: https://iiif.io/api/search/2.0/ and https://iiif.io/api/search/1.0/
// Units (line, word, etc.) use the Text Granularity extension: https://iiif.io/api/extension/text-granularity/

import { labelIn } from '../../services/paintedModels';
import { bboxOf } from '../annotations';

export type ContentSearchVersion = 1 | 2;

export interface ContentSearchService {
  id: string;
  version: ContentSearchVersion;
  label?: string;
  autocomplete?: { id: string; version: ContentSearchVersion };
}

/** One location on a Canvas that a hit points to (two locations if a word spans two lines). */
export interface ContentSearchRegion {
  /** id of the result Annotation */
  annotationId: string;
  canvasId: string;
  /** Rectangle in Canvas coordinates. The whole Canvas if absent */
  xywh?: [number, number, number, number];
  /** Point on a 3D Scene (PointSelector). canvasId becomes the Scene's id */
  point?: [number, number, number];
  /** label of the result Annotation (per-language map). Used as the heading of 3D hits */
  label?: unknown;
  text?: string;
  /** Text Granularity unit (page / block / paragraph / line / word / glyph) */
  granularity?: string;
}

/** One hit. Becomes one row in the list. */
export interface ContentSearchMatch {
  id: string;
  canvasId: string;
  regions: ContentSearchRegion[];
  /** The matched text */
  match: string;
  before?: string;
  after?: string;
  granularity?: string;
  /** Caption hit: time of the line in seconds (start and end) */
  time?: [number, number];
  /** Hit inside a caption or transcript file */
  transcript?: boolean;
}

export interface ContentSearchPage {
  matches: ContentSearchMatch[];
  /** Total count (when the service reports it) */
  total?: number;
  /** URL of the next page */
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

// ---- Find the service ---------------------------------------------------------------

const searchVersionOf = (s: Json): ContentSearchVersion | undefined => {
  const type = typeOf(s);
  const profile = textOf(s.profile);
  const context = textOf(s['@context']);
  if (type === 'SearchService2') return 2;
  if (type === 'SearchService1' || type === 'SearchService0') return 1;
  if (/autocomplete/i.test(profile)) return undefined;
  // 2.0 services have no profile (identify them by type). 1.0 and 0.9 are identified by profile or @context
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
 * Find the search service from the service of a manifest (or Canvas or Range). Prefer 2.0 if available.
 * Manifests converted from Presentation 2 keep `@id` and `@type`, so both spellings are checked.
 */
export function findContentSearchService(resource: unknown, locale = 'en'): ContentSearchService | undefined {
  if (!isObj(resource)) return undefined;
  const found: ContentSearchService[] = [];
  for (const s of [...asList(resource.service), ...asList(resource.services)]) {
    if (!isObj(s)) continue;
    const id = idOf(s);
    const version = searchVersionOf(s);
    if (!id || !version) continue;
    const label = labelIn(s.label, locale) || undefined;
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

/** Search URL. Sends only `q` (filters such as motivation are not used because services support them inconsistently). */
export const contentSearchUrl = (service: { id: string }, q: string): string => withQuery(service.id, { q: q.trim() });

// ---- Hit position ---------------------------------------------------------------

const XYWH = /(?:^|[#&])xywh=(?:pixel:)?(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)/;

const parseXywh = (s: string | undefined): ContentSearchRegion['xywh'] => {
  const m = s ? XYWH.exec(s) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : undefined;
};

/** Extract the Canvas (or Scene for 3D) id and the rectangle or point from an Annotation's target (`on` in 1.0). */
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
    // A bare Canvas with no position ({ id, type: 'Canvas' })
    const canvasId = idOf(t);
    return canvasId ? contentSearchTargetOf(canvasId) : undefined;
  }
  // 3D annotations may write source as an array ([{ id, type: 'Scene' }])
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
  // A Scene id may include a fragment such as `…#scene`, so do not strip it
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
  // 2.0: body (value of TextualBody). 1.0: resource (chars of cnt:ContentAsText)
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

// ---- Normalize the response -----------------------------------------------------------------

interface Context {
  ids: string[];
  match?: string;
  before?: string;
  after?: string;
}

// 1.0: hits (search:Hit). annotations lists the ids of the hit Annotations.
const hitsV1 = (json: Json): Context[] =>
  asList(json.hits)
    .filter(isObj)
    .map((h) => ({
      ids: asList(h.annotations).map(idOf).filter((x): x is string => !!x),
      match: str(h.match),
      before: str(h.before),
      after: str(h.after),
    }));

// 2.0: contextualizing Annotations inside annotations. The target points to the hit Annotation, and
// the TextQuoteSelector holds the surrounding text.
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
 * Turn a search response (1.0 AnnotationList, 2.0 AnnotationPage) into a list of hits.
 * If surrounding text (hits / contextualizing) exists, group hits by it (a term spanning two places becomes one hit).
 * Otherwise, each result Annotation becomes one hit.
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

/** Turn a suggestion response (1.0 TermList, 2.0 TermPage) into a list of terms. */
export function parseAutocompleteResponse(response: unknown, locale = 'en'): ContentSearchTerm[] {
  if (!isObj(response)) return [];
  const out: ContentSearchTerm[] = [];
  for (const t of [...asList(response.items), ...asList(response.terms)]) {
    if (!isObj(t)) continue;
    const value = str(t.value) ?? str(t.match);
    if (!value) continue;
    const count = num(t.total ?? t.count);
    const label = labelIn(t.label, locale) || undefined;
    out.push({ value, ...(count !== undefined ? { count } : {}), ...(label ? { label } : {}) });
  }
  return out;
}

export interface RunContentSearchOptions {
  /** Maximum number of pages to follow (MDZ in 1.0 returns 50 per page) */
  maxPages?: number;
  /** Maximum number of hits to collect */
  maxMatches?: number;
  signal?: AbortSignal;
  onPage?: (soFar: ContentSearchPage) => void;
}

export interface ContentSearchResult {
  matches: ContentSearchMatch[];
  total?: number;
  /** Stopped at the limit (more remain) */
  truncated: boolean;
}

/** Search and follow the next pages up to the limit. */
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

/** Fetch suggested terms. */
export async function fetchContentSearchTerms(
  autocomplete: { id: string },
  q: string,
  fetchJson: ContentSearchFetch,
  locale = 'en',
): Promise<ContentSearchTerm[]> {
  if (!q.trim()) return [];
  return parseAutocompleteResponse(await fetchJson(withQuery(autocomplete.id, { q: q.trim() })), locale);
}

/** Group hits by Canvas (used for list headings and markers on the image). */
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
 * Turn the hits of one Canvas into an AnnotationPage of markers on the image (motivation is highlighting).
 * Marker ids match hit ids, so selecting in the list selects the same marker on the image.
 * For a hit spanning two or more places, the second and later ids get a `#<number>` suffix.
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
          // the marks of one hit are selected together (see selectionKeyOf)
          hitId: m.id,
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

/**
 * The smallest box that contains every region of the hit on the given Canvas (with the number of regions), or undefined when none has a box.
 * A hit that spans several words has one region per word; the view must fit all of them.
 */
export function hitUnionXywh(
  regions: ContentSearchRegion[],
  canvasId: string,
): { box: [number, number, number, number]; count: number } | undefined {
  const rings = regions.flatMap((r): [number, number][][] =>
    r.canvasId === canvasId && r.xywh
      ? [[[r.xywh[0], r.xywh[1]], [r.xywh[0] + r.xywh[2], r.xywh[1] + r.xywh[3]]]]
      : [],
  );
  if (rings.length === 0) return undefined;
  const { x, y, w, h } = bboxOf(rings);
  return { box: [x, y, w, h], count: rings.length };
}

/** The fixed Text Granularity units, largest first. */
export const TEXT_GRANULARITIES = ['page', 'block', 'paragraph', 'line', 'word', 'glyph'] as const;

export * from './local';
export * from './scene';
export * from './transcripts';
