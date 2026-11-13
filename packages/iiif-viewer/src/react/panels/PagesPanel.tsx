'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { containersOf, labelIn, pagePlaceholderOf, pageThumbnailUrl } from '../../core';
import { manifestAtom } from '../atoms';
import { navRequestAtom, nextSeq, usePageOrder } from '../displays/structureState';
import { useLocale, useTranslations } from '../env';
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

// ページ（Canvas / Scene）の一覧。Mirador の「索引」と同じく、右パネルに縦に並べる。
// グリッドに切り替えると、パネルの幅に入るだけ列を並べる（パネルを広げると一度に見えるページが増える）。
// 選ぶと目次と同じ依頼を出し、ContainerList がページを移す。
function PagesView({ container, manifest }: PanelContext) {
  const t = useTranslations('Structure');
  const locale = useLocale();
  const fromAtom = useAtomValue(manifestAtom);
  const m = manifest ?? fromAtom;
  const setRequest = useSetAtom(navRequestAtom);
  const containers = useMemo(() => containersOf(m), [m]);
  const { order } = usePageOrder(m, containers);
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

  const rawItems = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const c of m?.items ?? []) map.set((c as { id: string }).id, c);
    return map;
  }, [m]);

  // 表示中のページが見えるように送る
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [container?.id, layout]);

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
                title={grid ? label : undefined}
                className={`w-full ${grid ? 'flex flex-col gap-1 p-1' : 'flex items-center gap-3 p-2'} rounded text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                    : 'text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
                }`}
              >
                <span
                  className={`${grid ? 'w-full aspect-[4/3]' : 'shrink-0 w-20 h-16'} grid place-items-center rounded bg-gray-100 dark:bg-gray-800 overflow-hidden`}
                >
                  {thumb && !broken[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="max-w-full max-h-full object-contain"
                      onError={() => setBroken((b) => ({ ...b, [c.id]: true }))}
                    />
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{pagePlaceholderOf(c) === 'empty' ? t('noImage') : c.kind}</span>
                  )}
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
  // 2 ページ以上あるマニフェストだけ（コレクションは別の表示で一覧を出す）
  available: ({ manifest }) =>
    (manifest as { type?: string } | null | undefined)?.type !== 'Collection' && containersOf(manifest).length >= 2,
  Component: (ctx) => <PagesView {...ctx} />,
};
