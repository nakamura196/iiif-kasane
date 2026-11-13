// 推論の結果の AnnotationPage（toAnnotationPage が作るもの）から、サムネイルに重ねる印を取り出す。
// 枠（#xywh か FragmentSelector）と多角形（SvgSelector）を Canvas 座標のまま返す。色は注釈の stylesheet から、
// タグ（区分名）は purpose が tagging の本文から読む。色の無い注釈は区分の無い色（CLASS_PALETTE[0]）にする。
// Marks to draw over a page thumbnail, read back from an inference AnnotationPage (Canvas coordinates).
import { CLASS_PALETTE } from './annotationPage';

export interface PageMark {
  /** Bounding box on the Canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Polygon points on the Canvas (SvgSelector), when the target is not a box. */
  points?: [number, number][];
  color: string;
  /** The class name of a tag (purpose tagging), for filtering by the chosen tags. */
  tag?: string;
  /** Whether the annotation has text (a read line): drawn with a light fill. */
  text: boolean;
}

const XYWH = /xywh=(?:pixel:)?(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)/;
const COLOR = /border-color:\s*(#[0-9a-fA-F]{3,8})/;
const POINTS = /points=['"]([^'"]+)['"]/;

const boxOf = (s: string): Omit<PageMark, 'color' | 'text'> | null => {
  const m = XYWH.exec(s);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
};

const polygonOf = (svg: string): Omit<PageMark, 'color' | 'text'> | null => {
  const m = POINTS.exec(svg);
  if (!m) return null;
  const points = m[1]
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number) as [number, number])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 3) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, points };
};

type Item = {
  motivation?: string;
  target?: unknown;
  body?: { value?: string; purpose?: string } | { value?: string; purpose?: string }[];
  stylesheet?: { value?: string };
};

const shapeOf = (target: unknown): Omit<PageMark, 'color' | 'text'> | null => {
  if (typeof target === 'string') return boxOf(target);
  const sel = (target as { selector?: { type?: string; value?: string } } | null)?.selector;
  if (!sel?.value) return null;
  return sel.type === 'SvgSelector' ? polygonOf(sel.value) : boxOf(sel.value);
};

/**
 * The marks of an AnnotationPage: one per annotation whose target is a box or a polygon on the Canvas. Descriptions
 * of the whole image are left out.
 */
export const pageMarksOf = (page: Record<string, unknown> | undefined): PageMark[] => {
  const items = (page?.items as Item[] | undefined) ?? [];
  const out: PageMark[] = [];
  for (const a of items) {
    // 画像全体の説明文（describing）は枠にしない（ページ全体を囲むだけになる）
    if (a.motivation === 'describing') continue;
    const shape = shapeOf(a.target);
    if (!shape) continue;
    const bodies = Array.isArray(a.body) ? a.body : a.body ? [a.body] : [];
    const tag = bodies.find((b) => b.purpose === 'tagging')?.value;
    const text = bodies.some((b) => b.purpose !== 'tagging' && !!b.value);
    const color = COLOR.exec(a.stylesheet?.value ?? '')?.[1] ?? CLASS_PALETTE[0];
    out.push({ ...shape, color, text, ...(tag ? { tag } : {}) });
  }
  return out;
};
