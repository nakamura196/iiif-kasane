'use client';

import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { ContainerInfo } from '../../core';
import { labelIn } from '../../core';
import { useLocale, useTranslations } from '../env';
import { usePlayback } from '../playback';
import { flatDisplay } from './FlatDisplay';
import { imageCanvasDisplay } from './ImageCanvasDisplay';
import { OverlayLayer } from './ImageView';
import { storyOpenAtom } from '../overlays/storyState';
import { compareAtom, compareMultiAtom, focusAtom, usePageOrder } from './structureState';
import { containedBox, regionBox, type PageBox } from './pageBox';
import type { Display, DisplayProps } from './types';

const imageOf = (c: ContainerInfo | undefined): { url: string } | null => {
  const o = c?.painting.flatMap((p) => p.options).find((x) => x.kind === 'Image');
  return o ? { url: o.url } : null;
};

// A page image in a spread or a continuous strip.
function PageImage({
  container,
  align,
  vertical,
  active,
  onClick,
}: {
  container: ContainerInfo;
  align?: 'left' | 'right';
  vertical?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const locale = useLocale();
  const img = imageOf(container);
  if (!img) return null;
  const ratio = container.width && container.height ? `${container.width} / ${container.height}` : undefined;
  const base = vertical ? 'w-full h-auto' : 'h-full w-auto';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img.url}
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
  direction,
  labels,
}: {
  pages: ContainerInfo[];
  direction: string;
  labels?: string[];
}) {
  const vertical = direction === 'top-to-bottom' || direction === 'bottom-to-top';
  const reversed = direction === 'right-to-left' || direction === 'bottom-to-top';
  const shown = reversed ? [...pages].reverse() : pages;
  return (
    <div
      className={`flex-1 min-h-0 min-w-0 flex ${vertical ? 'flex-col' : 'flex-row'} items-stretch justify-center overflow-hidden`}
    >
      {shown.map((c, i) => (
        <div key={c.id} className="flex-1 min-h-0 min-w-0 flex">
          {labels ? (
            <figure className="flex-1 min-h-0 min-w-0 flex flex-col m-0">
              <figcaption
                data-testid="compare-label"
                className="shrink-0 truncate px-2 py-1 text-xs text-center text-neutral-600 dark:text-neutral-300"
              >
                {labels[pages.indexOf(c)]}
              </figcaption>
              <div className="flex-1 min-h-0 min-w-0 flex">
                <PageImage container={c} vertical={vertical} align={vertical ? undefined : i === 0 ? 'left' : 'right'} />
              </div>
            </figure>
          ) : (
            <PageImage container={c} vertical={vertical} align={vertical ? undefined : i === 0 ? 'left' : 'right'} />
          )}
        </div>
      ))}
    </div>
  );
}

// behavior: continuous — the Canvases are one long strip, in the viewing direction.
function Strip({
  containers,
  order,
  selected,
  direction,
  onSelect,
}: {
  containers: ContainerInfo[];
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
  }, [selected]);
  return (
    <div
      ref={box}
      className={`flex-1 min-h-0 min-w-0 overflow-auto flex ${vertical ? 'flex-col items-center' : 'flex-row'}`}
    >
      {list.map((i) => (
        <div
          key={containers[i].id}
          data-active={i === selected}
          className={vertical ? 'w-full shrink-0' : 'h-full shrink-0'}
        >
          <PageImage container={containers[i]} vertical={vertical} active={i === selected} onClick={() => onSelect(i)} />
        </div>
      ))}
    </div>
  );
}

const sameBox = (a: PageBox | undefined, b: PageBox) =>
  !!a && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

// 見開きの各ページにも、画像に重ねる表示（OVERLAYS: 注釈の枠、文字の検索の当たりなど）を載せる。
// 見開きは拡大しないので、層をページの画像の矩形に合わせるだけでよい。矩形は毎フレーム測る（RegionHighlight と同じ）。
// 画像は object-contain なので、要素の矩形ではなく、その中で絵が描かれた矩形に合わせる。
function PageOverlays({ host, pages }: { host: React.RefObject<HTMLDivElement | null>; pages: ContainerInfo[] }) {
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
          const img = root.querySelector(`img[data-canvas-id="${CSS.escape(id)}"]`);
          const i = img?.getBoundingClientRect();
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
      {pages.map((c) => {
        const b = boxes[c.id];
        if (!b || !c.width || !c.height) return null;
        return (
          <div
            key={c.id}
            className="absolute pointer-events-none"
            style={containedBox(b, c.width, c.height)}
            data-page-overlay={c.id}
          >
            <OverlayLayer container={c} canvasWidth={c.width} canvasHeight={c.height} />
          </div>
        );
      })}
    </>
  );
}

// Draws the region that a content state / table of contents entry points to, over the image.
// The image element is measured every frame, so the box follows zooming and moving.
// Not while the story tab is open: the story zooms to its scenes and draws its own frame only on request.
// The × on the box (or Esc) hides it: highlight becomes false, so the page and the zoom stay where they are.
function RegionHighlight({ host, container }: { host: React.RefObject<HTMLDivElement | null>; container: ContainerInfo }) {
  const t = useTranslations('Structure');
  const [focus, setFocus] = useAtom(focusAtom);
  const storyOpen = useAtomValue(storyOpenAtom);
  const xywh =
    !storyOpen && focus && focus.highlight !== false && focus.target.canvasId === container.id ? focus.target.xywh : undefined;
  const [box, setBox] = useState<PageBox | null>(null);
  const cw = container.width;
  const ch = container.height;

  useEffect(() => {
    if (!xywh || !cw || !ch) return;
    let frame = 0;
    const tick = () => {
      const root = host.current;
      const img =
        root?.querySelector(`img[data-canvas-id="${CSS.escape(container.id)}"]`) ?? root?.querySelector('img');
      if (root && img) {
        const r = root.getBoundingClientRect();
        const i = img.getBoundingClientRect();
        if (i.width > 0 && i.height > 0) {
          // 見開きの <img> は object-contain で、要素の中に余白がある。絵の矩形に対して置く
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

// Seeks to the time that a content state / table of contents entry points to, once the
// media element of the Canvas exists.
function useSeekOnFocus(container: ContainerInfo) {
  const focus = useAtomValue(focusAtom);
  const { seek, mediaRef } = usePlayback();
  const done = useRef(0);
  const time = focus && focus.target.canvasId === container.id ? focus.target.t?.[0] : undefined;
  const seq = focus?.seq ?? 0;
  useEffect(() => {
    if (time === undefined || done.current === seq) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (mediaRef.current || tries > 30) {
        window.clearInterval(timer);
        done.current = seq;
        seek(time);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [time, seq, seek, mediaRef]);
}

// Canvas / Timeline: a single page, facing pages (behavior: paged) or a continuous strip
// (behavior: continuous), in the viewing direction of the manifest. Paging itself is in
// ContainerList; this display decides what the selected page looks like.
function PagedDisplay(props: DisplayProps) {
  const { container, manifest, containers, selectedIndex, select } = props;
  const { viewing, order, groups } = usePageOrder(manifest, containers);
  const host = useRef<HTMLDivElement>(null);
  useSeekOnFocus(container);
  const [compare, setCompare] = useAtom(compareAtom);
  // ページ一覧など go を通らない移動で先頭から離れたら、並べた表示をやめる（戻っても再び並べない）
  useEffect(() => {
    if (compare.length > 0 && compare[0] !== selectedIndex) setCompare([]);
  }, [compare, selectedIndex, setCompare]);

  // 0540: 別々のマニフェストの Canvas を並べる（開いているマニフェストの Canvas から離れたら解除）
  const [multi, setMulti] = useAtom(compareMultiAtom);
  useEffect(() => {
    if (multi && multi.anchor !== selectedIndex) setMulti(null);
  }, [multi, selectedIndex, setMulti]);
  const locale = useLocale();
  const multiOn = !!multi && multi.anchor === selectedIndex;
  const multiItems = multiOn && multi.items.length >= 2 ? multi.items : null;

  // 0540: content state が複数の Canvas を指しているときは、指された順に並べる（先頭が選択中のとき）
  const comparing = !!multiItems || (compare.length >= 2 && compare[0] === selectedIndex);
  // 範囲（xywh）を指して開いたときは、見開きでもそのページだけを出して範囲へ寄せる（見開きは拡大できないため）。
  // ページを送ると focus が消えるので、見開きに戻る
  const focus = useAtomValue(focusAtom);
  const focused = !comparing && !!focus?.target.xywh && focus.target.canvasId === container.id;
  const group = comparing
    ? compare
    : focused
      ? [selectedIndex]
      : (groups.find((g) => g.includes(selectedIndex)) ?? [selectedIndex]);
  const pages = multiItems
    ? multiItems.map((m) => m.container)
    : group.map((i) => containers[i]).filter((c): c is ContainerInfo => !!c);
  const allImages = pages.length > 1 && pages.every((c) => !!imageOf(c));

  const strip = !comparing && !focused && viewing.mode === 'continuous' && containers.length > 1 && containers.every((c) => !!imageOf(c));
  let body: React.ReactNode;
  if (strip) {
    body = (
      <Strip
        containers={containers}
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
        direction={comparing ? 'left-to-right' : viewing.direction}
        labels={multiItems ? multiItems.map((m) => m.manifestLabel) : undefined}
      />
    );
  } else {
    // 1 ページだけのとき: 画像の深いズーム・重ね表示などは imageCanvas、画像以外はそこから次の表示へ
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
          {locale === 'ja'
            ? `読み込めなかったマニフェストがあります（残りを表示しています）: ${multi.failed.join(', ')}`
            : `Some manifests could not be loaded (showing the rest): ${multi.failed.join(', ')}`}
        </p>
      )}
      {body}
      {/* 見開き（別々のマニフェストを並べたときは除く。注釈はそのマニフェストのものではないため） */}
      {!strip && allImages && !multiItems ? <PageOverlays host={host} pages={pages} /> : null}
      <RegionHighlight host={host} container={container} />
    </div>
  );
}

export const pagedDisplay: Display = {
  id: 'paged',
  // every Canvas / Timeline that FlatDisplay can show goes through here
  match: (c) => c.kind !== 'Scene' && flatDisplay.match(c),
  Component: PagedDisplay,
};
