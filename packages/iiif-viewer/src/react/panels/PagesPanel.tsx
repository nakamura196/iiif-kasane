'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { containersOf, labelIn, pageMediaOf, pageThumbnailUrl, type MediaKind } from '../../core';
import { manifestAtom } from '../atoms';
import { navRequestAtom, nextSeq, usePageOrder } from '../displays/structureState';
import { useLocale, useTranslations } from '../env';
import { readingPageAtom } from '../inference/batch';
import { PageThumbMarks, PagesBatchBar, PagesReadingStyle } from './PagesBatch';
import type { Panel, PanelContext } from './types';

// The viewer remembers the chosen layout per browser (a convenience only; it works without storage).
const LAYOUT_KEY = 'iiif3d.pagesLayout';
type Layout = 'list' | 'grid';

function readLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

// In place of a missing thumbnail: an icon for the kind of media the page shows (outline, 24px grid).
const MEDIA_ICONS: Record<MediaKind | 'empty', ReactNode> = {
  Model: (
    <>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
      <path d="M3.5 7 12 11.5 20.5 7M12 11.5v10" />
    </>
  ),
  Image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="m3.5 18 5.5-5.5 4 4 2.5-2.5 5 5" />
    </>
  ),
  Video: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 9v6l5-3z" />
    </>
  ),
  Audio: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  empty: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" strokeDasharray="3 2.5" />
      <path d="m4 4 16 16" />
    </>
  ),
};

function MediaIcon({ kind, label, size }: { kind: MediaKind | 'empty'; label: string; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-400 dark:text-gray-500"
    >
      <title>{label}</title>
      {MEDIA_ICONS[kind]}
    </svg>
  );
}

const MEDIA_LABEL_KEYS = {
  Model: 'mediaModel',
  Image: 'mediaImage',
  Video: 'mediaVideo',
  Audio: 'mediaAudio',
  empty: 'noImage',
} as const;

// The list of pages (Canvases / Scenes), down the right panel like Mirador's index. As a grid it fits as many
// columns as the panel is wide (a wider panel shows more pages at once). Choosing a page sends the same request as
// the table of contents, and ContainerList moves to that page.
/** The nearest ancestor that scrolls (null when the page itself scrolls). */
const scrollBoxOf = (el: HTMLElement): HTMLElement | null => {
  for (let box = el.parentElement; box && box !== document.body && box !== document.documentElement; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight) return box;
  }
  return null;
};

/** Is part of the element in view in its scroll box, below the sticky band? */
const inView = (el: HTMLElement, band: HTMLElement | null): boolean => {
  const box = scrollBoxOf(el)?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const top = Math.max(box.top, band?.getBoundingClientRect().bottom ?? box.top);
  const r = el.getBoundingClientRect();
  return r.bottom > top && r.top < box.bottom;
};

function PagesView({ container, manifest }: PanelContext) {
  const t = useTranslations('Structure');
  const locale = useLocale();
  const fromAtom = useAtomValue(manifestAtom);
  const m = manifest ?? fromAtom;
  const setRequest = useSetAtom(navRequestAtom);
  const containers = useMemo(() => containersOf(m), [m]);
  const { order } = usePageOrder(m, containers);
  const pages = useMemo(() => order.map((i) => containers[i]).filter((c) => !!c), [order, containers]);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLOListElement>(null);
  const [layout, setLayoutState] = useState<Layout>('list');
  useEffect(() => setLayoutState(readLayout()), []);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* storage blocked: keep the choice for this visit only */
    }
  };
  const grid = layout === 'grid';
  const reading = useAtomValue(readingPageAtom);
  // The sticky band over the list: scrolling a page into view leaves room for it
  const head = useRef<HTMLDivElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  useEffect(() => {
    const el = head.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeadHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rawItems = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const c of m?.items ?? []) map.set((c as { id: string }).id, c);
    return map;
  }, [m]);

  // Keep the page being shown in view
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [container?.id, layout]);

  // During a run over every page, keep the page being read in view, so the reading can be followed (and filmed).
  // Scrolling by hand (wheel, touch, keys) stops the following, so someone looking at other pages stays there; it
  // starts again when they come back to where the reading is.
  const following = useRef(true);
  const readBefore = useRef<HTMLElement | null>(null);
  const running = !!reading;
  useEffect(() => {
    if (!grid || !running || !list.current) return;
    const box: HTMLElement | Window = scrollBoxOf(list.current) ?? window;
    const stop = () => {
      following.current = false;
    };
    box.addEventListener('wheel', stop, { passive: true });
    box.addEventListener('touchmove', stop, { passive: true });
    box.addEventListener('keydown', stop);
    return () => {
      box.removeEventListener('wheel', stop);
      box.removeEventListener('touchmove', stop);
      box.removeEventListener('keydown', stop);
    };
  }, [grid, running]);
  useEffect(() => {
    if (!grid || !reading) {
      following.current = true;
      readBefore.current = null;
      return;
    }
    const el = list.current?.querySelector<HTMLElement>('[data-reading="true"]') ?? null;
    const before = readBefore.current;
    if (!following.current && before?.isConnected && inView(before, head.current)) following.current = true;
    if (following.current) el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    readBefore.current = el;
  }, [grid, reading]);

  const toggle = (value: Layout, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setLayout(value)}
      aria-pressed={layout === value}
      title={label}
      className={`grid place-items-center w-7 h-7 rounded ${
        layout === value
          ? 'bg-[var(--ds-surface-2)] text-[var(--ds-fg)] ring-1 ring-[var(--ds-border)]'
          : 'text-[var(--ds-fg)] opacity-60 hover:opacity-100 hover:bg-[var(--ds-surface-2)]'
      }`}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );

  return (
    <div>
      {/* The layout switch and the run controls stay at the top while the pages scroll (the progress stays in view) */}
      <div ref={head} className="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-1">
        <div role="group" aria-label={t('pagesLayout')} className="flex justify-end gap-1 px-2 pt-2">
          {toggle(
            'list',
            t('pagesList'),
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
              <rect x="1" y="2" width="4" height="3" rx="0.5" />
              <rect x="6.5" y="3" width="8.5" height="1" />
              <rect x="1" y="6.5" width="4" height="3" rx="0.5" />
              <rect x="6.5" y="7.5" width="8.5" height="1" />
              <rect x="1" y="11" width="4" height="3" rx="0.5" />
              <rect x="6.5" y="12" width="8.5" height="1" />
            </svg>,
          )}
          {toggle(
            'grid',
            t('pagesGrid'),
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="0.5" />
              <rect x="9" y="1" width="6" height="6" rx="0.5" />
              <rect x="1" y="9" width="6" height="6" rx="0.5" />
              <rect x="9" y="9" width="6" height="6" rx="0.5" />
            </svg>,
          )}
        </div>
        {grid ? <PagesReadingStyle /> : null}
        {grid ? <PagesBatchBar pages={pages} manifest={m} /> : null}
      </div>
      <ol
        ref={list}
        className={grid ? 'p-2 grid gap-2' : 'p-2 space-y-1'}
        style={grid ? { gridTemplateColumns: 'repeat(auto-fill, minmax(6.5rem, 1fr))' } : undefined}
        aria-label={t('pages')}
      >
        {order.map((i) => {
          const c = containers[i];
          if (!c) return null;
          const label = labelIn(c.label, locale) || t('pageLabel', { index: i + 1 });
          const thumb = pageThumbnailUrl(c, rawItems.get(c.id), grid ? 240 : 160);
          const active = c.id === container?.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setRequest({ seq: nextSeq(), target: { canvasId: c.id } })}
                aria-current={active ? 'true' : undefined}
                data-reading={grid && c.id === reading ? 'true' : undefined}
                style={headHeight ? { scrollMarginTop: headHeight } : undefined}
                title={grid ? label : undefined}
                className={`w-full ${grid ? 'flex flex-col gap-1 p-1' : 'flex items-center gap-3 p-2'} rounded text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                    : 'text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
                }`}
              >
                <span
                  className={`${grid ? 'w-full aspect-[4/3]' : 'shrink-0 w-20 h-16'} relative grid place-items-center rounded bg-gray-100 dark:bg-gray-800 overflow-hidden`}
                >
                  {thumb && !broken[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-contain p-1"
                      onError={() => setBroken((b) => ({ ...b, [c.id]: true }))}
                    />
                  ) : (
                    (() => {
                      const media = pageMediaOf(c);
                      return <MediaIcon kind={media} label={t(MEDIA_LABEL_KEYS[media])} size={grid ? 40 : 28} />;
                    })()
                  )}
                  {grid && thumb && !broken[c.id] ? <PageThumbMarks page={c} /> : null}
                </span>
                {grid ? (
                  <span className="min-w-0 flex gap-1 text-xs">
                    <span className="tabular-nums opacity-70">{i + 1}</span>
                    {label !== t('pageLabel', { index: i + 1 }) && label !== String(i + 1) && <span className="truncate">{label}</span>}
                  </span>
                ) : (
                  <span className="min-w-0">
                    <span className="block text-xs tabular-nums opacity-70">{i + 1}</span>
                    <span className="block break-words">{label}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const pagesPanel: Panel = {
  id: 'pages',

  order: 20,
  // Only for manifests with two pages or more (a Collection is listed by another display)
  available: ({ manifest }) =>
    (manifest as { type?: string } | null | undefined)?.type !== 'Collection' && containersOf(manifest).length >= 2,
  Component: (ctx) => <PagesView {...ctx} />,
};
