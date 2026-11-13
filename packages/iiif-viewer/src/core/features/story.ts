// ストーリー（ガイドツアー）: 説明の注釈を順に送りながら、その領域に寄って本文を読ませる。
//
// 専用の形式は作らず、次の慣習に合わせる（docs/notes/storytelling.md）。
//  - Canvas に書かれた describing / commenting の注釈が、配列の順にステップになる
//    （Digirati Manifest Editor の Exhibition の tour、Cogapp の Storiiies、倭寇図巻の m.json が同じ型）
//  - 本文 HTML の先頭の見出し（h1〜h6）が、そのステップの見出し（Digirati の splitTourStepHtml と同じ規則）
// そのうえで、書いてあれば使うもの:
//  - 章: structures の Range。Range が指す領域（Canvas#xywh）と同じか、それを含む領域のステップが、その章に入る
//  - 多言語: 本文の Choice か、language の違う TextualBody を並べたもの。UI の言語のものを選ぶ
//  - 複数の Canvas: Canvas の順に、それぞれのステップをつなげる
// Range が無いときは、見出しのあるステップと無いステップが混ざっていれば、見出しのあるステップを章の頭とみなす。
//
// 3D（Scene）では、Presentation 4.0 の Guided Viewing and Storytelling に従う（manifestParser.ts の
// sceneStoryAnnotationsOf）。ステップは Scene の annotations にある describing / commenting の注釈で、
// `scope` が指す Camera がそのステップの視点になる。behavior "sequence" の AnnotationPage があれば、
// その頁の注釈がステップ。無ければ、Camera を指す注釈だけがステップになる。

import type { ManifestV4 } from '../types/iiif';
import { containersOf, sceneOf } from '../services/containers';
import { sceneStoryAnnotationsOf, type DefaultCamera } from '../services/manifestParser';
import { readAnnotationBodies } from './annotationBody';
import { labelIn } from '../services/paintedModels';
import {
  embeddedCanvasAnnotations,
  pickBodies,
  type AnnotationBodyItem,
  type AnnotationRegion,
  type CanvasAnnotation,
} from './annotations';
import { rangesOf, type CanvasTarget, type TocNode, type Xywh } from './structure';

const STORY_MOTIVATIONS = new Set(['describing', 'commenting']);

export interface StoryStep {
  id: string;
  canvasId: string;
  region: AnnotationRegion;
  bodies: AnnotationBodyItem[];
  /** A step in a Scene: the Camera it is seen from (`scope`), or null to stay where the view is. */
  camera?: DefaultCamera | null;
  /** A step in a Scene: the notes it selects (the ids of their Annotations; `scope`). */
  notes?: string[];
}

export interface StoryChapter {
  /** The Range id, or the id of the step that heads the chapter. */
  id: string;
  /** A Range label (language map), or a heading text. */
  label: unknown;
  /** Where to go when the chapter is chosen. */
  target: CanvasTarget | null;
  /** Indexes into `steps`. */
  steps: number[];
  /** The chapter is headed by one of its own steps (no Range). */
  headStep?: number;
}

export interface Story {
  steps: StoryStep[];
  /** Empty when the steps are not grouped. */
  chapters: StoryChapter[];
}

const isStep = (a: CanvasAnnotation): boolean =>
  !a.painted && !a.layer && a.motivations.some((m) => STORY_MOTIVATIONS.has(m)) && a.bodies.some((b) => b.kind === 'text');

/** The rectangle of a region (a point is a box of `pad` around it). Undefined for the whole Canvas. */
export function regionXywh(region: AnnotationRegion, pad = 0): Xywh | undefined {
  switch (region.type) {
    case 'rect':
      return [region.x, region.y, region.w, region.h];
    case 'polygon':
      return [region.bbox.x, region.bbox.y, region.bbox.w, region.bbox.h];
    case 'point':
      return [region.x - pad, region.y - pad, pad * 2, pad * 2];
    default:
      return undefined;
  }
}

/** Where the viewer goes for a step. A point gets a box of a tenth of the Canvas around it. */
export function stepTarget(step: StoryStep, canvasSize?: { width?: number; height?: number }): CanvasTarget {
  const side = Math.min(canvasSize?.width ?? 0, canvasSize?.height ?? 0);
  const xywh = regionXywh(step.region, side > 0 ? side / 10 : 50);
  return xywh ? { canvasId: step.canvasId, xywh } : { canvasId: step.canvasId };
}

// ---- headings ----------------------------------------------------------------

const HEADING = /^(?:\s|<!--[\s\S]*?-->)*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const plain = (html: string): string => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Splits a leading h1–h6 off an HTML body: `{ heading: text, rest: html }`. */
export function splitHeading(html: string): { heading?: string; rest: string } {
  const m = HEADING.exec(html);
  if (!m) return { rest: html };
  const heading = plain(m[2]);
  return { heading: heading || undefined, rest: html.slice(m[0].length) };
}

const isHtml = (b: AnnotationBodyItem) => /html/i.test(b.format ?? '');

/**
 * The text bodies to show, in the wanted language: a Choice gives one, and of several plain
 * TextualBodies with different languages, those in the wanted language (else those of the first language).
 */
export function storyBodies(step: StoryStep, locale: string): AnnotationBodyItem[] {
  const picked = pickBodies(step.bodies, locale).filter((b) => b.kind === 'text');
  const lang = (l?: string) => l?.toLowerCase().split('-')[0];
  const langs = [...new Set(picked.map((b) => lang(b.language)).filter((l): l is string => !!l))];
  if (langs.length < 2) return picked;
  const want = langs.includes(lang(locale) ?? '') ? lang(locale) : langs[0];
  return picked.filter((b) => !b.language || lang(b.language) === want);
}

/** The heading of a step (from the first text body), and its bodies with that heading taken off. */
export function stepText(step: StoryStep, locale: string): { heading?: string; bodies: AnnotationBodyItem[] } {
  const bodies = storyBodies(step, locale);
  const first = bodies[0];
  if (!first || !isHtml(first)) return { bodies };
  const { heading, rest } = splitHeading(first.value ?? '');
  if (!heading) return { bodies };
  const left = plain(rest) ? [{ ...first, value: rest }, ...bodies.slice(1)] : bodies.slice(1);
  return { heading, bodies: left };
}

// ---- chapters ----------------------------------------------------------------

const same = (a: Xywh, b: Xywh) => a.every((v, i) => Math.abs(v - b[i]) < 0.5);
const contains = (outer: Xywh, inner: Xywh) => {
  const cx = inner[0] + inner[2] / 2;
  const cy = inner[1] + inner[3] / 2;
  return cx >= outer[0] && cx <= outer[0] + outer[2] && cy >= outer[1] && cy <= outer[1] + outer[3];
};

const leaves = (nodes: TocNode[]): TocNode[] =>
  nodes.flatMap((n) => (n.canvases.length > 0 ? [n] : leaves(n.children)));

// A step joins the Range that names its very region, else the smallest Range region that holds its centre.
// A Range that names a whole Canvas holds every step of that Canvas.
function chaptersFromRanges(steps: StoryStep[], ranges: TocNode[]): StoryChapter[] {
  const nodes = leaves(ranges);
  const chapters = nodes.map((n) => ({ id: n.id, label: n.label, target: n.target, steps: [] as number[] }));
  if (chapters.length === 0) return [];
  const area = (t: CanvasTarget) => (t.xywh ? t.xywh[2] * t.xywh[3] : Infinity);
  steps.forEach((s, i) => {
    const box = regionXywh(s.region);
    let best = -1;
    let bestArea = Infinity;
    nodes.forEach((node, ci) => {
      for (const t of node.canvases) {
        if (t.canvasId !== s.canvasId) continue;
        if (box && t.xywh && same(t.xywh, box)) {
          best = ci;
          bestArea = -1;
          return;
        }
        const fits = !t.xywh || (box ? contains(t.xywh, box) : false);
        if (fits && area(t) < bestArea) {
          best = ci;
          bestArea = area(t);
        }
      }
    });
    if (best >= 0) chapters[best].steps.push(i);
  });
  return chapters.filter((c) => c.steps.length > 0);
}

// Without Ranges: when some steps have a heading and some do not, a step with a heading opens a chapter.
function chaptersFromHeadings(steps: StoryStep[], locale: string): StoryChapter[] {
  const headings = steps.map((s) => stepText(s, locale).heading);
  const titled = headings.filter(Boolean).length;
  if (titled === 0 || titled === steps.length) return [];
  const chapters: StoryChapter[] = [];
  steps.forEach((s, i) => {
    const h = headings[i];
    if (h) {
      chapters.push({ id: s.id, label: h, target: null, steps: [i], headStep: i });
    } else if (chapters.length > 0) {
      chapters[chapters.length - 1].steps.push(i);
    } else {
      chapters.push({ id: `${s.id}#lead`, label: '', target: null, steps: [i] });
    }
  });
  return chapters;
}

/**
 * The story of a manifest, or null when there is none (fewer than two steps, or no step points
 * into the picture). Only annotations written into the manifest count; referenced pages are not fetched.
 */
export function storyOf(manifest: ManifestV4 | null | undefined, locale = 'en'): Story | null {
  if (!manifest) return null;
  const steps: StoryStep[] = [];
  for (const c of containersOf(manifest)) {
    if (c.kind === 'Scene') {
      for (const { anno, camera, notes } of sceneStoryAnnotationsOf(sceneOf(manifest, c.id))) {
        const bodies = readAnnotationBodies(anno as unknown as Record<string, unknown>);
        if (!bodies.some((b) => b.kind === 'text')) continue;
        steps.push({ id: anno.id, canvasId: c.id, region: { type: 'canvas' }, bodies, camera, ...(notes.length ? { notes } : {}) });
      }
      continue;
    }
    if (c.kind !== 'Canvas') continue;
    for (const a of embeddedCanvasAnnotations(manifest, c.id, c)) {
      if (isStep(a)) steps.push({ id: a.id, canvasId: c.id, region: a.region, bodies: a.bodies });
    }
  }
  // a story moves the view: some step must point at a region of a Canvas, or at a Camera of a Scene
  if (steps.length < 2 || !steps.some((s) => s.region.type !== 'canvas' || s.camera)) return null;
  const fromRanges = chaptersFromRanges(steps, rangesOf(manifest));
  return { steps, chapters: fromRanges.length > 0 ? fromRanges : chaptersFromHeadings(steps, locale) };
}

/** The chapter label in the wanted language. */
export const chapterLabel = (c: StoryChapter, locale: string): string =>
  typeof c.label === 'string' ? c.label : labelIn(c.label, locale);

/**
 * The step to move to when the story tab is opened, or null to stay. The tab shows "n / total" for the
 * current step, so the picture must show that step too: without this move it stayed on the whole picture
 * while the tab said "1 / 31", and "next" then went to step 2, so step 1 was never seen.
 * Stays when that step is already selected (the picture is on it).
 */
export function openingStep(story: Story, index: number, selected: string | null): number | null {
  if (story.steps.length === 0) return null;
  const at = Math.min(Math.max(index, 0), story.steps.length - 1);
  return story.steps[at].id === selected ? null : at;
}

// ---- a long scroll -----------------------------------------------------------

/** A story told along one long horizontal picture (a handscroll): the strip and the sideways slide use it. */
export interface StoryScroll {
  canvasId: string;
  width: number;
  height: number;
  /** For each step, its span along the scroll in Canvas pixels ([from, to]), or null for the whole picture. */
  spans: ([number, number] | null)[];
  /**
   * For each step, where the view goes: a square of the scroll's height around the scene, so that every
   * scene is shown at the same zoom (the picture fills the height) and moving between them is a sideways slide.
   * Only when the scenes are bands of the full height; otherwise undefined (the view fits each scene).
   */
  views?: (Xywh | undefined)[];
}

/** How much longer than high a picture must be to be read as a scroll. */
const SCROLL_RATIO = 3;

export function scrollOf(story: Story, size: { width?: number; height?: number } | undefined): StoryScroll | null {
  const canvasId = story.steps[0]?.canvasId;
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  if (!canvasId || !story.steps.every((s) => s.canvasId === canvasId)) return null;
  if (!(width > 0 && height > 0) || width / height < SCROLL_RATIO) return null;
  const boxes = story.steps.map((s) => regionXywh(s.region));
  const spans = boxes.map((b): [number, number] | null => (b ? [b[0], b[0] + b[2]] : null));
  const bands = boxes.every((b) => !b || (b[1] <= height * 0.03 && b[3] >= height * 0.94));
  if (!bands) return { canvasId, width, height, spans };
  const side = Math.min(height, width);
  const views = boxes.map((b): Xywh | undefined =>
    b ? [Math.min(Math.max(b[0] + b[2] / 2 - side / 2, 0), width - side), 0, side, height] : undefined,
  );
  return { canvasId, width, height, spans, views };
}

/** The step whose span holds `x` (Canvas pixels along the scroll), else the nearest one; null when none has a span. */
export function stepAt(scroll: StoryScroll, x: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  scroll.spans.forEach((sp, i) => {
    if (!sp) return;
    const d = x < sp[0] ? sp[0] - x : x > sp[1] ? x - sp[1] : 0;
    // inside: the narrowest span wins (a detail inside a scene)
    const key = d === 0 ? -1 / (sp[1] - sp[0] || 1) : d;
    if (key < bestD) {
      bestD = key;
      best = i;
    }
  });
  return best;
}

/**
 * How long autoplay stays on a step (ms): time to read its text (about 9 characters a second, the
 * same for Latin words of about 5 letters) on top of the move, within 6–16 seconds.
 */
export function readingTime(step: StoryStep, locale: string): number {
  const { heading, bodies } = stepText(step, locale);
  const text = [heading ?? '', ...bodies.map((b) => (isHtml(b) ? plain(b.value ?? '') : (b.value ?? '')))].join(' ');
  const latin = /^[\x00-\x7f\s]*$/.test(text);
  const chars = latin ? text.split(/\s+/).filter(Boolean).length * 5 : text.replace(/\s+/g, '').length;
  return Math.round(Math.min(16000, Math.max(6000, 3500 + chars * 110)));
}
