'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  canvasImagesOf,
  isLayerVisible,
  labelIn,
  layerItemsOf,
  layerOpacity,
  orderLayers,
  paintsImage,
  rawCanvasOf,
  type ContainerInfo,
  type ImageLayer,
  type LayerSetting,
} from '../../core';
import { canvasLayersAtom, layerOrderAtom, layerSettingsAtom } from '../atoms';
import AuthPrompt from '../auth/AuthPrompt';
import { useLocale, useTranslations } from '../env';
import { flatDisplay } from './FlatDisplay';
import { imageCanvasDisplay } from './ImageCanvasDisplay';
import ImageLayerView, { useImageInfo } from './ImageTiles';
import { OverlayLayer } from './ImageView';
import { storyOpenAtom } from '../overlays/storyState';
import { compareAtom, compareMultiAtom, focusAtom } from '../internalState';
import { useRawManifest } from './rawManifest';
import { usePageOrder, useSeekOnFocus } from './structureState';
import { containedBox, regionBox, type PageBox } from './pageBox';
import type { Display, DisplayProps } from './types';

const imageOf = (c: ContainerInfo | undefined): { url: string } | null => {
  const o = c?.painting.flatMap((p) => p.options).find((x) => x.kind === 'Image');
  return o ? { url: o.url } : null;
};

export interface PageLayerDraw {
  key: string;
  layer: ImageLayer;
  opacity: number;
}

export interface PagePaint {
  /** Layers drawn through ImageLayerView (when an Image API service, transform, Choice, compositing or auth is used). */
  layers: PageLayerDraw[];
  /** True when the page uses a measured stage box rather than a plain <img>. */
  staged: boolean;
  width?: number;
  height?: number;
  /** Plain image URL when a simple <img> suffices. */
  plainUrl?: string;
}

const needsLayerStage = (l: ImageLayer): boolean =>
  Boolean(l.service || l.rotation || l.mirror || l.regionSpec || l.target || l.auth);

/**
 * Resolves how a Canvas is painted inside a spread or a continuous strip.
 * Plain single-image Canvases without an Image API service keep their lightweight <img>;
 * Canvases with an Image API service, Choice, composited layers, transforms or auth use ImageLayerView.
 */
export function pagePaintOf(
  rawSource: unknown,
  container: ContainerInfo | undefined,
  settings: Record<string, LayerSetting> = {},
  order?: string[],
): PagePaint | null {
  if (!container) return null;
  const source = rawSource ? rawCanvasOf(rawSource, container.id) : undefined;
  if (source && source.type !== 'Scene') {
    const images = canvasImagesOf(source);
    const paintings = images.paintings.filter(paintsImage);
    const items = layerItemsOf(paintings);
    if (items.length > 0) {
      const drawn = orderLayers(items, order).filter((it) => isLayerVisible(it, settings));
      const width = images.width ?? container.width;
      const height = images.height ?? container.height;
      const singlePlain =
        items.length === 1 &&
        drawn.length === 1 &&
        layerOpacity(drawn[0], settings) === 1 &&
        !needsLayerStage(drawn[0].layer);
      if (singlePlain && drawn[0]) {
        return { layers: [], staged: false, width, height, plainUrl: drawn[0].layer.url };
      }
      return {
        layers: drawn.map((it) => ({ key: it.id, layer: it.layer, opacity: layerOpacity(it, settings) })),
        staged: true,
        width,
        height,
      };
    }
  }
  const img = imageOf(container);
  if (!img) return null;
  return { layers: [], staged: false, width: container.width, height: container.height, plainUrl: img.url };
}

// A page rendered through ImageLayerView (Image API info.json + tiles, Choice, layers, rotation, auth).
function StagedPage({
  container,
  paint,
  align,
  vertical,
  inStrip,
  lazy,
  active,
  onClick,
}: {
  container: ContainerInfo;
  paint: PagePaint;
  align?: 'left' | 'right';
  vertical?: boolean;
  inStrip?: boolean;
  lazy?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const locale = useLocale();
  const label = labelIn(container.label, locale);
  // If neither the Canvas nor the painting body declared a size, learn it from the first layer's info.json.
  const fallbackService = !paint.width || !paint.height ? paint.layers[0]?.layer.service : undefined;
  const fallbackInfo = useImageInfo(fallbackService, Boolean(paint.layers[0]?.layer.auth), 0);
  const cw = paint.width || (fallbackInfo.status === 'ready' ? fallbackInfo.info.width : 0);
  const ch = paint.height || (fallbackInfo.status === 'ready' ? fallbackInfo.info.height : 0);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [entered, setEntered] = useState(false);
  const near = !lazy || Boolean(active) || entered || typeof IntersectionObserver === 'undefined';

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (near || !el || typeof IntersectionObserver === 'undefined') return;
    const root = inStrip ? el.closest('[data-iiif-strip]') : null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setEntered(true);
          io.disconnect();
        }
      },
      { root, rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, inStrip]);

  if (inStrip) {
    const stageW = size.w;
    const stageH = size.h;
    const stage = { scale: 1, tx: 0, ty: 0, stageW, stageH, boxW: stageW, boxH: stageH };
    return (
      <div
        ref={box}
        role="img"
        aria-label={label}
        data-canvas-id={container.id}
        onClick={onClick}
        style={cw > 0 && ch > 0 ? { aspectRatio: `${cw} / ${ch}` } : undefined}
        className={`relative overflow-hidden ${vertical ? 'w-full' : 'h-full'} ${onClick ? 'cursor-pointer' : ''} ${
          active ? 'ring-2 ring-blue-500' : ''
        }`}
      >
        {stageW > 0 &&
          cw > 0 &&
          ch > 0 &&
          near &&
          paint.layers.map((it) => (
            <ImageLayerView
              key={it.key}
              layer={it.layer}
              canvasWidth={cw}
              canvasHeight={ch}
              stage={stage}
              opacity={it.opacity}
              showLoading={false}
            />
          ))}
      </div>
    );
  }

  const fit = cw > 0 && ch > 0 && size.w > 0 && size.h > 0 ? Math.min(size.w / cw, size.h / ch) : 0;
  const stageW = cw * fit;
  const stageH = ch * fit;
  const left = align === 'left' ? size.w - stageW : align === 'right' ? 0 : (size.w - stageW) / 2;
  const top = (size.h - stageH) / 2;
  const stage = { scale: 1, tx: 0, ty: 0, stageW, stageH, boxW: stageW, boxH: stageH };

  return (
    <div ref={box} className="relative flex-1 min-h-0 min-w-0">
      <div
        role="img"
        aria-label={label}
        data-canvas-id={container.id}
        onClick={onClick}
        style={stageW > 0 ? { left, top, width: stageW, height: stageH } : { width: 0, height: 0 }}
        className={`absolute overflow-hidden ${onClick ? 'cursor-pointer' : ''} ${active ? 'ring-2 ring-blue-500' : ''}`}
      >
        {stageW > 0 &&
          cw > 0 &&
          ch > 0 &&
          near &&
          paint.layers.map((it, idx) => (
            <ImageLayerView
              key={it.key}
              layer={it.layer}
              canvasWidth={cw}
              canvasHeight={ch}
              stage={stage}
              opacity={it.opacity}
              showLoading={idx === 0}
            />
          ))}
      </div>
    </div>
  );
}

// A page image in a spread or a continuous strip.
function PageImage({
  container,
  paint,
  waitingRaw,
  align,
  vertical,
  inStrip,
  lazy,
  active,
  onClick,
}: {
  container: ContainerInfo;
  paint: PagePaint | null;
  waitingRaw?: boolean;
  align?: 'left' | 'right';
  vertical?: boolean;
  inStrip?: boolean;
  lazy?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const locale = useLocale();
  if (waitingRaw) {
    if (inStrip) {
      const ratio = container.width && container.height ? `${container.width} / ${container.height}` : undefined;
      return <div style={ratio ? { aspectRatio: ratio } : undefined} className={vertical ? 'w-full' : 'h-full'} />;
    }
    return <div className="flex-1 min-h-0 min-w-0" />;
  }
  if (!paint) return null;
  if (paint.staged) {
    return (
      <StagedPage
        container={container}
        paint={paint}
        align={align}
        vertical={vertical}
        inStrip={inStrip}
        lazy={lazy}
        active={active}
        onClick={onClick}
      />
    );
  }
  if (!paint.plainUrl) return null;
  const w = paint.width ?? container.width;
  const h = paint.height ?? container.height;
  const ratio = w && h ? `${w} / ${h}` : undefined;
  const base = vertical ? 'w-full h-auto' : 'h-full w-auto';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={paint.plainUrl}
      alt={labelIn(container.label, locale)}
      loading="lazy"
      draggable={false}
      onClick={onClick}
      data-canvas-id={container.id}
      style={ratio ? { aspectRatio: ratio } : undefined}
      className={`${base} object-contain ${onClick ? 'cursor-pointer' : ''} ${
        active ? 'ring-2 ring-blue-500' : ''
      } ${align === 'left' ? 'ml-auto' : align === 'right' ? 'mr-auto' : ''}`}
    />
  );
}

// Facing pages: the order of the two pages follows the viewing direction.
function Spread({
  pages,
  paints,
  waitingRaw,
  direction,
  labels,
}: {
  pages: ContainerInfo[];
  paints: Array<PagePaint | null>;
  waitingRaw?: boolean;
  direction: string;
  labels?: string[];
}) {
  const vertical = direction === 'top-to-bottom' || direction === 'bottom-to-top';
  const reversed = direction === 'right-to-left' || direction === 'bottom-to-top';
  const indices = pages.map((_, idx) => idx);
  const shown = reversed ? [...indices].reverse() : indices;
  return (
    <div
      className={`flex-1 min-h-0 min-w-0 flex ${vertical ? 'flex-col' : 'flex-row'} items-stretch justify-center overflow-hidden`}
    >
      {shown.map((pageIndex, slotIndex) => {
        const c = pages[pageIndex];
        const paint = paints[pageIndex] ?? null;
        const align = vertical ? undefined : slotIndex === 0 ? 'left' : 'right';
        return (
          <div key={`${pageIndex}:${c.id}`} className="flex-1 min-h-0 min-w-0 flex">
            {labels ? (
              <figure className="flex-1 min-h-0 min-w-0 flex flex-col m-0">
                <figcaption
                  data-testid="compare-label"
                  className="shrink-0 truncate px-2 py-1 text-xs text-center text-neutral-600 dark:text-neutral-300"
                >
                  {labels[pageIndex]}
                </figcaption>
                <div className="flex-1 min-h-0 min-w-0 flex">
                  <PageImage container={c} paint={paint} waitingRaw={waitingRaw} vertical={vertical} align={align} />
                </div>
              </figure>
            ) : (
              <PageImage container={c} paint={paint} waitingRaw={waitingRaw} vertical={vertical} align={align} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// behavior: continuous — the Canvases are one long strip, in the viewing direction.
function Strip({
  containers,
  paints,
  waitingRaw,
  order,
  selected,
  direction,
  onSelect,
}: {
  containers: ContainerInfo[];
  paints: Array<PagePaint | null>;
  waitingRaw?: boolean;
  order: number[];
  selected: number;
  direction: string;
  onSelect: (index: number) => void;
}) {
  const vertical = direction === 'top-to-bottom' || direction === 'bottom-to-top';
  const reversed = direction === 'right-to-left' || direction === 'bottom-to-top';
  const list = reversed ? [...order].reverse() : order;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected, waitingRaw]);
  return (
    <div
      ref={box}
      data-iiif-strip=""
      className={`flex-1 min-h-0 min-w-0 overflow-auto flex ${vertical ? 'flex-col items-center' : 'flex-row'}`}
    >
      {list.map((i) => (
        <div
          key={containers[i].id}
          data-active={i === selected}
          className={vertical ? 'w-full shrink-0' : 'h-full shrink-0'}
        >
          <PageImage
            container={containers[i]}
            paint={paints[i] ?? null}
            waitingRaw={waitingRaw}
            vertical={vertical}
            inStrip
            lazy
            active={i === selected}
            onClick={() => onSelect(i)}
          />
        </div>
      ))}
    </div>
  );
}

const sameBox = (a: PageBox | undefined, b: PageBox) =>
  !!a && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

// Places image overlays (annotation boxes, content search hits, etc.) over each page of a spread.
// Because a spread does not zoom, matching each page's drawn picture rectangle is enough; the rectangle
// is measured every frame (like RegionHighlight). For object-contain <img> elements, containedBox finds
// the drawn picture inside the letterboxed element; for staged pages the element already has that aspect.
function PageOverlays({
  host,
  pages,
  paints,
}: {
  host: React.RefObject<HTMLDivElement | null>;
  pages: ContainerInfo[];
  paints: Array<PagePaint | null>;
}) {
  const [boxes, setBoxes] = useState<Record<string, PageBox>>({});
  const ids = pages.map((c) => c.id).join('\n');
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const root = host.current;
      if (root) {
        const r = root.getBoundingClientRect();
        const next: Record<string, PageBox> = {};
        for (const id of ids.split('\n')) {
          const el = root.querySelector(`[data-canvas-id="${CSS.escape(id)}"]`);
          const i = el?.getBoundingClientRect();
          if (i && i.width > 0 && i.height > 0) next[id] = { left: i.left - r.left, top: i.top - r.top, width: i.width, height: i.height };
        }
        setBoxes((prev) =>
          Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, b]) => sameBox(prev[k], b))
            ? prev
            : next,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [host, ids]);

  return (
    <>
      {pages.map((c, idx) => {
        const b = boxes[c.id];
        const cw = paints[idx]?.width ?? c.width;
        const ch = paints[idx]?.height ?? c.height;
        if (!b || !cw || !ch) return null;
        return (
          <div
            key={c.id}
            className="absolute pointer-events-none"
            style={containedBox(b, cw, ch)}
            data-page-overlay={c.id}
          >
            <OverlayLayer container={c} canvasWidth={cw} canvasHeight={ch} />
          </div>
        );
      })}
    </>
  );
}

// Draws the region that a content state / table of contents entry points to, over the image.
// The page or stage element is measured every frame, so the box follows zooming and moving.
// Not while the story tab is open: the story zooms to its scenes and draws its own frame only on request.
// The × on the box (or Esc) hides it: highlight becomes false, so the page and the zoom stay where they are.
function RegionHighlight({
  host,
  container,
  paint,
}: {
  host: React.RefObject<HTMLDivElement | null>;
  container: ContainerInfo;
  paint?: PagePaint | null;
}) {
  const t = useTranslations('Structure');
  const [focus, setFocus] = useAtom(focusAtom);
  const storyOpen = useAtomValue(storyOpenAtom);
  const xywh =
    !storyOpen && focus && focus.highlight !== false && focus.target.canvasId === container.id ? focus.target.xywh : undefined;
  const [box, setBox] = useState<PageBox | null>(null);
  const cw = paint?.width ?? container.width;
  const ch = paint?.height ?? container.height;

  useEffect(() => {
    if (!xywh || !cw || !ch) return;
    let frame = 0;
    const tick = () => {
      const root = host.current;
      const el =
        root?.querySelector(`[data-canvas-id="${CSS.escape(container.id)}"]`) ??
        root?.querySelector('[data-iiif-stage]') ??
        root?.querySelector('img');
      if (root && el) {
        const r = root.getBoundingClientRect();
        const i = el.getBoundingClientRect();
        if (i.width > 0 && i.height > 0) {
          // A spread's <img> uses object-contain and may have letterbox margins; place xywh on the drawn picture.
          const picture = containedBox({ left: i.left - r.left, top: i.top - r.top, width: i.width, height: i.height }, cw, ch);
          const next = regionBox(picture, xywh, cw, ch);
          setBox((b) =>
            b && Math.abs(b.left - next.left) < 0.5 && Math.abs(b.top - next.top) < 0.5 && Math.abs(b.width - next.width) < 0.5 && Math.abs(b.height - next.height) < 0.5
              ? b
              : next,
          );
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [xywh, cw, ch, host, container.id]);

  const shown = !!xywh;
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus((f) => (f ? { ...f, highlight: false } : f));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, setFocus]);

  if (!xywh || !box) return null;
  return (
    <div
      data-testid="region-highlight"
      className="absolute pointer-events-none border-2 border-yellow-400 bg-yellow-300/25 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <button
        type="button"
        data-testid="region-highlight-clear"
        aria-label={t('clearRegion')}
        title={t('clearRegion')}
        onClick={() => setFocus((f) => (f ? { ...f, highlight: false } : f))}
        className="pointer-events-auto absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full border border-yellow-500 bg-white text-sm leading-none text-gray-700 shadow hover:bg-yellow-100"
      >
        ×
      </button>
    </div>
  );
}

// Canvas / Timeline: a single page, facing pages (behavior: paged) or a continuous strip
// (behavior: continuous), in the viewing direction of the manifest. Paging itself is in
// ContainerList; this display decides what the selected page looks like.
function PagedDisplay(props: DisplayProps) {
  const { container, manifest, containers, selectedIndex, select } = props;
  const t = useTranslations('Structure');
  const { viewing, order, groups } = usePageOrder(manifest, containers);
  const host = useRef<HTMLDivElement>(null);
  useSeekOnFocus(container);
  const manifestUrl = props.shownUrl ?? props.iiifContent;
  const raw = useRawManifest(manifestUrl);
  const waitingRaw = Boolean(manifestUrl) && raw === undefined;
  const rawSource = waitingRaw ? undefined : (raw ?? manifest);
  const settings = useAtomValue(layerSettingsAtom);
  const orderMap = useAtomValue(layerOrderAtom);
  const setCanvasLayers = useSetAtom(canvasLayersAtom);

  const [compare, setCompare] = useAtom(compareAtom);
  // Leave side-by-side comparison once the reader moves away from its anchor Canvas (for example via the Pages tab).
  useEffect(() => {
    if (compare.length > 0 && compare[0] !== selectedIndex) setCompare([]);
  }, [compare, selectedIndex, setCompare]);

  // 0540: Canvases from different manifests side by side (cleared when moving away from the anchor Canvas).
  const [multi, setMulti] = useAtom(compareMultiAtom);
  useEffect(() => {
    if (multi && multi.anchor !== selectedIndex) setMulti(null);
  }, [multi, selectedIndex, setMulti]);
  const multiOn = !!multi && multi.anchor === selectedIndex;
  const multiItems = multiOn && multi.items.length >= 2 ? multi.items : null;

  // 0540: when a content state points to multiple Canvases, show them side by side in target order while the first is selected.
  const comparing = !!multiItems || (compare.length >= 2 && compare[0] === selectedIndex);
  // When opened on a region (xywh), show only that single page even in a spread so ImageView can zoom into the region;
  // turning the page clears focus and returns to the spread.
  const focus = useAtomValue(focusAtom);
  const focused = !comparing && !!focus?.target.xywh && focus.target.canvasId === container.id;
  const pages = useMemo(() => {
    if (multiItems) return multiItems.map((m) => m.container);
    const group = comparing
      ? compare
      : focused
        ? [selectedIndex]
        : (groups.find((g) => g.includes(selectedIndex)) ?? [selectedIndex]);
    return group.map((i) => containers[i]).filter((c): c is ContainerInfo => !!c);
  }, [multiItems, comparing, compare, focused, groups, selectedIndex, containers]);
  const pagePaints = useMemo(
    () =>
      multiItems
        ? multiItems.map((m) => {
            const mRaw = multi?.raws?.[m.sourceIndex] ?? (m.sourceIndex === 0 ? rawSource : undefined);
            return pagePaintOf(mRaw, m.container, settings, orderMap[m.container.id]);
          })
        : pages.map((c) => pagePaintOf(rawSource, c, settings, orderMap[c.id])),
    [multiItems, multi?.raws, pages, rawSource, settings, orderMap],
  );
  const stripPaints = useMemo(
    () =>
      viewing.mode === 'continuous'
        ? containers.map((c) => pagePaintOf(rawSource, c, settings, orderMap[c.id]))
        : [],
    [viewing.mode, containers, rawSource, settings, orderMap],
  );

  const hasImage = (c: ContainerInfo, p: PagePaint | null) =>
    waitingRaw ? Boolean(imageOf(c)) : Boolean(p && (p.staged || p.plainUrl));

  const allImages = pages.length > 1 && pages.every((c, i) => hasImage(c, pagePaints[i] ?? null));
  const strip =
    !comparing &&
    !focused &&
    viewing.mode === 'continuous' &&
    containers.length > 1 &&
    containers.every((c, i) => hasImage(c, stripPaints[i] ?? null));

  // Populate canvasLayersAtom for the selected Canvas when PagedDisplay renders a spread or strip itself
  // (when delegating to imageCanvasDisplay, ImageBody owns canvasLayersAtom).
  const activeLayerItems = useMemo(() => {
    if (!(strip || allImages) || waitingRaw) return null;
    const s = rawSource ? rawCanvasOf(rawSource, container.id) : undefined;
    if (!s || s.type === 'Scene') return [];
    return layerItemsOf(canvasImagesOf(s).paintings.filter(paintsImage));
  }, [strip, allImages, waitingRaw, rawSource, container.id]);
  useEffect(() => {
    if (activeLayerItems !== null) {
      setCanvasLayers({ canvasId: container.id, items: activeLayerItems });
    }
  }, [container.id, activeLayerItems, setCanvasLayers]);

  const activePaint = strip ? (stripPaints[selectedIndex] ?? null) : (pagePaints[pages.indexOf(container)] ?? null);

  let body: React.ReactNode;
  if (strip) {
    body = (
      <Strip
        containers={containers}
        paints={stripPaints}
        waitingRaw={waitingRaw}
        order={order}
        selected={selectedIndex}
        direction={viewing.direction}
        onSelect={select}
      />
    );
  } else if (allImages) {
    body = (
      <Spread
        pages={pages}
        paints={pagePaints}
        waitingRaw={waitingRaw}
        direction={comparing ? 'left-to-right' : viewing.direction}
        labels={multiItems ? multiItems.map((m) => m.manifestLabel) : undefined}
      />
    );
  } else {
    // Single page: deep zoom, layers and non-image fallbacks go through imageCanvasDisplay.
    body = <imageCanvasDisplay.Component {...props} />;
  }

  return (
    <div ref={host} className="relative flex-1 min-h-0 min-w-0 flex flex-col">
      {multiOn && multi.failed.length > 0 && (
        <p
          role="status"
          data-testid="compare-failed"
          className="shrink-0 m-0 px-3 py-1 text-xs bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        >
          {t('compareFailed', { urls: multi.failed.join(', ') })}
        </p>
      )}
      {body}
      {(strip || allImages) && <AuthPrompt />}
      {/* Spread overlays (omitted when comparing Canvases from different manifests, since annotations belong to the open manifest). */}
      {!strip && allImages && !multiItems ? <PageOverlays host={host} pages={pages} paints={pagePaints} /> : null}
      <RegionHighlight host={host} container={container} paint={activePaint} />
    </div>
  );
}

export const pagedDisplay: Display = {
  id: 'paged',
  // every Canvas / Timeline that FlatDisplay can show goes through here
  match: (c) => c.kind !== 'Scene' && flatDisplay.match(c),
  Component: PagedDisplay,
};
