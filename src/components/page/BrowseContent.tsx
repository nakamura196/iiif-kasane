'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';
import Header from '@/components/Header';
import { Link } from '@/i18n/routing';
import { Browse3D, DEFAULT_SETTINGS, type BrowseSettings } from '@/components/browse/engine';
import { defaultBrowseSource } from '@/components/browse/defaultSource';
import { fillThumbnails, loadBrowseSource } from '@/components/browse/loadSource';
import {
  BROWSE_LAYOUTS,
  BROWSE_LIMITS,
  DEFAULT_BROWSE_LIMIT,
  browseQuery,
  compareQuery,
  largeImageUrl,
  readBrowseParams,
  viewerQuery,
  type BrowseItem,
  type BrowseLayout,
} from '@/lib/browse';
import '@/components/browse/browse.css';

// 3D で一覧する。Collection の Manifest・Manifest の Canvas を、サムネイルのカードにして 3D の空間に並べる。
// （元: nakamura196/iiif-3d-gallery。作りは components/browse/README.md）
// 状態は React の useState。Keep した作品は、資料ごとに localStorage に覚える。

const BTN =
  'px-2.5 py-1.5 rounded text-sm transition-colors disabled:opacity-40 bg-[var(--ds-surface-2)] text-[var(--ds-fg)] hover:bg-[var(--ds-border)]';
const BTN_ON = 'px-2.5 py-1.5 rounded text-sm transition-colors bg-blue-600 text-white';
const FIELD = 'w-full rounded border border-[var(--ds-border)] bg-transparent px-2 py-1.5 text-sm';

const SPACINGS = {
  compact: { x: 100, y: 140 },
  standard: { x: 160, y: 200 },
  wide: { x: 200, y: 240 },
} as const;
type SpacingMode = keyof typeof SPACINGS | 'custom';

const keepKey = (url: string) => `browse-keep:${url}`;
function readKeep(url: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(keepKey(url)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const BrowseContent = () => {
  const t = useTranslations('Browse');
  const locale = useLocale();
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Browse3D | null>(null);
  // 空間のクリックから、いまのカードの id を引くための控え
  const engineItems = useRef<BrowseItem[]>([]);

  const [url, setUrl] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_BROWSE_LIMIT);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorKind, setErrorKind] = useState<'unreadable' | 'empty'>('unreadable');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [layout, setLayout] = useState<BrowseLayout>('table');
  const [selected, setSelected] = useState(-1);
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const [billboard, setBillboard] = useState(false);
  const [dragMove, setDragMove] = useState(false);
  const [settings, setSettings] = useState<BrowseSettings>(DEFAULT_SETTINGS);
  const [spacingMode, setSpacingMode] = useState<SpacingMode>('standard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [lightbox, setLightbox] = useState(-1);
  const [urlDraft, setUrlDraft] = useState('');

  // 開いたとき URL の引数を読む（manifest・iiif-content・curation・u のどれでも）
  useEffect(() => {
    const p = readBrowseParams(new URLSearchParams(window.location.search), manifestFromParams);
    setUrl(p.url);
    setUrlDraft(p.url ?? '');
    if (p.layout) setLayout(p.layout);
    if (p.limit) setLimit(Math.min(p.limit, 500));
    setReady(true);
  }, []);

  // 3D の空間は 1 つ作って使い回す
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const engine = new Browse3D(el, {
      onSelect: (i) => setSelected(i),
      onToggleKeep: (i) => setKeptIds((ids) => toggleId(engineItems.current[i]?.id, ids)),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);
  useEffect(() => {
    engineItems.current = items;
  }, [items]);

  // 資料を読む。サムネイルを持たない Manifest は、読めたものから順に補う
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    setStatus('loading');
    setSelected(-1);
    setLightbox(-1);
    // URL が無いときは、サイト内の見本（ユースケース）を並べる
    const loading = url
      ? loadBrowseSource(url, locale, limit)
      : Promise.resolve(defaultBrowseSource(locale as 'ja' | 'en')).then((s) => ({
          ...s,
          items: s.items.slice(0, limit),
        }));
    loading
      .then((source) => {
        if (ac.signal.aborted) return;
        setTitle(source.title || t('defaultTitle'));
        setItems(source.items);
        engineItems.current = source.items;
        setKeptIds(readKeep(url ?? 'default'));
        engineRef.current?.setItems(source.items);
        setStatus('ready');
        const missing = source.items.flatMap((it, index) =>
          it.thumbnail || it.canvasIndex !== null ? [] : [{ index, manifestUrl: it.manifestUrl }]
        );
        return fillThumbnails(
          missing,
          (index, thumb) => {
            engineRef.current?.setThumbnail(index, thumb);
            setItems((cur) => cur.map((it, i) => (i === index ? { ...it, thumbnail: thumb } : it)));
          },
          ac.signal
        );
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setErrorKind(e.message === 'empty' ? 'empty' : 'unreadable');
        setItems([]);
        engineRef.current?.setItems([]);
        setStatus('error');
      });
    return () => ac.abort();
  }, [ready, url, locale, limit, t]);

  // 状態を空間に反映する
  useEffect(() => {
    engineRef.current?.setLayout(layout);
  }, [layout]);
  useEffect(() => {
    if (selected >= 0) engineRef.current?.focusItem(selected);
    else engineRef.current?.clearSelection();
  }, [selected]);
  useEffect(() => engineRef.current?.setBillboard(billboard), [billboard]);
  useEffect(() => engineRef.current?.setDragEnabled(dragMove), [dragMove]);
  useEffect(() => engineRef.current?.updateSettings(settings), [settings]);
  const keptIndexes = useMemo(() => {
    const s = new Set(keptIds);
    return items.flatMap((it, i) => (s.has(it.id) ? [i] : []));
  }, [items, keptIds]);
  useEffect(() => {
    engineRef.current?.setKept(new Set(keptIndexes));
  }, [keptIndexes]);
  useEffect(() => {
    if (status !== 'ready') return;
    try {
      localStorage.setItem(keepKey(url ?? 'default'), JSON.stringify(keptIds));
    } catch {
      // 覚えられなくても、そのときだけ使える
    }
  }, [keptIds, url, status]);

  // 資料と並べ方を URL に書く（共有・再読み込みでそのまま開く）
  useEffect(() => {
    if (!ready || !url) return;
    const q = browseQuery(url, {
      layout,
      limit: limit !== DEFAULT_BROWSE_LIMIT ? limit : undefined,
    });
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [ready, url, layout, limit]);

  // Esc で拡大表示・選択を閉じる。← → で前後の作品
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (lightbox >= 0) setLightbox(-1);
        else setSelected(-1);
      } else if (e.key === 'ArrowRight') setSelected((s) => Math.min(s + 1, items.length - 1));
      else if (e.key === 'ArrowLeft') setSelected((s) => (s > 0 ? s - 1 : s));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, items.length]);

  // 並べ方を変えると、空間は選択を外す。選択の状態もそろえる
  const changeLayout = (l: BrowseLayout) => {
    setLayout(l);
    setSelected(-1);
  };
  const toggleKeep = useCallback(
    (i: number) => setKeptIds((ids) => toggleId(items[i]?.id, ids)),
    [items]
  );
  const patchSettings = (p: Partial<BrowseSettings>) => setSettings((s) => ({ ...s, ...p }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.flatMap((item, index) =>
      !q || item.label.toLowerCase().includes(q) ? [{ item, index }] : []
    );
  }, [items, query]);

  const current = selected >= 0 ? items[selected] : null;
  const kept = keptIndexes.map((i) => items[i]);
  const compare = compareQuery(kept);

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const u = urlDraft.trim();
    if (/^https?:\/\//i.test(u)) setUrl(u);
  };

  return (
    <div className="flex flex-col h-dvh">
      <Header compact />
      <main className="flex-1 relative overflow-hidden bg-[var(--ds-bg)] text-[var(--ds-fg)]">
        <div className="absolute inset-0 lg:right-80 flex flex-col">
          <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--ds-border)] px-3 py-1.5">
            <div className="min-w-0 flex items-baseline gap-2">
              <h2
                className="text-sm font-semibold truncate"
                style={{ fontFamily: 'var(--ds-font-serif)' }}
                title={title}
              >
                {title || t('untitled')}
              </h2>
              <span className="shrink-0 text-xs text-[var(--ds-fg-muted)]">
                {query
                  ? t('countFiltered', { shown: filtered.length, total: items.length })
                  : t('count', { count: items.length })}
              </span>
            </div>
            <button
              className={`${BTN} lg:hidden shrink-0`}
              onClick={() => setListOpen(true)}
              aria-expanded={listOpen}
            >
              {t('list')}
            </button>
          </div>
          <div className="relative flex-1 min-h-0">
            <div ref={stageRef} className="bw-stage absolute inset-0" aria-label={t('stage')} />

            {status !== 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center pointer-events-none">
                <p
                  role="status"
                  className="rounded bg-[var(--ds-surface)] border border-[var(--ds-border)] px-4 py-3 text-sm"
                >
                  {status === 'loading'
                    ? t('loading')
                    : t(errorKind === 'empty' ? 'empty' : 'unreadable')}
                </p>
              </div>
            )}
          </div>

          {/* 下の操作帯 */}
          <div className="shrink-0 border-t border-[var(--ds-border)] bg-[var(--ds-bg)]/95 backdrop-blur px-2 py-2 space-y-2">
            <div
              className="flex flex-wrap items-center justify-center gap-1.5"
              role="radiogroup"
              aria-label={t('layout')}
            >
              {BROWSE_LAYOUTS.map((l) => (
                <button
                  key={l}
                  role="radio"
                  aria-checked={layout === l}
                  onClick={() => changeLayout(l)}
                  className={layout === l ? BTN_ON : BTN}
                >
                  {t(`layouts.${l}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                className={BTN}
                disabled={selected <= 0}
                onClick={() => setSelected((s) => s - 1)}
                aria-label={t('prev')}
              >
                ‹
              </button>
              <button
                className={BTN}
                disabled={selected >= items.length - 1}
                onClick={() => setSelected((s) => s + 1)}
                aria-label={t('next')}
              >
                ›
              </button>
              <button
                className={billboard ? BTN_ON : BTN}
                aria-pressed={billboard}
                onClick={() => setBillboard((b) => !b)}
                title={t('billboardHint')}
              >
                {t('billboard')}
              </button>
              <button className={BTN} onClick={() => engineRef.current?.resetView()}>
                {t('resetView')}
              </button>
              <button
                className={settingsOpen ? BTN_ON : BTN}
                aria-expanded={settingsOpen}
                onClick={() => {
                  setSettingsOpen((o) => !o);
                  setListOpen(true);
                }}
              >
                {t('settings')}
              </button>
            </div>
          </div>
        </div>

        {/* 右のサイドバー（狭い画面では、一覧ボタンで重ねて出す） */}
        <aside
          className={`${listOpen ? 'flex' : 'hidden'} lg:flex absolute top-0 bottom-0 right-0 w-full sm:w-80 flex-col border-l border-[var(--ds-border)] bg-[var(--ds-bg)] shadow-xl z-10`}
          aria-label={t('sidebar')}
        >
          <div className="p-3 border-b border-[var(--ds-border)] space-y-2">
            <div className="flex items-center justify-between gap-2 lg:hidden">
              <span className="text-sm font-medium">{t('list')}</span>
              <button
                className={`${BTN} shrink-0`}
                onClick={() => setListOpen(false)}
                aria-label={t('close')}
              >
                ×
              </button>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className={FIELD}
            />
            <form onSubmit={submitUrl} className="flex gap-1.5">
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder={t('urlPlaceholder')}
                aria-label={t('urlLabel')}
                className={FIELD}
              />
              <button type="submit" className={`${BTN} shrink-0`}>
                {t('open')}
              </button>
            </form>
          </div>

          {settingsOpen && (
            <div className="p-3 border-b border-[var(--ds-border)] space-y-3 text-sm overflow-y-auto max-h-[45%]">
              <div
                role="radiogroup"
                aria-label={t('displayMode')}
                className="flex rounded overflow-hidden border border-[var(--ds-border)]"
              >
                {(['2d', '3d'] as const).map((m) => {
                  const on = (m === '2d') === (layout === 'flat');
                  return (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={on}
                      onClick={() =>
                        changeLayout(m === '2d' ? 'flat' : layout === 'flat' ? 'table' : layout)
                      }
                      className={`flex-1 px-3 py-1.5 ${on ? 'bg-blue-600 text-white' : 'hover:bg-[var(--ds-surface-2)]'}`}
                    >
                      {m === '2d' ? '2D' : '3D'}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={billboard}
                  onChange={(e) => setBillboard(e.target.checked)}
                />
                {t('billboardHint')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.gridForwardFacing}
                  onChange={(e) => patchSettings({ gridForwardFacing: e.target.checked })}
                />
                {t('gridFront')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={dragMove}
                  onChange={(e) => setDragMove(e.target.checked)}
                />
                {t('dragMove')}
              </label>
              <label className="block">
                <span className="block mb-1">{t('spacing')}</span>
                <select
                  className={FIELD}
                  value={spacingMode}
                  onChange={(e) => {
                    const m = e.target.value as SpacingMode;
                    setSpacingMode(m);
                    if (m !== 'custom') patchSettings({ spacing: { ...SPACINGS[m] } });
                  }}
                >
                  {(['compact', 'standard', 'wide'] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`spacings.${m}`)}
                    </option>
                  ))}
                  <option value="custom">{t('spacings.custom')}</option>
                </select>
              </label>
              <label className="block">
                <span className="block mb-1">{t('spacingType')}</span>
                <select
                  className={FIELD}
                  value={settings.spacingType}
                  onChange={(e) =>
                    patchSettings({ spacingType: e.target.value as BrowseSettings['spacingType'] })
                  }
                >
                  {(['absolute', 'relative', 'equal'] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`spacingTypes.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis} className="block">
                  <span className="block mb-1">
                    {t(axis === 'x' ? 'spacingX' : 'spacingY', { value: settings.spacing[axis] })}
                  </span>
                  <input
                    type="range"
                    className="w-full"
                    min={axis === 'x' ? 80 : 100}
                    max={axis === 'x' ? 300 : 400}
                    value={settings.spacing[axis]}
                    onChange={(e) => {
                      setSpacingMode('custom');
                      patchSettings({
                        spacing: { ...settings.spacing, [axis]: Number(e.target.value) },
                      });
                    }}
                  />
                </label>
              ))}
              <label className="block">
                <span className="block mb-1">{t('limit')}</span>
                <select
                  className={FIELD}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[...new Set<number>([...BROWSE_LIMITS, limit])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {t('limitOption', { n })}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}

          {/* 選んだ作品 */}
          {current && (
            <div className="p-3 border-b border-[var(--ds-border)] space-y-2 text-sm">
              <div className="flex gap-3">
                {current.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.thumbnail}
                    alt=""
                    className="w-20 h-20 object-contain rounded bg-[var(--ds-surface-2)] cursor-zoom-in"
                    onClick={() => setLightbox(selected)}
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium break-words">{current.label}</p>
                  {current.summary && current.summary !== current.label && (
                    <p className="text-xs text-[var(--ds-fg-muted)] break-words">
                      {current.summary}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Link href={`/viewer?${viewerQuery(current)}`} className={`${BTN} no-underline`}>
                  {t('detail')}
                </Link>
                <button
                  className={BTN}
                  onClick={() => setLightbox(selected)}
                  disabled={!current.thumbnail}
                >
                  {t('enlarge')}
                </button>
                <button
                  className={keptIds.includes(current.id) ? BTN_ON : BTN}
                  aria-pressed={keptIds.includes(current.id)}
                  onClick={() => toggleKeep(selected)}
                >
                  {keptIds.includes(current.id) ? t('kept') : t('keep')}
                </button>
              </div>
            </div>
          )}

          {/* 作品の一覧 */}
          <nav className="flex-1 overflow-y-auto" aria-label={t('list')}>
            {filtered.map(({ item, index }) => (
              <button
                key={item.id}
                onClick={() => setSelected(index)}
                aria-current={index === selected}
                className={`flex items-center gap-3 w-full text-left px-3 py-2 border-b border-[var(--ds-border)] hover:bg-[var(--ds-surface-2)] ${
                  index === selected ? 'bg-[var(--ds-surface-2)] border-l-4 border-l-blue-600' : ''
                }`}
              >
                <span className="w-10 h-10 shrink-0 rounded overflow-hidden bg-[var(--ds-surface-2)]">
                  {item.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 text-sm line-clamp-2">
                  <span className="text-xs text-[var(--ds-fg-muted)] font-mono">{index + 1}. </span>
                  {item.label}
                </span>
              </button>
            ))}
            {filtered.length === 0 && status === 'ready' && (
              <p className="p-4 text-center text-sm text-[var(--ds-fg-muted)]">{t('noMatch')}</p>
            )}
          </nav>

          {/* Keep と比較 */}
          <div className="p-3 border-t border-[var(--ds-border)] bg-[var(--ds-surface)] text-sm">
            {kept.length === 0 ? (
              <p className="text-center text-xs text-[var(--ds-fg-muted)]">{t('keepHint')}</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="font-medium">{t('keepHeading', { count: kept.length })}</h3>
                  <div className="flex gap-1.5">
                    {compare ? (
                      <Link href={`/compare?${compare}`} className={`${BTN_ON} no-underline`}>
                        {t('compare')}
                      </Link>
                    ) : (
                      <button className={BTN} disabled>
                        {t('compare')}
                      </button>
                    )}
                    <button className={BTN} onClick={() => setKeptIds([])}>
                      {t('clear')}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {keptIndexes.map((i) => (
                    <button
                      key={items[i].id}
                      onClick={() => setSelected(i)}
                      title={items[i].label}
                      className="w-12 h-12 rounded overflow-hidden border-2 border-green-700 bg-[var(--ds-surface-2)]"
                    >
                      {items[i].thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={items[i].thumbnail}
                          alt={items[i].label}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* 拡大表示 */}
        {lightbox >= 0 && items[lightbox] && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={items[lightbox].label}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out"
            onClick={() => setLightbox(-1)}
          >
            <button
              className="absolute top-3 right-3 text-white/80 hover:text-white text-3xl leading-none px-2"
              aria-label={t('close')}
              onClick={() => setLightbox(-1)}
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={largeImageUrl(items[lightbox].thumbnail)}
              alt={items[lightbox].label}
              className="max-w-[92%] max-h-[84%] object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p
              className="absolute bottom-6 left-0 right-0 text-center text-white px-4"
              style={{ fontFamily: 'var(--ds-font-serif)' }}
            >
              {items[lightbox].label}
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

function toggleId(id: string | undefined, ids: string[]): string[] {
  if (!id) return ids;
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export default BrowseContent;
