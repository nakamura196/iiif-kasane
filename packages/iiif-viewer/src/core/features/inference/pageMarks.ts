// Marks to draw over a page thumbnail, read from an inference AnnotationPage (the one toAnnotationPage makes).
// Boxes (#xywh or FragmentSelector) and polygons (SvgSelector) are returned in Canvas coordinates. The color comes
// from the annotation's stylesheet, the tag (class name) from the body whose purpose is tagging, and the kind from
// the motivation. An annotation without a color gets the color of no class (CLASS_PALETTE[0]).
import { CLASS_PALETTE } from './annotationPage';
import { annotationKindOf } from '../annotationKinds';

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
  /**
   * The kind of the annotation (its motivation, see annotationKindOf), for filtering by kind. pageMarksOf always sets
   * it; it is optional so that marks made elsewhere before kinds existed still type-check.
   */
  kind?: string;
  /** Text Granularity extension: the unit of text (line, word …), when the annotation says. */
  granularity?: string;
}

const XYWH = /xywh=(?:pixel:)?(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)/;
const COLOR = /border-color:\s*(#[0-9a-fA-F]{3,8})/;
const POINTS = /points=['"]([^'"]+)['"]/;

const boxOf = (s: string): Omit<PageMark, 'color' | 'text' | 'kind' | 'granularity'> | null => {
  const m = XYWH.exec(s);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
};

const polygonOf = (svg: string): Omit<PageMark, 'color' | 'text' | 'kind' | 'granularity'> | null => {
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
  motivation?: string | string[];
  textGranularity?: string;
  target?: unknown;
  body?: { value?: string; purpose?: string } | { value?: string; purpose?: string }[];
  stylesheet?: { value?: string };
};

const shapeOf = (target: unknown): Omit<PageMark, 'color' | 'text' | 'kind' | 'granularity'> | null => {
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
    // A description of the whole image (describing) gets no mark: it would only frame the whole page
    const motivations = Array.isArray(a.motivation) ? a.motivation : a.motivation ? [a.motivation] : [];
    if (motivations.includes('describing')) continue;
    const shape = shapeOf(a.target);
    if (!shape) continue;
    const bodies = Array.isArray(a.body) ? a.body : a.body ? [a.body] : [];
    const tag = bodies.find((b) => b.purpose === 'tagging')?.value;
    const text = bodies.some((b) => b.purpose !== 'tagging' && !!b.value);
    const color = COLOR.exec(a.stylesheet?.value ?? '')?.[1] ?? CLASS_PALETTE[0];
    const kind = annotationKindOf({ motivations });
    const granularity = typeof a.textGranularity === 'string' && a.textGranularity ? a.textGranularity : undefined;
    out.push({ ...shape, color, text, kind, ...(tag ? { tag } : {}), ...(granularity ? { granularity } : {}) });
  }
  return out;
};
