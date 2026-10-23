'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import type { ContainerInfo, Xywh } from '../../core';
import { useTranslations } from '../env';
import { OVERLAYS } from '../overlays/registry';
import { focusAtom } from './structureState';

const MIN = 0.2;
const MAX = 20;

/** What the layers inside the stage need to know about the view. */
export interface StageInfo {
  /** Zoom on top of the fitted size (1 = the whole Canvas fits in the box). */
  scale: number;
  tx: number;
  ty: number;
  /** Size of the stage (the Canvas fitted into the box) in CSS pixels at scale 1. */
  stageW: number;
  stageH: number;
  boxW: number;
  boxH: number;
  /** Clockwise degrees the stage is turned about its centre (0 when absent). */
  rotation?: number;
  /** While the view glides to a region: where it started (the tiles keep what lies between). */
  from?: ViewState;
}

/**
 * Zoom and move of the view (`tx`, `ty`: CSS pixels from the box centre).
 * `rotation` (clockwise degrees) turns the stage about its centre: a point at stage offset d
 * shows at t + scale · R(rotation) · d from the box centre.
 */
export interface ViewState {
  scale: number;
  tx: number;
  ty: number;
  rotation?: number;
}

/** (x, y) turned clockwise by `degrees` (y down, as on screen). */
export const rotatePoint = (x: number, y: number, degrees: number): [number, number] => {
  if (!degrees) return [x, y];
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
};

/** How far one can zoom in: until the sharpest source image is magnified three times (at least MAX). */
export const maxScaleOf = (detailWidth: number | undefined, stageW: number): number =>
  detailWidth && stageW > 0 ? Math.max(MAX, (detailWidth * 3) / stageW) : MAX;

export const INITIAL_VIEW: ViewState = { scale: 1, tx: 0, ty: 0 };

/**
 * The view that shows a region of the Canvas (`xywh` in Canvas pixels) in the middle of the box,
 * filling `fill` of it. The stage is the Canvas fitted into the box (`stageW` × `stageH`).
 */
export function viewForRegion(
  xywh: Xywh,
  canvas: { w: number; h: number },
  stage: { w: number; h: number },
  box: { w: number; h: number },
  limits: { min: number; max: number },
  fill = 0.85,
): ViewState {
  const k = stage.w / canvas.w; // stage pixels per Canvas pixel
  const rw = Math.max(xywh[2] * k, 1e-6);
  const rh = Math.max(xywh[3] * k, 1e-6);
  const scale = Math.min(limits.max, Math.max(limits.min, Math.min((box.w * fill) / rw, (box.h * fill) / rh)));
  // the region centre, from the stage centre (the transform origin)
  const cx = (xywh[0] + xywh[2] / 2) * k - stage.w / 2;
  const cy = (xywh[1] + xywh[3] / 2) * k - stage.h / 2;
  return { scale, tx: -cx * scale, ty: -cy * scale };
}

/**
 * The whole stage turned by `rotation` (clockwise degrees), fitted into the box.
 * Unturned, this is INITIAL_VIEW; turned, the stage is shrunk so that its corners stay inside.
 */
export const homeView = (
  s: { stageW: number; stageH: number; boxW: number; boxH: number },
  rotation = 0,
): ViewState => {
  if (!rotation) return INITIAL_VIEW;
  const r = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const sn = Math.abs(Math.sin(r));
  const bw = s.stageW * c + s.stageH * sn;
  const bh = s.stageW * sn + s.stageH * c;
  const scale = bw > 0 && bh > 0 ? Math.min(s.boxW / bw, s.boxH / bh) : 1;
  return { scale, tx: 0, ty: 0, rotation };
};

/**
 * How long the glide to a new view takes (ms): longer the farther it goes across the box or the more it
 * zooms, so that a slide along a scroll can be followed by eye (0.6–1.8 s).
 */
export function glideTime(from: ViewState, to: ViewState, box: { w: number; h: number }): number {
  const across = Math.hypot(to.tx - from.tx, to.ty - from.ty) / Math.max(box.w, box.h, 1);
  const zoom = Math.abs(Math.log2(to.scale / from.scale));
  return Math.round(Math.min(1800, 600 + across * 350 + zoom * 150));
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The same region view for a stage turned by `rotation` (the region still lands in the middle of the box). */
const turnRegionView = (v: ViewState, rotation: number | undefined): ViewState => {
  if (!rotation) return v;
  const [tx, ty] = rotatePoint(v.tx, v.ty, rotation);
  return { ...v, tx, ty, rotation };
};

/** The CSS that places a stage in its box (the same for a second stage drawn over the first). */
export const stageStyleOf = (s: StageInfo): CSSProperties => ({
  position: 'absolute',
  left: (s.boxW - s.stageW) / 2,
  top: (s.boxH - s.stageH) / 2,
  width: s.stageW,
  height: s.stageH,
  transform: s.rotation
    ? `translate(${s.tx}px, ${s.ty}px) rotate(${s.rotation}deg) scale(${s.scale})`
    : `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`,
  transformOrigin: 'center center',
  ['--image-scale' as string]: s.scale,
});

/**
 * The same stage magnified `zoom` times around a point of the box (CSS pixels from its top left),
 * so that the point shows the same place of the Canvas.
 */
export const zoomStageAt = (s: StageInfo, zoom: number, x: number, y: number): StageInfo => {
  const px = x - s.boxW / 2;
  const py = y - s.boxH / 2;
  return { ...s, scale: s.scale * zoom, tx: px - (px - s.tx) * zoom, ty: py - (py - s.ty) * zoom };
};

interface Props {
  /** A single plain image (no layers). */
  src?: string;
  alt?: string;
  /** The Canvas size. Without it, the natural size of `src`. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** Width in pixels of the sharpest source image; it decides how far one can zoom in. */
  detailWidth?: number;
  /** The container whose overlays (OVERLAYS) are drawn over the image. */
  container?: ContainerInfo;
  /** The picture itself, drawn into the stage (positions are percentages of the Canvas). */
  children?: (stage: StageInfo) => ReactNode;
  /** Drawn over the picture, under the overlays. */
  extra?: ReactNode;
  onFailed?: () => void;
  /** Controlled view (to move two views together). Without it the view keeps its own. */
  view?: ViewState;
  onViewChange?: (view: ViewState) => void;
  /** Drawn over the stage, in box coordinates (e.g. a second stage cut by a clip-path). */
  over?: (stage: StageInfo) => ReactNode;
}

// 画像と同じ大きさの透明な層に、重ね表示（OVERLAYS）を載せる。
// 層はズーム・移動に追従する（舞台と一緒に動く）。位置は Canvas 座標の割合で置ける。
// 線の太さなどを画面上で一定にしたいときは、CSS 変数 `--image-scale`（拡大率）で割る。
export function OverlayLayer({
  container,
  canvasWidth,
  canvasHeight,
  stage,
  layer = 'stage',
}: {
  container: ContainerInfo;
  canvasWidth: number;
  canvasHeight: number;
  stage?: StageInfo;
  /** 'box': the overlays that stay put over the view (Overlay.layer), drawn in box coordinates. */
  layer?: 'stage' | 'box';
}) {
  const active = OVERLAYS.filter((o) => (o.layer ?? 'stage') === layer && o.available(container));
  if (active.length === 0) return null;
  const sized = { ...container, width: canvasWidth, height: canvasHeight };
  return (
    <div className="absolute inset-0 pointer-events-none" data-iiif-overlay-layer={layer}>
      {active.map((o) => (
        <div key={o.id} className="absolute inset-0 pointer-events-none" data-iiif-overlay={o.id}>
          <o.Component container={sized} canvasWidth={canvasWidth} canvasHeight={canvasHeight} stage={stage} />
        </div>
      ))}
    </div>
  );
}

// The viewport: wheel zoom, drag to move, double-click to reset (CSS transform only).
// The picture and the overlays live in one "stage" the size of the fitted Canvas, so they move together.
// Nothing here is passed through WebGL, so images without CORS headers still show.
export default function ImageView({
  src,
  alt = '',
  canvasWidth,
  canvasHeight,
  detailWidth,
  container,
  children,
  extra,
  onFailed,
  view: controlledView,
  onViewChange,
  over,
}: Props) {
  const t = useTranslations('Viewer');
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [ownView, setOwnView] = useState<ViewState>(INITIAL_VIEW);
  const view = controlledView ?? ownView;
  // the latest view and change handler, for the wheel listener and functional updates
  const viewRef = useRef(view);
  const changeRef = useRef(onViewChange);
  useEffect(() => {
    viewRef.current = view;
    changeRef.current = onViewChange;
  });
  const setView = useCallback((next: ViewState | ((v: ViewState) => ViewState)) => {
    const v = typeof next === 'function' ? next(viewRef.current) : next;
    viewRef.current = v;
    if (changeRef.current) changeRef.current(v);
    else setOwnView(v);
  }, []);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const nat = natural && natural.src === src ? natural : null;
  const cw = canvasWidth ?? nat?.w;
  const ch = canvasHeight ?? nat?.h;

  // the stage: the Canvas fitted into the box
  let stageW = 0;
  let stageH = 0;
  if (cw && ch && size.w > 0 && size.h > 0) {
    const fit = Math.min(size.w / cw, size.h / ch);
    stageW = cw * fit;
    stageH = ch * fit;
  }
  const maxScale = maxScaleOf(detailWidth, stageW);
  const maxRef = useRef(maxScale);
  useEffect(() => {
    maxRef.current = maxScale;
  }, [maxScale]);

  // A move of the table of contents or a story step to a region of this Canvas: zoom there (once per move),
  // with a short glide (none when opened from a link: `instant`). Without `container` the view does not follow (compare views, previews).
  const focus = useAtomValue(focusAtom);
  const focusXywh = container && focus?.target.canvasId === container.id ? focus.target.xywh : undefined;
  const focusSeq = focus?.seq ?? 0;
  const focusInstant = !!focus?.instant;
  const doneFocus = useRef(0);
  // the glide under way: where it started and how long it takes
  const [gliding, setGliding] = useState<{ from: ViewState; ms: number } | null>(null);
  const glideTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusXywh || doneFocus.current === focusSeq || !cw || !ch || stageW <= 0) return;
    doneFocus.current = focusSeq;
    const from = viewRef.current;
    const to = turnRegionView(
      viewForRegion(focusXywh, { w: cw, h: ch }, { w: stageW, h: stageH }, size, { min: MIN, max: maxRef.current }),
      from.rotation,
    );
    window.clearTimeout(glideTimer.current);
    if (focusInstant || reducedMotion()) {
      setGliding(null);
    } else {
      const ms = glideTime(from, to, size);
      setGliding({ from, ms });
      glideTimer.current = window.setTimeout(() => setGliding(null), ms + 100);
    }
    setView(to);
  }, [focusXywh, focusSeq, focusInstant, cw, ch, stageW, stageH, size, setView]);
  useEffect(() => () => window.clearTimeout(glideTimer.current), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // keep the point under the cursor fixed (transform origin is the box centre)
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const scale = Math.min(maxRef.current, Math.max(MIN, v.scale * Math.exp(-e.deltaY * 0.0015)));
        const k = scale / v.scale;
        return { ...v, scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  if (src !== undefined && failed === src) {
    return <div className="p-4 text-sm text-[var(--ds-fg)]" role="alert">{t('imageError')}</div>;
  }

  const stage: StageInfo = {
    scale: view.scale,
    tx: view.tx,
    ty: view.ty,
    stageW,
    stageH,
    boxW: size.w,
    boxH: size.h,
    rotation: view.rotation,
    ...(gliding ? { from: gliding.from } : {}),
  };
  const stageStyle = gliding
    ? { ...stageStyleOf(stage), transition: `transform ${gliding.ms}ms cubic-bezier(0.65, 0, 0.35, 1)` }
    : stageStyleOf(stage);

  return (
    <div
      ref={box}
      className="relative w-full h-full overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing"
      title={t('zoomHint')}
      onPointerDown={(e) => {
        setGliding(null);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      // back to the whole Canvas; a turned stage stays turned
      onDoubleClick={() => setView((v) => homeView({ stageW, stageH, boxW: size.w, boxH: size.h }, v.rotation))}
    >
      {src !== undefined && !nat && !canvasWidth && (
        // only to learn the natural size (the Canvas has none)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute w-0 h-0 opacity-0"
          onLoad={(e) => setNatural({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(src)}
        />
      )}
      {stageW > 0 && cw && ch && (
        <div style={stageStyle} data-iiif-stage>
          {src !== undefined && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              draggable={false}
              onError={() => {
                setFailed(src);
                onFailed?.();
              }}
              className="absolute inset-0 w-full h-full"
            />
          )}
          {children?.(stage)}
          {extra}
          {container && <OverlayLayer container={container} canvasWidth={cw} canvasHeight={ch} stage={stage} />}
        </div>
      )}
      {stageW > 0 && cw && ch && over?.(stage)}
      {stageW > 0 && cw && ch && container && (
        <OverlayLayer container={container} canvasWidth={cw} canvasHeight={ch} stage={stage} layer="box" />
      )}
    </div>
  );
}
