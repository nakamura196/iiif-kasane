// 推論の結果（推論に渡した画像の画素）を、Canvas 座標の W3C / IIIF の AnnotationPage にする。
// OCR の行は motivation "supplementing"（画像の一部の文字起こし。textGranularity "line"）、
// 領域は "tagging"（本文は区分名）、画像全体の説明文は "describing"。どのモデルで作ったかは generator に書く。
// 輪郭（polygon）のある領域は、枠（#xywh）ではなく SvgSelector の多角形を target にする。
// 区分名（label）のあるものは、区分ごとに色を付ける（Recipe 0045 と同じく、target の styleClass と注釈の stylesheet）。
// モデルが出したものは捨てない。文字の読めなかった行も、区分名があれば領域として残す。
import type { InferenceOutput } from './types';

/** How a pixel of the inferred image maps to the Canvas: canvas = offset + pixel * scale. */
export interface ImageToCanvas {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * The mapping for an image painted on a Canvas, from the size of the image given to the model. `target`: where the
 * image goes on the Canvas (absent: the whole Canvas). Cropped (`regionSpec`), turned or mirrored images are not
 * handled: null.
 */
export const imageToCanvasOf = (
  layer: { target?: { x: number; y: number; w: number; h: number }; regionSpec?: string; rotation: number; mirror: boolean },
  canvas: { width?: number; height?: number },
  imageWidth: number,
  imageHeight: number,
): ImageToCanvas | null => {
  if (layer.regionSpec && layer.regionSpec !== 'full') return null;
  if (layer.rotation % 360 !== 0 || layer.mirror) return null;
  const t = layer.target ?? (canvas.width && canvas.height ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : undefined);
  if (!t || !imageWidth || !imageHeight) return null;
  return { x: t.x, y: t.y, scaleX: t.w / imageWidth, scaleY: t.h / imageHeight };
};

export interface AnnotationPageOptions {
  canvasId: string;
  map: ImageToCanvas;
  /** Ids for the page and its annotations (for example `urn:uuid:...`). */
  newId: () => string;
  generator: { id: string; name: string };
}

const round = (n: number) => Math.round(n);

/** A polygon in image pixels as an SVG on the Canvas (one decimal: enough for a Canvas of thousands of units). */
const svgPolygon = (pts: [number, number][], map: ImageToCanvas): string => {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  const points = pts.map(([px, py]) => `${f(map.x + px * map.scaleX)},${f(map.y + py * map.scaleY)}`).join(' ');
  return `<svg xmlns='http://www.w3.org/2000/svg'><polygon points='${points}'/></svg>`;
};

/**
 * Colors for classes: distinct hues first, then lighter and darker ones (NDLOCR-Lite alone has 17 classes). Index 0
 * stays blue, the color annotations have without a class. Green sits at 6 so NDLOCR-Lite's figures (block_fig) stand
 * apart from its red main lines (line_main, 1).
 */
export const CLASS_PALETTE: readonly string[] = [
  '#2563eb', '#dc2626', '#9333ea', '#d97706', '#0891b2', '#db2777', '#16a34a', '#4d7c0f',
  '#7c3aed', '#ea580c', '#0d9488', '#be123c', '#65a30d', '#4338ca', '#a16207', '#0e7490',
  '#c026d3', '#57534e', '#15803d', '#b91c1c',
];

/** Whether the model gave anything to write for this item (a text, or a class name). */
export const hasAnnotationBody = (d: { text?: string; label?: string }): boolean => !!(d.text || d.label);

/** The order classes take their colors in: the model's list, then labels outside it as they appear. */
const classOrderOf = (out: InferenceOutput): string[] => [
  ...new Set([...(out.classes ?? []), ...out.items.map((d) => d.label).filter((l): l is string => !!l)]),
];

/** A class name usable as a CSS class (the stylesheet reader takes [A-Za-z_][A-Za-z0-9_-]*); otherwise its number. */
const cssClassOf = (label: string, i: number): string => (/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(label) ? label : `class-${i}`);

/** The color of a class (for the panel's list, the same as on the image). */
export const classColorOf = (out: InferenceOutput, label: string | undefined): string | undefined => {
  if (!label) return undefined;
  const i = classOrderOf(out).indexOf(label);
  return i < 0 ? undefined : CLASS_PALETTE[i % CLASS_PALETTE.length];
};

export const toAnnotationPage = (out: InferenceOutput, o: AnnotationPageOptions): Record<string, unknown> => {
  const { map } = o;
  const generator = { id: o.generator.id, type: 'Software', name: o.generator.name };
  const order = classOrderOf(out);
  const items = out.items
    .filter(hasAnnotationBody)
    .map((d) => {
      const x = round(map.x + d.x * map.scaleX);
      const y = round(map.y + d.y * map.scaleY);
      const w = Math.max(1, round(d.w * map.scaleX));
      const h = Math.max(1, round(d.h * map.scaleY));
      const ci = d.label ? order.indexOf(d.label) : -1;
      const styleClass = ci >= 0 ? cssClassOf(d.label!, ci) : undefined;
      const color = ci >= 0 ? CLASS_PALETTE[ci % CLASS_PALETTE.length] : undefined;
      const selector = d.polygon && d.polygon.length >= 3
        ? { type: 'SvgSelector', value: svgPolygon(d.polygon, map) }
        : styleClass
          ? { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: `xywh=${x},${y},${w},${h}` }
          : undefined;
      const target = selector
        ? { type: 'SpecificResource', source: { id: o.canvasId, type: 'Canvas' }, selector, ...(styleClass ? { styleClass } : {}) }
        : `${o.canvasId}#xywh=${x},${y},${w},${h}`;
      // 文字のある注釈（行）だけ薄く塗る。区分だけの注釈（図版・ブロックなど）は枠線だけにする。
      // 大きな枠が重なると塗りも重なり、絵が沈んで見えるため。
      // Only items with text (lines) get a fill; class-only regions (figures, blocks) get a border, since large
      // overlapping fills stack up and bury the picture.
      const fill = d.text ? `${color}2e` : 'transparent';
      const style = styleClass
        ? { stylesheet: { type: 'CssStylesheet', value: `.${styleClass} { border-color: ${color}; background-color: ${fill}; }` } }
        : {};
      const textBody = { type: 'TextualBody', value: d.text, format: 'text/plain', ...(out.language ? { language: out.language } : {}) };
      if (out.kind === 'description') {
        return { id: o.newId(), type: 'Annotation', motivation: 'describing', body: textBody, target, generator };
      }
      return d.text
        ? {
            id: o.newId(),
            type: 'Annotation',
            motivation: 'supplementing',
            textGranularity: 'line',
            body: textBody,
            target,
            ...style,
            generator,
          }
        : {
            id: o.newId(),
            type: 'Annotation',
            motivation: 'tagging',
            body: { type: 'TextualBody', value: d.label, purpose: 'tagging', format: 'text/plain' },
            target,
            ...style,
            generator,
          };
    });
  return {
    '@context': [
      'http://iiif.io/api/extension/text-granularity/context.json',
      'http://iiif.io/api/presentation/3/context.json',
    ],
    id: o.newId(),
    type: 'AnnotationPage',
    label: { none: [o.generator.name] },
    items,
  };
};

/** The text of an OCR result, one line per line. */
export const toPlainText = (out: InferenceOutput): string =>
  out.items
    .map((d) => d.text ?? '')
    .filter(Boolean)
    .join('\n');
