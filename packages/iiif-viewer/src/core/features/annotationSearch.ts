// Canvas 上の注釈の、手元での絞り込み（右パネルの検索欄）と、選んだ注釈へ画像を寄せるときの範囲。
// 検索は注釈の見出し・本文（HTML は文字だけ）・タグ（キー: 値）・リンクのラベルと URL を対象にする。全角・半角と大文字・小文字は区別しない。
// 文字のそろえ方と語の照合、タグの名前と数え方は 3D の一覧の絞り込み（core/annotationFilter.ts）も使う。
import type { AnnotationTag } from '../types/main';
import { isTagBody, pickBodies, tagOfBody, type AnnotationBodyItem } from './annotationBody';
import type { AnnotationRegion, CanvasAnnotation } from './annotations';

/** Normalize for a loose match: NFKC (全角・半角) and lower case. */
export const normalizeSearchText = (s: string): string => s.normalize('NFKC').toLowerCase();

/** HTML as the words a reader sees, for a search: tags become spaces, so words on either side stay apart. */
export const htmlSearchText = (html: string): string => html.replace(/<[^>]*>/g, ' ');

/**
 * The text a search looks at, made once per annotation (the same object) and kept:
 * a list and the marks over the image ask for it again and again.
 */
const cache = new WeakMap<object, string>();
export const cachedSearchText = (key: object, build: () => string[]): string => {
  let text = cache.get(key);
  if (text === undefined) {
    text = normalizeSearchText(build().join('\n'));
    cache.set(key, text);
  }
  return text;
};

/** All the text of an annotation that a search looks at, normalized. */
export const annotationSearchText = (a: Pick<CanvasAnnotation, 'bodies' | 'title'>): string =>
  cachedSearchText(a, () => [...labelStrings(a.title), ...a.bodies.flatMap((b) => bodySearchParts(b))]);

/**
 * The text of one body that a search looks at. A tag reads as "key: value", as the 3D list shows and filters it.
 * `assumeHtml`: read a text without a format as HTML (as the 3D list shows it).
 */
export const bodySearchParts = (b: AnnotationBodyItem, assumeHtml = false): string[] => {
  if (b.kind === 'text') {
    const html = b.format ? /html/i.test(b.format) : assumeHtml;
    const value = html ? htmlSearchText(b.value ?? '') : (b.value ?? '');
    const labels = labelStrings(b.label);
    if (b.tagging) return labels.length > 0 ? labels.map((key) => `${key}: ${value}`) : [value];
    return [value, ...labels];
  }
  return [...(b.url ? [b.url] : []), ...labelStrings(b.label)];
};

/** The strings of a label: a plain string, or every value of a IIIF language map. */
export const labelStrings = (label: unknown): string[] => {
  if (typeof label === 'string') return [label];
  if (Array.isArray(label)) return label.filter((x): x is string => typeof x === 'string');
  if (label && typeof label === 'object') {
    return Object.values(label as Record<string, unknown>).flatMap((v) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [],
    );
  }
  return [];
};

/** The words of a query (split on spaces); all must be found. Empty when there is nothing to look for. */
export const searchTerms = (query: string): string[] =>
  normalizeSearchText(query)
    .split(/\s+/)
    .filter((w) => w.length > 0);

/** Does the (normalized) text contain all the terms? No terms: everything matches. */
export const matchesSearchTerms = (text: string, terms: string[]): boolean => terms.every((w) => text.includes(w));

/** A tag as one string, "key: value" (or the value alone): what the lists show and filter by. */
export const tagKey = (tag: AnnotationTag): string => (tag.key ? `${tag.key}: ${tag.value}` : tag.value);

/** A value to filter by, and how many items have it. */
export interface Facet {
  value: string;
  count: number;
}

/** How often each value occurs, in the order the values first occur. */
export const countBy = (values: string[]): Facet[] => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
};

/** The tags of a Canvas annotation as "key: value", in the reader's language. */
export const canvasAnnotationTags = (a: Pick<CanvasAnnotation, 'bodies'>, locale: string): string[] =>
  pickBodies(a.bodies, locale)
    .filter(isTagBody)
    .map((b) => tagKey(tagOfBody(b, locale)));

/**
 * The tags to filter the Canvas annotations by, counted by region (annotations on the same region are one row
 * of the list): the most used first.
 */
export const canvasTagFacets = (
  groups: { annotations: Pick<CanvasAnnotation, 'bodies'>[] }[],
  locale: string,
): Facet[] =>
  countBy(groups.flatMap((g) => [...new Set(g.annotations.flatMap((a) => canvasAnnotationTags(a, locale)))])).sort(
    (a, b) => b.count - a.count,
  );

/** The chosen tags that some of the annotations have: a tag of another Canvas (or language) is not looked at. */
export const presentCanvasTags = (
  annotations: Pick<CanvasAnnotation, 'bodies'>[],
  chosen: string[],
  locale: string,
): string[] => {
  if (chosen.length === 0) return chosen;
  const present = new Set(annotations.flatMap((a) => canvasAnnotationTags(a, locale)));
  return chosen.filter((t) => present.has(t));
};

/**
 * Is a Canvas annotation kept by the search and the chosen tags? It must have all the words,
 * and one of the tags (when tags are chosen). The list and the marks over the image ask the same.
 */
export const matchesCanvasAnnotation = (
  a: Pick<CanvasAnnotation, 'bodies' | 'title'>,
  terms: string[],
  tags: string[],
  locale: string,
): boolean =>
  (tags.length === 0 || canvasAnnotationTags(a, locale).some((t) => tags.includes(t))) &&
  matchesSearchTerms(annotationSearchText(a), terms);

/**
 * The part of the Canvas to show when the viewer moves to an annotation (x, y, w, h in Canvas pixels).
 * Small regions get room around them, so that the place can be read from what is near.
 * The whole Canvas (or an unknown size) gives undefined: there is nothing to move to.
 */
export const focusBoxOf = (
  region: AnnotationRegion,
  canvas: { width: number; height: number },
): [number, number, number, number] | undefined => {
  const { width: cw, height: ch } = canvas;
  if (!(cw > 0) || !(ch > 0)) return undefined;
  let box: { x: number; y: number; w: number; h: number };
  if (region.type === 'rect') box = region;
  else if (region.type === 'polygon') box = region.bbox;
  else if (region.type === 'point') box = { x: region.x, y: region.y, w: 0, h: 0 };
  else return undefined;
  // at least 1/20 of the Canvas's shorter side, and three times the region itself
  const min = Math.min(cw, ch) / 20;
  const w = Math.min(cw, Math.max(box.w * 3, min));
  const h = Math.min(ch, Math.max(box.h * 3, min));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return [cx - w / 2, cy - h / 2, w, h];
};
