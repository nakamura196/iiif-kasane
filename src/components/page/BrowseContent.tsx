'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';
import { SidePanel } from '@nakamura196/iiif-viewer';
import { buttonClass } from '@nakamura196/react-ui';
import Header from '@/components/Header';
import { Link } from '@/i18n/routing';
import {
  Browse3D,
  DEFAULT_SETTINGS,
  type BrowseSettings,
  type GroupView,
} from '@/components/browse/engine';
import { fillThumbnails, loadBrowseSource } from '@/components/browse/loadSource';
import {
  ChevronIcon,
  CloseIcon,
  ExpandIcon,
  FaceFrontIcon,
  InfoIcon,
  KeepIcon,
  LayoutIcon,
  ResetIcon,
  SearchIcon,
  StackIcon,
} from '@/components/browse/icons';
import {
  BROWSE_LAYOUTS,
  BROWSE_LIMITS,
  BY_SOURCE,
  DEFAULT_BROWSE_LIMIT,
  NONE_KEY,
  OTHER_KEY,
  browseQuery,
  compareQuery,
  groupItems,
  groupableFields,
  largeImageUrl,
  readBrowseParams,
  unwrapIiifUrl,
  viewerQuery,
  type BrowseItem,
  type BrowseLayout,
} from '@/lib/browse';
import '@/components/browse/browse.css';

// 3D で一覧する。Collection の Manifest・Manifest の Canvas を、サムネイルのカードにして 3D の空間に並べる。
// （元: nakamura196/iiif-3d-gallery。作りは components/browse/README.md）
// 状態は React の useState。Keep した作品は、資料ごとに localStorage に覚える。
// 画面の組み方はビューア・地図と画像のページに合わせた: 上に細い帯、右（狭い画面では下）に SidePanel とタブ、
// 空間の上には丸い操作の帯を浮かべる。

// フォーカスが見える輪（キーボードで操作したときだけ出す）
const RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]';
const FIELD =
  'w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] px-3 py-1.5 text-sm placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]';
// 浮かべた帯の中の丸いボタン
const PILL_BTN = `inline-flex items-center justify-center gap-1.5 h-8 min-w-8 px-2 rounded-full text-sm text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors ${RING}`;
const segClass = (on: boolean) =>
  `inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${RING} ${
    on
      ? 'bg-[var(--ds-primary)] text-[var(--ds-primary-fg)]'
      : 'text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
  }`;
// 小さな × などのアイコンだけのボタン
const ICON_BTN = `shrink-0 p-1 rounded text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] ${RING}`;

const SPACINGS = {
  compact: { x: 100, y: 140 },
  standard: { x: 160, y: 200 },
  wide: { x: 200, y: 240 },
} as const;
type SpacingMode = keyof typeof SPACINGS | 'custom';
type SideTab = 'list' | 'keep' | 'settings';

const keepKey = (url: string) => `browse-keep:${url}`;
// 操作のしかたの案内を閉じたかどうか（一度閉じたら次からは出さない）
const HINT_KEY = 'browse-hint-dismissed';
// 入口の画面の見本。Curation・Manifest・Collection を 1 つずつ
const ENTRY_SAMPLES = [
  { key: 'curation', url: 'https://nakamura196.github.io/ndl-face-finder/curations/works/edonohanami.json' },
  { key: 'manifest', url: 'https://iiif.io/api/cookbook/recipe/0009-book-1/manifest.json' },
  { key: 'collection', url: 'https://iiif.io/api/cookbook/recipe/0032-collection/collection.json' },
] as const;

function readKeep(url: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(keepKey(url)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const Thumb = ({ src, className }: { src: string; className: string }) => (
  <span className={`shrink-0 rounded overflow-hidden bg-[var(--ds-surface-2)] ${className}`}>
    {src && (
      // eslint-disable-next-line @next/next/no-img-element -- 外部の IIIF 画像。静的書き出しなので next/image は使えない
      <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
    )}
  </span>
);

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold tracking-wide text-[var(--ds-fg-muted)] mb-2">{children}</h3>
);

const BrowseContent = () => {
  const t = useTranslations('Browse');
  const locale = useLocale();
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const engineRef = useRef<Browse3D | null>(null);
  // 空間のクリックから、いまのカードの id を引くための控え
  const engineItems = useRef<BrowseItem[]>([]);
  // 空間に最後に渡した束・軸の中身（同じ中身で何度も並べ直さないため）
  const sentGroups = useRef('');

  const [url, setUrl] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_BROWSE_LIMIT);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'entry' | 'loading' | 'ready' | 'error'>('loading');
  const [errorKind, setErrorKind] = useState<'unreadable' | 'empty'>('unreadable');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [layout, setLayout] = useState<BrowseLayout>('table');
  const [lockRotation, setLockRotation] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const [billboard, setBillboard] = useState(false);
  const [dragMove, setDragMove] = useState(false);
  const [settings, setSettings] = useState<BrowseSettings>(DEFAULT_SETTINGS);
  const [spacingMode, setSpacingMode] = useState<SpacingMode>('standard');
  const [sideTab, setSideTab] = useState<SideTab>('list');
  const [query, setQuery] = useState('');
  const [lightbox, setLightbox] = useState(-1);
  // 拡大表示を閉じたら、開く前にフォーカスがあった所へ戻す
  const lightboxOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (lightbox >= 0) {
      if (!lightboxOpener.current) lightboxOpener.current = document.activeElement as HTMLElement | null;
    } else if (lightboxOpener.current) {
      lightboxOpener.current.focus?.();
      lightboxOpener.current = null;
    }
  }, [lightbox]);
  const [urlDraft, setUrlDraft] = useState('');
  const [entryError, setEntryError] = useState(false);
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);
  // グループの分け方。URL で指定が無ければ、資料から既定を選ぶ（null）
  const [groupBy, setGroupBy] = useState<string | null>(null);
  // グループの一覧で選んだ束（-1 は選んでいない）
  const [activeGroup, setActiveGroup] = useState(-1);

  // 開いたとき URL の引数を読む（manifest・iiif-content・curation・u のどれでも）。
  // あわせて、操作の案内を出すか（一度閉じたら出さない）と、指で操作する端末かを見る
  useEffect(() => {
    const p = readBrowseParams(new URLSearchParams(window.location.search), manifestFromParams);
    setUrl(p.url);
    setUrlDraft(p.url ?? '');
    if (p.layout) setLayout(p.layout);
    if (p.limit) setLimit(Math.min(p.limit, 500));
    setLockRotation(p.lockRotation);
    setGroupBy(p.group);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      // 覚えられないときは毎回出す（閉じればそのときは消える）
    }
    setHintOpen(!dismissed);
    setCoarse(window.matchMedia?.('(pointer: coarse)').matches === true);
    setReady(true);
  }, []);

  // 選ぶと一覧のタブに切り替え、選んだ資料の説明を見せる
  const select = useCallback((i: number) => {
    setSelected(i);
    if (i >= 0) setSideTab('list');
  }, []);

  // 3D の空間は 1 つ作って使い回す
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const engine = new Browse3D(el, {
      onSelect: (i) => select(i),
      onToggleKeep: (i) => setKeptIds((ids) => toggleId(engineItems.current[i]?.id, ids)),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [select]);
  useEffect(() => {
    engineItems.current = items;
  }, [items]);

  // 資料を読む。サムネイルを持たない Manifest は、読めたものから順に補う
  useEffect(() => {
    if (!ready) return;
    setSelected(-1);
    setLightbox(-1);
    setThumbProgress(null);
    setActiveGroup(-1);
    // URL が無いときは入口の画面（URL の入力と見本）を出し、空間には何も並べない
    if (!url) {
      setStatus('entry');
      setItems([]);
      engineRef.current?.setItems([]);
      return;
    }
    const ac = new AbortController();
    setStatus('loading');
    loadBrowseSource(url, locale, limit)
      .then((source) => {
        if (ac.signal.aborted) return;
        setTitle(source.title);
        setItems(source.items);
        engineItems.current = source.items;
        setKeptIds(readKeep(url ?? 'default'));
        sentGroups.current = '';
        engineRef.current?.setItems(source.items);
        setStatus('ready');
        const missing = source.items.flatMap((it, index) =>
          it.thumbnail || it.canvasIndex !== null || it.pos ? [] : [{ index, manifestUrl: it.manifestUrl }]
        );
        if (missing.length) setThumbProgress({ done: 0, total: missing.length });
        // 画像は空間にはすぐ差し込み、一覧（React の状態）にはまとめて 0.2 秒ごとに反映する
        // （500 件を 1 件ずつ反映すると、そのたびに画面全体を描き直すため）
        const pending = new Map<number, string>();
        let timer = 0;
        const flush = () => {
          timer = 0;
          if (ac.signal.aborted || !pending.size) return;
          const batch = new Map(pending);
          pending.clear();
          setItems((cur) => cur.map((it, i) => (batch.has(i) ? { ...it, thumbnail: batch.get(i)! } : it)));
        };
        return fillThumbnails(
          missing,
          (index, thumb) => {
            engineRef.current?.setThumbnail(index, thumb);
            pending.set(index, thumb);
            if (!timer) timer = window.setTimeout(flush, 200);
          },
          ac.signal,
          (done, total) => setThumbProgress(done >= total ? null : { done, total })
        ).then(flush);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setErrorKind(e.message === 'empty' ? 'empty' : 'unreadable');
        setItems([]);
        engineRef.current?.setItems([]);
        setStatus('error');
      });
    return () => ac.abort();
  }, [ready, url, locale, limit]);

  // 状態を空間に反映する
  useEffect(() => {
    engineRef.current?.setLayout(layout);
  }, [layout]);
  useEffect(() => {
    engineRef.current?.setRotationLock(lockRotation);
  }, [lockRotation]);
  useEffect(() => {
    if (selected >= 0) engineRef.current?.focusItem(selected);
    else engineRef.current?.clearSelection();
    // 一覧の中の行も見える位置へ
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  useEffect(() => engineRef.current?.setBillboard(billboard), [billboard]);
  useEffect(() => engineRef.current?.setDragEnabled(dragMove), [dragMove]);
  // 間隔は、つまみを動かしている間は待ち、止めてから並べ直す。開いたとき（既定のまま）は並べ直さない
  const firstSettings = useRef(true);
  useEffect(() => {
    if (firstSettings.current) {
      firstSettings.current = false;
      return;
    }
    const id = window.setTimeout(() => engineRef.current?.updateSettings(settings), 150);
    return () => window.clearTimeout(id);
  }, [settings]);
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

  // ---- グループとキューブ ----
  // 分け方に使える項目（資料ごと・metadata の項目）。値の種類が多すぎる・少なすぎる項目は除く
  const fields = useMemo(() => groupableFields(items), [items]);
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const fieldLabel = useCallback((name: string) => (name === BY_SOURCE ? t('bySource') : name), [t]);
  const valueLabel = useCallback(
    (v: string) => (v === NONE_KEY ? t('noneValue') : v === OTHER_KEY ? t('otherValue') : v),
    [t]
  );
  const groupField =
    groupBy && fieldNames.includes(groupBy) ? groupBy : (fieldNames[0] ?? BY_SOURCE);
  const groups = useMemo(() => groupItems(items, groupField), [items, groupField]);
  const groupViews = useMemo<GroupView[]>(
    () =>
      groups.map((g) => ({
        // 資料ごとで名前が無い（1 つの Manifest のページ）ときは、資料の名前
        label: g.key === NONE_KEY && groupField === BY_SOURCE ? title || t('noneValue') : valueLabel(g.key),
        indexes: g.indexes,
      })),
    [groups, groupField, title, t, valueLabel]
  );
  // 中身が変わったときだけ空間に渡す（渡すと並べ直すので、同じ中身で何度も渡さない）
  useEffect(() => {
    const key = JSON.stringify([items.length, groupViews]);
    if (key === sentGroups.current) return;
    sentGroups.current = key;
    engineRef.current?.setGroups(groupViews);
  }, [items.length, groupViews]);
  // 束を選ぶと、その板へ寄り、ほかのカードを薄くする。もう一度押すと戻す
  const pickGroup = (gi: number) => {
    const next = gi === activeGroup ? -1 : gi;
    setActiveGroup(next);
    setSelected(-1);
    engineRef.current?.highlight(next >= 0 ? groups[next].indexes : null);
    if (next >= 0) engineRef.current?.focusGroup(next);
    else engineRef.current?.resetView();
  };
  const changeGroupBy = (v: string) => {
    setGroupBy(v);
    setActiveGroup(-1);
    engineRef.current?.highlight(null);
  };

  // 資料と並べ方を URL に書く（共有・再読み込みでそのまま開く）
  useEffect(() => {
    if (!ready || !url) return;
    const q = browseQuery(url, {
      layout,
      limit: limit !== DEFAULT_BROWSE_LIMIT ? limit : undefined,
      lockRotation,
      // 資料を読む前は、URL で受けた指定をそのまま残す
      group: status === 'ready' ? groupField : groupBy,
    });
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [ready, url, layout, limit, lockRotation, status, groupField, groupBy]);

  // Esc で拡大表示・選択を閉じる。← → で前後の作品
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (lightbox >= 0) setLightbox(-1);
        else setSelected(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = e.key === 'ArrowRight' ? 1 : -1;
        // 拡大表示の間は、拡大した画像も一緒に送る
        if (lightbox >= 0) {
          const next = Math.min(Math.max(lightbox + step, 0), items.length - 1);
          setLightbox(next);
          setSelected(next);
        } else setSelected((s) => Math.min(Math.max(s + step, 0), items.length - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, items.length]);

  // 並べ方を変えると、空間は選択を外す。選択の状態もそろえる
  const changeLayout = (l: BrowseLayout) => {
    setLayout(l);
    setSelected(-1);
    setActiveGroup(-1);
    engineRef.current?.highlight(null);
  };
  const toggleKeep = useCallback(
    (i: number) => setKeptIds((ids) => toggleId(items[i]?.id, ids)),
    [items]
  );
  const patchSettings = (p: Partial<BrowseSettings>) => setSettings((s) => ({ ...s, ...p }));
  const dismissHint = () => {
    setHintOpen(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // 覚えられなくても、そのときは閉じる
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const only = activeGroup >= 0 && layout === 'grid' ? new Set(groups[activeGroup]?.indexes) : null;
    return items.flatMap((item, index) =>
      (!q || item.label.toLowerCase().includes(q)) && (!only || only.has(index)) ? [{ item, index }] : []
    );
  }, [items, query, activeGroup, layout, groups]);

  const current = selected >= 0 ? items[selected] : null;
  const currentKept = !!current && keptIds.includes(current.id);
  const kept = keptIndexes.map((i) => items[i]);
  const compare = compareQuery(kept);
  // 比較のページに渡す点数（同じ資料のページなら 2 枚、資料どうしなら 4 点まで）
  const compareCount = compare ? (compare.startsWith('src=') ? Math.min(4, kept.length) : 2) : 0;
  // Curation の範囲のカード（並べる数の上限は効かず、比較にも渡せない）
  const isCuration = items.some((it) => it.pos);

  // Kasane の検索・ビューアなどのページの URL を貼られたら、中の資料の URL を取り出して開く
  const openUrl = (input: string) => {
    const u = unwrapIiifUrl(input, manifestFromParams);
    if (!/^https?:\/\//i.test(u)) return false;
    setUrlDraft(u);
    setUrl(u);
    return true;
  };
  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    openUrl(urlDraft);
  };
  const submitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    setEntryError(!openUrl(urlDraft));
  };
  // 読めなかったときに、入口の画面へ戻る
  const backToEntry = () => {
    setUrl(null);
    setEntryError(false);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const tabs: { id: SideTab; label: string }[] = [
    { id: 'list', label: t('list') },
    { id: 'keep', label: kept.length ? t('keepTab', { count: kept.length }) : t('keepTabEmpty') },
    { id: 'settings', label: t('settings') },
  ];

  return (
    <div className="flex flex-col h-dvh">
      <Header compact />
      <main className="flex-1 relative overflow-hidden bg-[var(--ds-bg)] text-[var(--ds-fg)]">
        {status === 'entry' && (
          // 入口の画面（地図と画像などの入口と同じ組み方）。中身が画面より高いときは上から並べてスクロールさせる
          <div className="absolute inset-0 z-40 overflow-y-auto bg-[var(--ds-bg)] flex px-4 py-8">
            <div className="m-auto w-full max-w-md">
              <div className="mb-8 text-center">
                <div className="inline-block p-4 bg-[var(--ds-surface-2)] rounded-full mb-4">
                  <StackIcon className="w-16 h-16 text-[var(--ds-primary)]" />
                </div>
                <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--ds-font-serif)' }}>
                  {t('entryTitle')}
                </h2>
                <p className="text-[var(--ds-fg-muted)]">{t('entryDescription')}</p>
              </div>
              <form onSubmit={submitEntry} className="space-y-4">
                <div>
                  <input
                    type="text"
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    placeholder="https://example.com/collection.json"
                    aria-label={t('urlLabel')}
                    aria-invalid={entryError}
                    className="w-full px-4 py-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]"
                  />
                  {entryError && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t('entryInvalid')}</p>
                  )}
                  <p className="mt-2 text-xs text-[var(--ds-fg-muted)]">{t('entryPasteHint')}</p>
                </div>
                <button type="submit" className={buttonClass('primary', 'md', 'w-full')}>
                  {t('open')}
                </button>
              </form>
              <div className="mt-8 text-sm">
                <h3 className="font-medium mb-2 text-[var(--ds-fg-muted)]">{t('entrySamples')}</h3>
                <ul className="space-y-2">
                  {ENTRY_SAMPLES.map((s) => (
                    <li key={s.url}>
                      <button
                        type="button"
                        onClick={() => openUrl(s.url)}
                        className={`group w-full text-left rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 hover:border-[var(--ds-primary)] transition-colors ${RING}`}
                      >
                        <span className="block text-xs text-[var(--ds-fg-muted)]">
                          {t(`entrySampleKind.${s.key}`)}
                        </span>
                        <span className="block font-medium text-[var(--ds-primary)] group-hover:underline">
                          {t(`entrySample.${s.key}`)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row w-full h-full">
          {/* 左（狭い画面では上）: 帯と 3D の空間 */}
          <section className="relative flex-1 min-h-0 min-w-0 flex flex-col">
            <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-1.5">
              <div className="min-w-0 flex items-baseline gap-2">
                <h2
                  className="text-sm font-semibold truncate"
                  style={{ fontFamily: 'var(--ds-font-serif)' }}
                  title={title}
                >
                  {status === 'loading' ? t('loading') : title || t('untitled')}
                </h2>
                {status === 'ready' && (
                  <span className="shrink-0 text-xs text-[var(--ds-fg-muted)]">
                    {t('count', { count: items.length })}
                  </span>
                )}
                {thumbProgress && (
                  <span className="hidden sm:inline shrink-0 text-xs text-[var(--ds-fg-muted)]" role="status">
                    {t('thumbProgress', thumbProgress)}
                  </span>
                )}
              </div>
              <div
                role="radiogroup"
                aria-label={t('layout')}
                className="shrink-0 inline-flex gap-0.5 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg)] p-0.5"
              >
                {BROWSE_LAYOUTS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={layout === l}
                    aria-label={t(`layouts.${l}`)}
                    title={t(`layouts.${l}`)}
                    onClick={() => changeLayout(l)}
                    className={segClass(layout === l)}
                  >
                    <LayoutIcon layout={l} />
                    <span className="hidden md:inline">{t(`layouts.${l}`)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex-1 min-h-0">
              {/* 500 枚のカードを読み上げさせない（同じものは右の一覧と前後のボタンで操作できる） */}
              <div ref={stageRef} className="bw-stage absolute inset-0" aria-hidden="true" title={t('stage')} />

              {/* 空間の左上: グループの分け方・キューブの軸と、操作のしかた（一度閉じたら次からは出さない） */}
              {status === 'ready' && (
                <div className="absolute top-3 left-3 right-3 z-10 flex flex-col items-start gap-2 pointer-events-none">
                  {layout === 'grid' && (
                    <label className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[var(--ds-border)] bg-[var(--ds-bg)]/95 backdrop-blur shadow-md pl-3 pr-1 py-1 text-sm">
                      <span className="text-[var(--ds-fg-muted)] whitespace-nowrap">{t('groupBy')}</span>
                      {fields.length ? (
                        <select
                          className={`${FIELD} !w-auto max-w-[14rem] !py-1 !rounded-full`}
                          value={groupField}
                          onChange={(e) => changeGroupBy(e.target.value)}
                        >
                          {fields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {fieldLabel(f.name)}（{f.distinct}）
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="pr-2 text-[var(--ds-fg-muted)]">{t('noFields')}</span>
                      )}
                    </label>
                  )}
                  {hintOpen && (
                    <div className="pointer-events-auto flex gap-2 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg)]/95 backdrop-blur shadow-md px-3 py-2 text-xs leading-relaxed max-w-sm">
                      <InfoIcon className="w-4 h-4 shrink-0 mt-0.5 text-[var(--ds-primary)]" />
                      <p className="min-w-0 text-[var(--ds-fg-muted)]">
                        {coarse ? t('hintTouch') : t('hintMouse')}
                      </p>
                      <button
                        type="button"
                        onClick={dismissHint}
                        aria-label={t('hintDismiss')}
                        title={t('hintDismiss')}
                        className={`${ICON_BTN} self-start -my-0.5 -mr-1`}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div role="status" className="flex flex-col items-center gap-3 text-sm text-[var(--ds-fg-muted)]">
                    <div className="motion-safe:animate-spin rounded-full h-10 w-10 border-2 border-[var(--ds-border)] border-t-[var(--ds-primary)]" />
                    {t('loading')}
                  </div>
                </div>
              )}
              {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <div
                    role="alert"
                    className="max-w-sm w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg)] shadow-md p-5 text-center text-sm"
                  >
                    <p className="mb-4">{t(errorKind === 'empty' ? 'empty' : 'unreadable')}</p>
                    <button type="button" onClick={backToEntry} className={buttonClass('secondary', 'sm')}>
                      {t('openOther')}
                    </button>
                  </div>
                </div>
              )}

              {/* 下に浮かべた操作の帯: 前後・いまの位置・正面・視点を戻す */}
              {status === 'ready' && items.length > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 rounded-full border border-[var(--ds-border)] bg-[var(--ds-bg)]/95 backdrop-blur shadow-md p-1 max-w-[calc(100%-1.5rem)]">
                  <button
                    type="button"
                    className={PILL_BTN}
                    disabled={selected <= 0}
                    onClick={() => select(selected - 1)}
                    aria-label={t('prev')}
                    title={`${t('prev')} (←)`}
                  >
                    <ChevronIcon dir="left" />
                  </button>
                  <span
                    className="px-1 text-sm tabular-nums whitespace-nowrap text-[var(--ds-fg-muted)]"
                    aria-live="polite"
                  >
                    {selected >= 0
                      ? t('position', { n: selected + 1, total: items.length })
                      : t('positionNone', { total: items.length })}
                    {current && <span className="sr-only">: {current.label}</span>}
                  </span>
                  <button
                    type="button"
                    className={PILL_BTN}
                    disabled={selected >= items.length - 1}
                    onClick={() => select(selected + 1)}
                    aria-label={t('next')}
                    title={`${t('next')} (→)`}
                  >
                    <ChevronIcon dir="right" />
                  </button>
                  <span className="mx-1 h-5 w-px bg-[var(--ds-border)]" aria-hidden="true" />
                  <button
                    type="button"
                    className={`${PILL_BTN} ${billboard ? '!bg-[var(--ds-primary)] !text-[var(--ds-primary-fg)]' : ''}`}
                    aria-pressed={billboard}
                    aria-label={t('billboard')}
                    onClick={() => setBillboard((b) => !b)}
                    title={t('billboardHint')}
                  >
                    <FaceFrontIcon />
                    <span className="hidden sm:inline">{t('billboard')}</span>
                  </button>
                  <button
                    type="button"
                    className={PILL_BTN}
                    onClick={() => {
                      setSelected(-1);
                      engineRef.current?.resetView();
                    }}
                    aria-label={t('resetView')}
                    title={t('resetView')}
                  >
                    <ResetIcon />
                    <span className="hidden sm:inline">{t('resetView')}</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 右（狭い画面では下）の欄。ビューア・地図と画像のページと同じ部品で、畳める */}
          <SidePanel
            breakpoint="lg"
            className="flex flex-col bg-[var(--ds-bg)] border-t lg:border-t-0 lg:border-l border-[var(--ds-border)]"
          >
            <div
              role="tablist"
              aria-label={t('sidebar')}
              className="shrink-0 flex gap-1 px-2 pr-10 pt-2 border-b border-[var(--ds-border)]"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`bw-tab-${tab.id}`}
                  aria-selected={sideTab === tab.id}
                  aria-controls={`bw-panel-${tab.id}`}
                  onClick={() => setSideTab(tab.id)}
                  className={`px-3 py-1.5 text-sm border-b-2 -mb-px whitespace-nowrap ${RING} ${
                    sideTab === tab.id
                      ? 'border-[var(--ds-primary)] text-[var(--ds-primary)] font-medium'
                      : 'border-transparent text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 一覧: 選んだ資料の説明と、絞り込み・行の一覧 */}
            {sideTab === 'list' && (
              <div
                role="tabpanel"
                id="bw-panel-list"
                aria-labelledby="bw-tab-list"
                className="flex-1 min-h-0 flex flex-col"
              >
                {current ? (
                  <div className="shrink-0 p-3 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] text-sm">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setLightbox(selected)}
                        disabled={!current.thumbnail}
                        aria-label={t('enlarge')}
                        className={`shrink-0 w-16 h-16 lg:w-24 lg:h-24 rounded border border-[var(--ds-border)] bg-[var(--ds-surface-2)] overflow-hidden cursor-zoom-in disabled:cursor-default ${RING}`}
                      >
                        {current.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element -- 外部の IIIF 画像
                          <img src={current.thumbnail} alt="" className="w-full h-full object-contain" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-[var(--ds-fg-muted)] tabular-nums">
                            {t('position', { n: selected + 1, total: items.length })}
                          </p>
                          <button
                            type="button"
                            onClick={() => setSelected(-1)}
                            aria-label={t('clearSelection')}
                            title={t('clearSelection')}
                            className={`${ICON_BTN} -m-1`}
                          >
                            <CloseIcon />
                          </button>
                        </div>
                        <p
                          className="font-semibold break-words line-clamp-3"
                          style={{ fontFamily: 'var(--ds-font-serif)' }}
                        >
                          {current.label}
                        </p>
                        {current.summary && current.summary !== current.label && (
                          <p className="mt-0.5 text-xs text-[var(--ds-fg-muted)] break-words line-clamp-2">
                            {current.summary}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/viewer?${viewerQuery(current)}`}
                        className={buttonClass('primary', 'sm', 'no-underline')}
                      >
                        {t('detail')}
                      </Link>
                      <button
                        type="button"
                        className={buttonClass('secondary', 'sm', 'gap-1.5')}
                        onClick={() => setLightbox(selected)}
                        disabled={!current.thumbnail}
                      >
                        <ExpandIcon />
                        {t('enlarge')}
                      </button>
                      <button
                        type="button"
                        className={buttonClass(
                          'secondary',
                          'sm',
                          `gap-1.5 ${currentKept ? '!border-green-700 text-green-800 dark:!border-green-500 dark:text-green-300' : ''}`
                        )}
                        aria-pressed={currentKept}
                        onClick={() => toggleKeep(selected)}
                      >
                        <KeepIcon filled={currentKept} />
                        {currentKept ? t('kept') : t('keep')}
                      </button>
                    </div>
                  </div>
                ) : (
                  status === 'ready' && (
                    <p className="shrink-0 px-3 py-2 text-xs text-[var(--ds-fg-muted)] border-b border-[var(--ds-border)]">
                      {t('selectHint')}
                    </p>
                  )
                )}
                {layout === 'grid' && groups.length > 1 && (
                  <div className="shrink-0 border-b border-[var(--ds-border)] px-2 py-2">
                    <p className="px-1 mb-1.5 text-xs font-semibold text-[var(--ds-fg-muted)]">
                      {t('groupsHeading', { field: fieldLabel(groupField), count: groups.length })}
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto" role="group">
                      {groupViews.map((g, gi) => (
                        <button
                          key={gi}
                          type="button"
                          aria-pressed={activeGroup === gi}
                          onClick={() => pickGroup(gi)}
                          className={`inline-flex items-center gap-1.5 max-w-full rounded-full border px-2.5 py-0.5 text-xs transition-colors ${RING} ${
                            activeGroup === gi
                              ? 'border-[var(--ds-primary)] bg-[var(--ds-primary)] text-[var(--ds-primary-fg)]'
                              : 'border-[var(--ds-border)] hover:border-[var(--ds-primary)]'
                          }`}
                        >
                          <span className="truncate">{g.label}</span>
                          <span className="tabular-nums opacity-70">{g.indexes.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="shrink-0 p-2 border-b border-[var(--ds-border)]">
                  <div className="relative">
                    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ds-fg-muted)] pointer-events-none" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('search')}
                      aria-label={t('search')}
                      className={`${FIELD} pl-8`}
                    />
                  </div>
                  {query && (
                    <p className="mt-1 text-xs text-[var(--ds-fg-muted)]">
                      {t('countFiltered', { shown: filtered.length, total: items.length })}
                    </p>
                  )}
                </div>
                <nav ref={listRef} className="flex-1 min-h-0 overflow-y-auto" aria-label={t('list')}>
                  {filtered.map(({ item, index }) => {
                    const on = index === selected;
                    const isKept = keptIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-index={index}
                        onClick={() => select(index)}
                        aria-current={on}
                        className={`flex items-center gap-3 w-full text-left pl-2 pr-3 py-1.5 border-l-4 border-b border-b-[var(--ds-border)] hover:bg-[var(--ds-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ds-ring)] ${
                          on ? 'bg-[var(--ds-surface-2)] border-l-[var(--ds-primary)]' : 'border-l-transparent'
                        }`}
                      >
                        <Thumb src={item.thumbnail} className="w-10 h-10" />
                        <span className="min-w-0 flex-1 text-sm line-clamp-2">
                          <span className="text-xs text-[var(--ds-fg-muted)] tabular-nums">{index + 1}. </span>
                          {item.label}
                        </span>
                        {isKept && (
                          <KeepIcon
                            filled
                            className="w-3.5 h-3.5 shrink-0 text-green-700 dark:text-green-400"
                          />
                        )}
                      </button>
                    );
                  })}
                  {filtered.length === 0 && status === 'ready' && (
                    <p className="p-6 text-center text-sm text-[var(--ds-fg-muted)]">{t('noMatch')}</p>
                  )}
                </nav>
              </div>
            )}

            {/* Keep と比較 */}
            {sideTab === 'keep' && (
              <div
                role="tabpanel"
                id="bw-panel-keep"
                aria-labelledby="bw-tab-keep"
                className="flex-1 min-h-0 overflow-y-auto p-3 text-sm"
              >
                {kept.length === 0 ? (
                  <div className="py-8 text-center text-[var(--ds-fg-muted)]">
                    <KeepIcon className="w-8 h-8 mx-auto mb-3 opacity-60" />
                    <p>{t('keepEmpty')}</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3">
                      {compare ? (
                        <>
                          <Link
                            href={`/compare?${compare}`}
                            className={buttonClass('primary', 'sm', 'w-full no-underline')}
                          >
                            {t('compareAction', { count: compareCount })}
                          </Link>
                          {kept.length > compareCount && (
                            <p className="mt-2 text-xs text-[var(--ds-fg-muted)]">
                              {t('compareFirst', { n: compareCount })}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-[var(--ds-fg-muted)]">
                          {kept.some((it) => it.pos) ? t('compareUnavailableCuration') : t('keepMore')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xs font-semibold text-[var(--ds-fg-muted)]">
                        {t('keepTitle', { count: kept.length })}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setKeptIds([])}
                        className={`text-xs text-[var(--ds-primary)] hover:underline rounded ${RING}`}
                      >
                        {t('clear')}
                      </button>
                    </div>
                    <ul className="divide-y divide-[var(--ds-border)]">
                      {keptIndexes.map((i) => (
                        <li key={items[i].id} className="flex items-center gap-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => select(i)}
                            className={`min-w-0 flex-1 flex items-center gap-3 text-left rounded hover:bg-[var(--ds-surface-2)] ${RING}`}
                          >
                            <Thumb src={items[i].thumbnail} className="w-10 h-10" />
                            <span className="min-w-0 line-clamp-2">
                              <span className="text-xs text-[var(--ds-fg-muted)] tabular-nums">{i + 1}. </span>
                              {items[i].label}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleKeep(i)}
                            aria-label={t('removeKept', { label: items[i].label })}
                            title={t('removeKept', { label: items[i].label })}
                            className={ICON_BTN}
                          >
                            <CloseIcon />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-4 text-xs text-[var(--ds-fg-muted)]">{t('keepHint')}</p>
              </div>
            )}

            {/* 設定: よく使うものを上に、細かい調整は畳んでおく */}
            {sideTab === 'settings' && (
              <div
                role="tabpanel"
                id="bw-panel-settings"
                aria-labelledby="bw-tab-settings"
                className="flex-1 min-h-0 overflow-y-auto p-3 space-y-5 text-sm"
              >
                <section>
                  <SectionHeading>{t('sectionDisplay')}</SectionHeading>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={lockRotation}
                        onChange={(e) => setLockRotation(e.target.checked)}
                      />
                      <span>
                        {t('lockRotation')}
                        <span className="block text-xs text-[var(--ds-fg-muted)]">{t('lockRotationNote')}</span>
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={billboard}
                        onChange={(e) => setBillboard(e.target.checked)}
                      />
                      {t('billboardHint')}
                    </label>
                  </div>
                </section>

                <section>
                  <SectionHeading>{t('spacing')}</SectionHeading>
                  <div
                    role="radiogroup"
                    aria-label={t('spacing')}
                    className="flex gap-0.5 rounded-lg border border-[var(--ds-border)] p-0.5"
                  >
                    {(['compact', 'standard', 'wide'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={spacingMode === m}
                        onClick={() => {
                          setSpacingMode(m);
                          patchSettings({ spacing: { ...SPACINGS[m] } });
                        }}
                        className={`flex-1 ${segClass(spacingMode === m)}`}
                      >
                        {t(`spacings.${m}`)}
                      </button>
                    ))}
                  </div>
                  {spacingMode === 'custom' && (
                    <p className="mt-1 text-xs text-[var(--ds-fg-muted)]">{t('spacingCustomNote')}</p>
                  )}
                  <details className="mt-3">
                    <summary
                      className={`cursor-pointer select-none text-[var(--ds-primary)] hover:underline rounded ${RING}`}
                    >
                      {t('sectionAdvanced')}
                    </summary>
                    <div className="mt-3 space-y-3">
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
                            className="w-full accent-[var(--ds-primary)]"
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
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={dragMove}
                          onChange={(e) => setDragMove(e.target.checked)}
                        />
                        {t('dragMove')}
                      </label>
                    </div>
                  </details>
                </section>

                <section>
                  <SectionHeading>{t('sectionSource')}</SectionHeading>
                  <form onSubmit={submitUrl} className="space-y-2">
                    <label className="block">
                      <span className="block mb-1">{t('openOther')}</span>
                      <input
                        type="url"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder={t('urlPlaceholder')}
                        className={FIELD}
                      />
                    </label>
                    <button type="submit" className={buttonClass('secondary', 'sm')}>
                      {t('open')}
                    </button>
                  </form>
                  {/* Curation は member をすべて並べる（上限は効かない）ので出さない */}
                  {!isCuration && (
                    <label className="block mt-4">
                      <span className="block mb-1">{t('limit')}</span>
                      <select className={FIELD} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                        {[...new Set<number>([...BROWSE_LIMITS, limit])]
                          .sort((a, b) => a - b)
                          .map((n) => (
                            <option key={n} value={n}>
                              {t('limitOption', { n })}
                            </option>
                          ))}
                      </select>
                      <span className="block mt-1 text-xs text-[var(--ds-fg-muted)]">{t('limitNote')}</span>
                    </label>
                  )}
                </section>
              </div>
            )}
          </SidePanel>
        </div>

        {/* 拡大表示 */}
        {lightbox >= 0 && items[lightbox] && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={items[lightbox].label}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out"
            onClick={() => setLightbox(-1)}
            // 中のボタンは閉じるだけなので、Tab で外へ出ないようにする
            onKeyDown={(e) => {
              if (e.key === 'Tab') e.preventDefault();
            }}
          >
            <button
              type="button"
              autoFocus
              className="absolute top-3 right-3 p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={t('close')}
              onClick={() => setLightbox(-1)}
            >
              <CloseIcon className="w-6 h-6" />
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
