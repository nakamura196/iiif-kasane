// Canvas 上の注釈の、手元での絞り込み（右パネルの検索欄）と、選んだ注釈へ画像を寄せるときの範囲。
// 検索は注釈の見出し・本文（HTML は文字だけ）・タグのキー・リンクのラベルと URL を対象にする。全角・半角と大文字・小文字は区別しない。
import type { AnnotationRegion, CanvasAnnotation } from './annotations';

/** Normalize for a loose match: NFKC (全角・半角) and lower case. */
export const normalizeSearchText = (s: string): string => s.normalize('NFKC').toLowerCase();

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ');

// 同じ注釈（同じ物）は 1 回だけ作る。一覧と画像の上の印の両方が使う
const cache = new WeakMap<object, string>();

/** All the text of an annotation that a search looks at, normalized. */
export const annotationSearchText = (a: Pick<CanvasAnnotation, 'bodies' | 'title'>): string => {
  let text = cache.get(a);
  if (text === undefined) {
    text = searchTextOf(a);
    cache.set(a, text);
  }
  return text;
};

const searchTextOf = (a: Pick<CanvasAnnotation, 'bodies' | 'title'>): string => {
  const parts: string[] = labelStrings(a.title);
  for (const b of a.bodies) {
    if (b.kind === 'text') {
      parts.push(/html/i.test(b.format ?? '') ? plain(b.value ?? '') : (b.value ?? ''));
      parts.push(...labelStrings(b.label));
    } else {
      if (b.url) parts.push(b.url);
      parts.push(...labelStrings(b.label));
    }
  }
  return normalizeSearchText(parts.join('\n'));
};

const labelStrings = (label: unknown): string[] => {
  if (typeof label === 'string') return [label];
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
