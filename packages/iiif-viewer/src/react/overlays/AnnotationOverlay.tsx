'use client';

import { useAtom, useAtomValue } from 'jotai';
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef } from 'react';
import {
  bboxOf,
  groupByRegion,
  labelIn,
  matchesCanvasAnnotation,
  pickBodies,
  presentCanvasTags,
  pointPercent,
  regionBoxPercent,
  sanitizeAnnotationHtml,
  searchTerms,
  type CanvasAnnotation,
  type RegionGroup,
  type StyleDeclarations,
} from '../../core';
import { manifestAtom } from '../atoms';
import { useLocale } from '../env';
import {
  canvasAnnotationGranularityAtom,
  canvasAnnotationQueryAtom,
  canvasAnnotationTagsAtom,
  selectedCanvasAnnotationAtom,
} from './canvasAnnotationState';
import { storyFrameAtom, storyOpenAtom } from './storyState';
import { DOM_MARK_LIMIT, boxOfRegion, overlaps, pixelsPerUnit, visibleBoxOf, type Box } from './annotationMarks';
import type { Overlay, OverlayProps } from './types';
import { useCanvasAnnotations } from './useCanvasAnnotations';

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// 領域の面積（小さい物を手前に置くための並べ替え用）
const areaOf = (a: CanvasAnnotation): number => {
  const r = a.region;
  if (r.type === 'rect') return r.w * r.h;
  if (r.type === 'polygon') return r.bbox.w * r.bbox.h;
  return 0;
};

const STROKE = '#2563eb';

// 画像の上に、Canvas 上の注釈の領域を重ねる。位置は Canvas 座標の割合で置く（画像と同じ大きさの層の中）。
// Canvas 全体への注釈は枠を描かない（右パネルにだけ出る）。
export function AnnotationOverlayView({ container, canvasWidth, canvasHeight, stage }: OverlayProps) {
  const locale = useLocale();
  const manifest = useAtomValue(manifestAtom);
  const { annotations, styleOf } = useCanvasAnnotations(manifest, container);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  // While a story is read, only the current scene may be framed (thin line, no fill), and only when asked.
  const storyOpen = useAtomValue(storyOpenAtom);
  const storyFrame = useAtomValue(storyFrameAtom);
  const granularity = useAtomValue(canvasAnnotationGranularityAtom);
  // 右パネルの検索欄に文字があるか、タグを選んでいれば、当たった注釈の印だけを出す（選んでいる注釈は残す）
  const query = useDeferredValue(useAtomValue(canvasAnnotationQueryAtom));
  const terms = useMemo(() => searchTerms(query), [query]);
  // 右パネルで選んだタグ。今の単位の注釈に無いタグは、右パネルと同じく無視する
  const chosenTags = useAtomValue(canvasAnnotationTagsAtom);
  const tags = useMemo(
    () =>
      presentCanvasTags(
        granularity ? annotations.filter((a) => a.granularity === granularity) : annotations,
        chosenTags,
        locale,
      ),
    [annotations, granularity, chosenTags, locale],
  );
  const filtering = terms.length > 0 || tags.length > 0;

  // Annotations that share a region (Shared Region extension) are drawn as one box, in the order of the list.
  // A story shows only its current scene, so the chosen annotation matters to the list only then.
  const storySelected = storyOpen ? (storyFrame && selected ? selected : '\u0000') : null;
  const drawn = useMemo(() => {
    const shown = annotations
      .filter((a) => a.region.type !== 'canvas' && !a.layer) // layer annotations are drawn by the layer itself
      .filter((a) => storySelected === null || a.id === storySelected)
      .filter((a) => !granularity || a.granularity === granularity || a.motivations.includes('highlighting'))
      .filter((a) => !filtering || matchesCanvasAnnotation(a, terms, tags, locale));
    return groupByRegion(shown).sort((a, b) => areaOf(b.annotations[0]) - areaOf(a.annotations[0]));
  }, [annotations, storySelected, granularity, filtering, terms, tags, locale]);
  // the chosen one stays drawn when a search or a tag would hide it
  const chosen = useMemo(() => {
    if (!selected || !filtering || drawn.some((g) => g.annotations.some((m) => m.id === selected))) return [];
    const a = annotations.find((x) => x.id === selected && x.region.type !== 'canvas' && !x.layer);
    return a ? groupByRegion([a]) : [];
  }, [selected, filtering, drawn, annotations]);
  const toggle = useCallback((id: string, isSel: boolean) => setSelected(isSel ? null : id), [setSelected]);
  const all = useMemo(
    () => [...drawn, ...chosen].map((g) => ({ group: g, box: boxOfRegion(g.annotations[0]) })),
    [drawn, chosen],
  );
  if (all.length === 0 || !(canvasWidth > 0) || !(canvasHeight > 0)) return null;

  // 画面に見えている分だけ描く。少なければ押せる印、多ければ 1 枚の canvas にまとめる。
  // 押せる印は拡大のたびに全部描き直しになる（線の太さが拡大率で決まるため）。2 万件で 1 段 190ms かかった。
  const view = visibleBoxOf(stage, canvasWidth, canvasHeight, 0.2);
  const onScreen = all.filter((d) => d.box && overlaps(d.box, view));
  const asCanvas = !!stage && onScreen.length > DOM_MARK_LIMIT;
  const isSelected = (g: RegionGroup<CanvasAnnotation>) =>
    selected !== null && g.annotations.some((m) => m.id === selected);
  // On the canvas, the chosen mark is still drawn as a mark one can press (and on top of the others).
  const marks = asCanvas ? onScreen.filter((d) => isSelected(d.group)) : onScreen;

  // Each mark is drawn again only when it changes (being chosen or not), not when another one is chosen:
  // a Canvas may have tens of thousands of them.
  return (
    <div className="absolute inset-0 pointer-events-none" data-overlay="annotations">
      {asCanvas ? (
        <AnnotationCanvas
          drawn={onScreen.filter((d) => !isSelected(d.group))}
          view={visibleBoxOf(stage, canvasWidth, canvasHeight)}
          unit={pixelsPerUnit(stage, canvasWidth)}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          styleOf={styleOf}
          onPick={(a) => setSelected(a.id)}
        />
      ) : null}
      {marks.map(({ group: g }) => (
        <Mark
          key={g.key}
          group={g}
          selected={isSelected(g)}
          storyOpen={storyOpen}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          locale={locale}
          styleOf={styleOf}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

const titleOf = (a: CanvasAnnotation, locale: string) =>
  labelIn(a.title, locale) ||
  pickBodies(a.bodies, locale)
    .filter((b) => b.kind === 'text')
    .map((b) => (/html/i.test(b.format ?? '') ? plain(b.value ?? '') : b.value))
    .join(' / ');

const Mark = memo(function Mark({
  group: g,
  selected: isSel,
  storyOpen,
  canvasWidth,
  canvasHeight,
  locale,
  styleOf,
  onToggle,
}: {
  group: RegionGroup<CanvasAnnotation>;
  selected: boolean;
  storyOpen: boolean;
  canvasWidth: number;
  canvasHeight: number;
  locale: string;
  styleOf: (a: CanvasAnnotation) => { target: StyleDeclarations };
  onToggle: (id: string, isSel: boolean) => void;
}) {
  const a = g.annotations[0];
  const count = g.annotations.length;
  const r = a.region;
  const toggle = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onToggle(a.id, isSel);
  };
  // 見た目の指定（許可した性質だけ）。選択中は既定の強調を優先する。
  const st: StyleDeclarations = isSel ? {} : styleOf(a).target;
  const common = {
    title: g.annotations.map((m) => titleOf(m, locale)).filter(Boolean).join(' / ') || undefined,
    ...(count > 1 ? { 'data-annotation-count': count } : {}),
    'data-annotation-id': a.id,
  };
  if (r.type === 'point') {
    const p = pointPercent(r.x, r.y, canvasWidth, canvasHeight);
    return (
      <button
        key={g.key}
        type="button"
        {...common}
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={common.title}
        className={`absolute pointer-events-auto rounded-full border-2 border-white shadow ${
          isSel ? 'bg-orange-500 w-5 h-5' : 'bg-blue-600 w-4 h-4'
        }`}
        style={{
          ...st,
          left: `${p.left}%`,
          top: `${p.top}%`,
          // keep the mark the same size on screen at any zoom
          transform: 'translate(-50%, -50%) scale(calc(1 / var(--image-scale, 1)))',
        }}
      />
    );
  }
  if (r.type === 'polygon') {
    const b = regionBoxPercent(r, canvasWidth, canvasHeight)!;
    // draw in the Canvas's own coordinates inside a box that covers only the bounding box
    const box = bboxOf(r.rings);
    const pad = 0;
    return (
      <svg
        key={g.key}
        className="absolute pointer-events-none overflow-visible"
        style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` }}
        viewBox={`${box.x - pad} ${box.y - pad} ${box.w || 1} ${box.h || 1}`}
        preserveAspectRatio="none"
      >
        {r.rings.map((ring, i) => (
          <polygon
            key={i}
            {...common}
            points={ring.map((pt) => pt.join(',')).join(' ')}
            className="pointer-events-auto cursor-pointer"
            fill={isSel ? (storyOpen ? 'none' : 'rgba(249,115,22,0.30)') : (st.backgroundColor ?? 'rgba(37,99,235,0.15)')}
            stroke={isSel ? '#f97316' : (st.borderColor ?? STROKE)}
            // non-scaling-stroke keeps the width from the viewBox's stretch, but not from the stage's CSS
            // zoom (the same as the rectangles' outline below), so the width is divided by the zoom too.
            style={{ strokeWidth: 'calc(2px / var(--image-scale, 1))' }}
            vectorEffect="non-scaling-stroke"
            onClick={toggle}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ))}
      </svg>
    );
  }
  if (r.type === 'rect') {
    const b = regionBoxPercent(r, canvasWidth, canvasHeight)!;
    const html = a.painted
      ? pickBodies(a.bodies, locale).find((x) => x.kind === 'text')?.value
      : undefined;
    return (
      <div
        key={g.key}
        {...common}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggle(e);
        }}
        className={`absolute pointer-events-auto cursor-pointer overflow-hidden ${
          isSel ? (storyOpen ? '' : 'bg-orange-500/10') : 'bg-blue-600/10'
        }`}
        style={{
          ...st,
          // The outline is an inset shadow divided by the zoom, so it stays 2px on screen.
          // A CSS border never gets thinner than one pixel before the stage is magnified (at 100x it
          // is 100px wide), and an svg non-scaling-stroke does not see the CSS transform either.
          // A border the manifest's stylesheet asks for (recipe 0045) is kept as it is.
          ...(!isSel && (st.border || st.borderStyle || st.borderWidth)
            ? {}
            : {
                borderStyle: 'none',
                boxShadow: `inset 0 0 0 calc(2px / var(--image-scale, 1)) ${isSel ? '#f97316' : (st.borderColor ?? STROKE)}`,
              }),
          left: `${b.left}%`,
          top: `${b.top}%`,
          width: `${b.width}%`,
          height: `${b.height}%`,
          ...(html ? { containerType: 'size' as const } : {}),
        }}
      >
        {count > 1 ? (
          <span
            className="absolute left-0 top-0 rounded-br bg-blue-600 px-1 text-white leading-tight"
            style={{ fontSize: '12px', transformOrigin: 'top left', scale: 'calc(1 / var(--image-scale, 1))' }}
          >
            {count}
          </span>
        ) : null}
        {html ? (
          <div
            className="text-white bg-black/50 w-full h-full break-words"
            style={{ fontSize: '12cqh', lineHeight: 1.2 }}
            dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(html) }}
          />
        ) : null}
      </div>
    );
  }
  return null;
});

type Drawn = { group: RegionGroup<CanvasAnnotation>; box: Box | null };

// How far (screen pixels) a press may move and still pick a mark; further is a drag of the image.
const CLICK_SLOP = 4;

// 印が多いときの描き方。見えている範囲だけを、画面の画素の細かさで 1 枚の canvas に描く。
// 拡大・移動のたびに描き直すが、2 万件でも数ミリ秒で済む（DOM の印は 1 つずつ描き直しになる）。
// 押した所にある印（いちばん小さい物）を選ぶ。ドラッグは今までどおり画像の移動になる。
function AnnotationCanvas({
  drawn,
  view,
  unit,
  canvasWidth,
  canvasHeight,
  styleOf,
  onPick,
}: {
  drawn: Drawn[];
  /** The part of the Canvas the canvas covers (Canvas coordinates). */
  view: Box;
  /** Screen pixels per Canvas unit. */
  unit: number;
  canvasWidth: number;
  canvasHeight: number;
  styleOf: (a: CanvasAnnotation) => { target: StyleDeclarations };
  onPick: (a: CanvasAnnotation) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const k = unit * dpr; // canvas pixels per Canvas unit
  const pw = Math.max(1, Math.ceil(view.w * k));
  const ph = Math.max(1, Math.ceil(view.h * k));

  useLayoutEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    if (el.width !== pw) el.width = pw;
    if (el.height !== ph) el.height = ph;
    ctx.clearRect(0, 0, pw, ph);
    // One path per look, so 20,000 boxes are a handful of fill and stroke calls.
    const batches = new Map<string, { fill: string; stroke: string; path: Path2D }>();
    const pathFor = (fill: string, stroke: string) => {
      const key = `${fill}|${stroke}`;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { fill, stroke, path: new Path2D() }));
      return b.path;
    };
    const px = (x: number) => (x - view.x) * k;
    const py = (y: number) => (y - view.y) * k;
    for (const { group } of drawn) {
      const a = group.annotations[0];
      const r = a.region;
      const st = styleOf(a).target;
      const stroke = st.borderColor ?? STROKE;
      if (r.type === 'rect') {
        pathFor(st.backgroundColor ?? 'rgba(37,99,235,0.10)', stroke).rect(px(r.x), py(r.y), r.w * k, r.h * k);
      } else if (r.type === 'polygon') {
        const path = pathFor(st.backgroundColor ?? 'rgba(37,99,235,0.15)', stroke);
        for (const ring of r.rings) {
          ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(px(x), py(y)) : path.lineTo(px(x), py(y))));
          path.closePath();
        }
      } else if (r.type === 'point') {
        const path = pathFor(st.backgroundColor ?? '#2563eb', '#ffffff');
        const rad = 5 * dpr;
        path.moveTo(px(r.x) + rad, py(r.y));
        path.arc(px(r.x), py(r.y), rad, 0, Math.PI * 2);
      }
    }
    // The marks one can press have a 2px outline. Keep it where the boxes are large enough to show it,
    // so the look does not jump between the two ways; small boxes get 1px, or they would be all outline.
    const sizes = drawn
      .slice(0, 200)
      .map((d) => (d.box && d.box.w > 0 ? Math.min(d.box.w, d.box.h) * unit : 0))
      .sort((a, b) => a - b);
    ctx.lineWidth = (sizes[sizes.length >> 1] ?? 0) >= 16 ? 2 * dpr : dpr;
    for (const b of batches.values()) {
      ctx.fillStyle = b.fill;
      ctx.fill(b.path);
      ctx.strokeStyle = b.stroke;
      ctx.stroke(b.path);
    }
  }, [drawn, view.x, view.y, k, unit, pw, ph, styleOf, dpr]);

  // the smallest mark under a point of the canvas (CSS pixels from its top left)
  const pick = (cx: number, cy: number): CanvasAnnotation | null => {
    const x = view.x + cx / unit;
    const y = view.y + cy / unit;
    const reach = 6 / unit; // a point is drawn 5px wide, and a thin box is hard to hit exactly
    let best: CanvasAnnotation | null = null;
    let bestArea = Infinity;
    for (const { group, box } of drawn) {
      if (!box) continue;
      if (x < box.x - reach || x > box.x + box.w + reach || y < box.y - reach || y > box.y + box.h + reach) continue;
      const area = box.w * box.h;
      if (area < bestArea) {
        best = group.annotations[0];
        bestArea = area;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={ref}
      data-annotation-canvas
      className="absolute pointer-events-auto"
      style={{
        left: `${(view.x / canvasWidth) * 100}%`,
        top: `${(view.y / canvasHeight) * 100}%`,
        width: `${(view.w / canvasWidth) * 100}%`,
        height: `${(view.h / canvasHeight) * 100}%`,
      }}
      // The press still reaches the image (to drag it), which then holds the pointer, so the release is
      // heard on the window. Only a press that did not move picks a mark.
      onPointerDown={(e) => {
        const el = e.currentTarget;
        const x0 = e.clientX;
        const y0 = e.clientY;
        window.addEventListener(
          'pointerup',
          (up) => {
            if (Math.hypot(up.clientX - x0, up.clientY - y0) > CLICK_SLOP) return;
            const rect = el.getBoundingClientRect();
            const a = pick(up.clientX - rect.left, up.clientY - rect.top);
            if (a) onPick(a);
          },
          { once: true },
        );
      }}
    />
  );
}


export const annotationOverlay: Overlay = {
  id: 'annotations',
  available: (container) => container.kind === 'Canvas',
  Component: AnnotationOverlayView,
};
