'use client';

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TEXT_GRANULARITIES,
  collectManifestAnnotations,
  containersOf,
  contentSearchAnnotationPage,
  fetchContentSearchTerms,
  findContentSearchService,
  findSceneAnnotation,
  groupMatchesByCanvas,
  isSceneMatch,
  labelIn,
  manifestHasSearchableText,
  readCanvasAnnotations,
  runContentSearch,
  searchLocalAnnotations,
  searchSceneAnnotations,
  searchTranscripts,
  transcriptFilesOf,
  type TranscriptSource,
  type LocalSearchSource,
  type ContentSearchMatch,
  type ContentSearchResult,
  type ContentSearchService,
  type ContentSearchTerm,
} from '../../core';
import { annotationsAtom, selectedAnnotationIdAtom } from '../atoms';
import { fmt } from '../displays/TranscriptPanel';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { useLocale, useTranslations } from '../env';
import { inferenceResultsAtom } from '../inference/state';
import { localAnnotationPagesAtom, selectedCanvasAnnotationAtom, type LocalAnnotationPage } from '../overlays/canvasAnnotationState';
import { fetchPage } from '../overlays/useCanvasAnnotations';
import type { Panel, PanelContext } from './types';

// 資料の中の文字を探す。探す先は 2 つ:
// - 窓口（IIIF Content Search API 1.0 / 2.0）。マニフェストの service に書かれたもの
// - 手元の注釈。マニフェストの注釈（参照だけのページは取りに行く）と、ブラウザ内の推論の結果、
//   字幕・文字起こしのファイル（WebVTT と text/plain。字幕の当たりは押すとその時刻へ移る）
// 当たりは一覧に出し、画像の上にも印を出す（推論の結果と同じ「手元の注釈」の仕組みを使う）。
// 押すとそのページに移り、当たった所へ寄る。単位（行・語）が書いてあれば、それで絞り込める。

export const CONTENT_SEARCH_SOURCE = 'content-search';
const SOURCE = CONTENT_SEARCH_SOURCE;
const MAX_PAGES = 20;
const MAX_MATCHES = 2000;
/** 一覧に一度に出す数（Wellcome は 1 回で 1,753 件を返すことがある） */
const LIST_STEP = 200;

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
const PRIMARY = 'px-3 py-1 rounded text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40';

/** service: 提供元の窓口。local: 手元の注釈 */
type Scope = 'service' | 'local';

interface SearchState {
  /** 何回目の検索か。古い検索の応答が後から届いても、新しい結果を上書きしない */
  run: number;
  /** どのマニフェストの検索か（別の資料を開いたら捨てる） */
  manifestId: string;
  q: string;
  scope: Scope;
  status: 'running' | 'done' | 'error';
  result?: ContentSearchResult;
  /** 手元の注釈: 取りに行く注釈のページの進み具合 */
  progress?: { done: number; total: number };
  /** 手元の注釈: 取りに行けなかった・上限で取りに行かなかったページの数 */
  missed?: number;
}

/** 検索の結果。タブを切り替えても残す。Viewer に 1 つ（jotai store ごと）。 */
const contentSearchAtom = atom<SearchState | null>(null);
let runCounter = 0;
/** 絞り込む単位（null はすべて） */
const granularityAtom = atom<string | null>(null);
const showMarksAtom = atom<boolean>(true);
/** 選んだ探す先（null は既定: 窓口があれば窓口） */
const scopeAtom = atom<Scope | null>(null);

const fetchJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { headers: { Accept: 'application/ld+json, application/json' }, credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const urlParam = (name: string): string => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
};
const urlQuery = () => urlParam('q');

/** 手元の注釈のうち、検索の対象にするもの（検索の印そのものは除く）。推論の結果は、画像に出していなくても探す。 */
const localSearchPages = (local: LocalAnnotationPage[], inference: Record<string, { canvasId: string; modelId: string; page: unknown }>) => {
  const out = local.filter((l) => l.source !== SOURCE);
  for (const r of Object.values(inference)) {
    const source = `inference:${r.modelId}`;
    if (!out.some((l) => l.source === source && l.canvasId === r.canvasId)) out.push({ source, canvasId: r.canvasId, page: r.page });
  }
  return out;
};

/**
 * 手元で探せるか（タブを出すか）。
 * Canvas: 字幕のファイルを指すだけの注釈しか無い資料（Cookbook 0219 など）では、探せる文字が無いので出さない。
 * 3D の Scene: 読み込んだ Scene の注釈（見出し・本文）を探す。注釈が 1 件も無ければ出さない。
 */
export const canSearchLocal = ({ container, manifest, localAnnotationCount, annotationCount }: PanelContext) =>
  container?.kind === 'Scene'
    ? (annotationCount ?? 0) > 0
    : container?.kind === 'Canvas' && (manifestHasSearchableText(manifest) || (localAnnotationCount ?? 0) > 0);

const granularityRank = (g: string) => {
  const i = (TEXT_GRANULARITIES as readonly string[]).indexOf(g);
  return i < 0 ? TEXT_GRANULARITIES.length : i;
};

function useAutocomplete(service: ContentSearchService | undefined, text: string): ContentSearchTerm[] {
  const [terms, setTerms] = useState<{ q: string; terms: ContentSearchTerm[] }>({ q: '', terms: [] });
  const ac = service?.autocomplete;
  const q = text.trim();
  useEffect(() => {
    if (!ac || q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      fetchContentSearchTerms(ac, q, fetchJson).then(
        (ts) => live && setTerms({ q, terms: ts.slice(0, 20) }),
        () => {}, // 候補が出ないだけにする
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [ac, q]);
  return ac && q.length >= 2 && terms.q === q ? terms.terms : [];
}

function MatchText({ match }: { match: ContentSearchMatch }) {
  return (
    <span className="break-words">
      {match.before ? <span className="text-gray-500 dark:text-gray-400">…{match.before}</span> : null}
      <mark className="bg-yellow-200 dark:bg-yellow-700 dark:text-white rounded-sm px-0.5">{match.match || '—'}</mark>
      {match.after ? <span className="text-gray-500 dark:text-gray-400">{match.after}…</span> : null}
    </span>
  );
}

export function ContentSearchPanelBody(ctx: PanelContext) {
  const { container, manifest } = ctx;
  const t = useTranslations('ContentSearch');
  const locale = useLocale();
  const service = useMemo(() => findContentSearchService(manifest), [manifest]);
  const localOk = canSearchLocal(ctx);
  const manifestId = manifest?.id ?? '';
  const [state, setState] = useAtom(contentSearchAtom);
  const [scopeChoice, setScopeChoice] = useAtom(scopeAtom);
  const local = useAtomValue(localAnnotationPagesAtom);
  const inference = useAtomValue(inferenceResultsAtom);
  const sceneAnnotations = useAtomValue(annotationsAtom);
  const setSelectedScene = useSetAtom(selectedAnnotationIdAtom);
  const isScene = container?.kind === 'Scene';
  const [granularity, setGranularity] = useAtom(granularityAtom);
  const [showMarks, setShowMarks] = useAtom(showMarksAtom);
  const setLocal = useSetAtom(localAnnotationPagesAtom);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  const setRequest = useSetAtom(navRequestAtom);
  const current = state && state.manifestId === manifestId ? state : null;
  // 窓口があれば窓口から。URL の scope=local か、選び直したときは手元の注釈
  const wantedScope: Scope = scopeChoice ?? (urlParam('scope') === 'local' ? 'local' : 'service');
  const scope: Scope = !service ? 'local' : !localOk ? 'service' : wantedScope;
  const [text, setText] = useState(() => current?.q ?? urlQuery());
  const [limit, setLimit] = useState(LIST_STEP);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const terms = useAutocomplete(scope === 'service' ? service : undefined, text);

  const search = (q: string, where: Scope = scope) => {
    const word = q.trim();
    abort.current?.abort();
    if (!word || (where === 'service' && !service) || (where === 'local' && !localOk)) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const run = ++runCounter;
    // この検索がまだ最新のときだけ書く（タブを開き直すと abort.current は別物になるため、番号でも見る）
    const put = (next: Omit<SearchState, 'run' | 'manifestId' | 'q' | 'scope'>) =>
      setState((prev) => (ctl.signal.aborted || prev?.run !== run ? prev : { run, manifestId, q: word, scope: where, ...next }));
    setLimit(LIST_STEP);
    setGranularity(null);
    setSelected(null);
    setState({ run, manifestId, q: word, scope: where, status: 'running' });
    if (where === 'local' && isScene) {
      // 3D の Scene: 読み込み済みの注釈をその場で探す（取りに行くものは無い）
      const matches = searchSceneAnnotations(sceneAnnotations, container!.id, word, MAX_MATCHES);
      put({ status: 'done', result: { matches, truncated: matches.length >= MAX_MATCHES } });
      return;
    }
    if (where === 'local') {
      const pages = localSearchPages(local, inference);
      // 字幕・文字起こしのファイルは注釈と並行して読む。読めなかったものは「読み込めなかった」の数に入れる
      const transcripts = Promise.all(
        transcriptFilesOf(manifest).map((f) =>
          fetchText(f.url).then(
            (text): TranscriptSource => ({ ...f, text }),
            () => null,
          ),
        ),
      );
      Promise.all([
        collectManifestAnnotations(manifest, fetchPage, {
          signal: ctl.signal,
          onProgress: (done, total) => total > 0 && put({ status: 'running', progress: { done, total } }),
        }),
        transcripts,
      ]).then(
        ([{ sources, failed, skipped }, files]) => {
          const fromLocal: LocalSearchSource[] = pages.map((l) => ({
            canvasId: l.canvasId,
            annotations: readCanvasAnnotations(l.canvasId, [l.page]),
          }));
          const found = searchLocalAnnotations([...sources, ...fromLocal], word, MAX_MATCHES);
          const read = files.filter((f): f is TranscriptSource => f !== null);
          const matches = [...found, ...searchTranscripts(read, word, MAX_MATCHES - found.length)];
          put({
            status: 'done',
            result: { matches, truncated: matches.length >= MAX_MATCHES },
            missed: failed + skipped + (files.length - read.length),
          });
        },
        () => put({ status: 'error' }),
      );
      return;
    }
    runContentSearch(service!, word, fetchJson, {
      maxPages: MAX_PAGES,
      maxMatches: MAX_MATCHES,
      signal: ctl.signal,
      // 1 ページ目が来た時点で一覧を出す（続きは後から足される）
      onPage: (soFar) => put({ status: 'running', result: { ...soFar, truncated: false } }),
    }).then(
      (result) => put({ status: 'done', result }),
      () => put({ status: 'error' }),
    );
  };

  // ?q= があれば、開いたときに 1 回だけ探す
  const fromUrl = useRef(false);
  useEffect(() => {
    if (fromUrl.current || (!service && !localOk)) return;
    fromUrl.current = true;
    const q = urlQuery();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL はブラウザでしか読めない
    if (q && (current?.q !== q || current.scope !== scope)) search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, localOk]);

  // タブを閉じても検索は止めない（結果は Viewer の状態に残り、印も出し続ける）。
  // 止めるのは、次の検索を始めたときと「消す」を押したときだけ。

  const matches = useMemo(() => current?.result?.matches ?? [], [current]);
  const granularities = useMemo(
    () => [...new Set(matches.map((m) => m.granularity).filter((g): g is string => !!g))].sort((a, b) => granularityRank(a) - granularityRank(b)),
    [matches],
  );
  const shown = useMemo(
    () => (granularity ? matches.filter((m) => m.granularity === granularity) : matches),
    [matches, granularity],
  );

  // 画像の上の印。当たりのある Canvas ごとに 1 ページ（絞り込みに合わせる）
  useEffect(() => {
    setLocal((ls) => {
      const rest = ls.filter((l) => l.source !== SOURCE);
      if (!showMarks || shown.length === 0) return rest;
      const pages = [...groupMatchesByCanvas(shown.filter((m) => !isSceneMatch(m)))].map(([canvasId, ms]) => ({
        source: SOURCE,
        canvasId,
        page: contentSearchAnnotationPage(canvasId, ms),
      }));
      return [...rest, ...pages];
    });
  }, [shown, showMarks, setLocal]);

  const canvasLabels = useMemo(() => {
    const m = new Map<string, string>();
    // 何枚目かを必ず出す。ラベルが番号と同じか「-」（Wellcome の番号の無いページ）のときは番号だけ
    containersOf(manifest).forEach((c, i) => {
      const n = `${i + 1}`;
      const label = labelIn(c.label, locale).trim();
      m.set(c.id, label && label !== '-' && label !== n ? `${n} · ${label}` : n);
    });
    return m;
  }, [manifest, locale]);
  const canvasOrder = useMemo(() => new Map(containersOf(manifest).map((c, i) => [c.id, i])), [manifest]);

  const visible = shown.slice(0, limit);
  const groups = [...groupMatchesByCanvas(visible)].sort(
    (a, b) => (canvasOrder.get(a[0]) ?? Infinity) - (canvasOrder.get(b[0]) ?? Infinity),
  );

  const open = (m: ContentSearchMatch) => {
    setSelected(m.id);
    // 3D の Scene の当たり: 注釈の一覧で選ぶのと同じ状態を立てる（カメラが寄り、ラベルが開く）
    if (isSceneMatch(m)) {
      const hit = findSceneAnnotation(m, sceneAnnotations);
      if (hit) setSelectedScene(hit.id);
      return;
    }
    // 字幕の当たりは、その Canvas のその時刻へ
    if (m.time) {
      setRequest({ seq: nextSeq(), target: { canvasId: m.canvasId, t: m.time } });
      return;
    }
    const box = m.regions.find((r) => r.canvasId === m.canvasId && r.xywh)?.xywh;
    setRequest({ seq: nextSeq(), target: { canvasId: m.canvasId, ...(box ? { xywh: box } : {}) } });
  };

  const clear = () => {
    abort.current?.abort();
    setState(null);
    setText('');
    setSelected(null);
  };

  const copyLink = async () => {
    if (!current) return;
    const u = new URL(window.location.href);
    u.searchParams.set('tab', contentSearchPanel.id);
    u.searchParams.set('q', current.q);
    if (current.scope === 'local') u.searchParams.set('scope', 'local');
    else u.searchParams.delete('scope');
    try {
      await navigator.clipboard.writeText(u.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードが使えない環境では何もしない
    }
  };

  if (!service && !localOk) return null;
  const result = current?.result;
  const shownScope = current?.scope ?? scope;
  const listId = `content-search-terms-${manifestId.length}`;

  return (
    <div className="p-3 space-y-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(text);
        }}
      >
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          list={terms.length > 0 ? listId : undefined}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="flex-1 min-w-0 rounded border border-gray-300 dark:border-gray-600 bg-transparent px-2 py-1 text-sm"
        />
        <datalist id={listId}>
          {terms.map((term) => (
            <option key={term.value} value={term.value}>
              {term.count !== undefined ? `${term.label ?? term.value} (${term.count})` : term.label ?? term.value}
            </option>
          ))}
        </datalist>
        <button type="submit" className={PRIMARY} disabled={!text.trim()}>
          {t('search')}
        </button>
      </form>
      {service && localOk ? (
        <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label={t('scope')}>
          <span className="text-gray-500 dark:text-gray-300 mr-1">{t('scope')}</span>
          {(['service', 'local'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => {
                setScopeChoice(s);
                // 探した語があれば、選び直した先で探し直す
                if (current && current.scope !== s) search(current.q, s);
              }}
              className={`px-2 py-0.5 rounded-full border ${
                scope === s
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {t(s === 'service' ? 'scopeService' : 'scopeLocal')}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-gray-500 dark:text-gray-300">
        {scope === 'service' && service
          ? t('about', { version: service.version === 2 ? '2.0' : '1.0' })
          : isScene
            ? t('aboutScene')
            : t('aboutLocal')}
      </p>

      {current?.status === 'error' ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {t('failed')}
        </p>
      ) : null}
      {current && current.status !== 'error' ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm">
            {current.status === 'running' && !result
              ? current.progress
                ? t('loadingAnnotations', { done: current.progress.done, total: current.progress.total })
                : t('running')
              : t('count', { count: matches.length, total: result?.total ?? matches.length, q: current.q })}
            {current.status === 'running' && result ? ` ${t('loadingMore')}` : null}
          </p>
          {result?.truncated ? <p className="text-xs text-gray-500 dark:text-gray-300">{t('truncated', { count: matches.length })}</p> : null}
          {shownScope === 'local' && current.missed ? (
            <p className="text-xs text-gray-500 dark:text-gray-300">{t('missedPages', { count: current.missed })}</p>
          ) : null}
          {result && matches.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* 字幕の当たりには画像の上の印が無いので、印の出る当たりがあるときだけ */}
              {matches.some((m) => m.regions.length > 0 && !isSceneMatch(m)) ? (
                <label className="inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />
                  {t('showOnImage')}
                </label>
              ) : null}
              <button type="button" className={BUTTON} onClick={copyLink}>
                {copied ? t('copied') : t('copyLink')}
              </button>
              <button type="button" className={BUTTON} onClick={clear}>
                {t('clear')}
              </button>
            </div>
          ) : null}
          {granularities.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label={t('granularity')}>
              <span className="text-gray-500 dark:text-gray-300 mr-1">{t('granularity')}</span>
              {[null, ...granularities].map((g) => (
                <button
                  key={g ?? 'all'}
                  type="button"
                  aria-pressed={granularity === g}
                  onClick={() => setGranularity(g)}
                  className={`px-2 py-0.5 rounded-full border ${
                    granularity === g
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {g === null ? t('granularityAll') : (TEXT_GRANULARITIES as readonly string[]).includes(g) ? t(`granularity_${g}`) : g}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {groups.map(([canvasId, ms]) => (
        <section key={canvasId}>
          <h3
            className={`text-xs font-medium mb-1 ${
              container?.id === canvasId ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {t('page', { label: canvasLabels.get(canvasId) ?? canvasId, count: ms.length })}
          </h3>
          <ul className="space-y-1">
            {ms.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => open(m)}
                  aria-current={selected === m.id || undefined}
                  className={`w-full text-left rounded border px-2 py-1 text-sm ${
                    selected === m.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {m.time ? (
                    <span className="mr-2 text-xs tabular-nums text-blue-700 dark:text-blue-300">{fmt(m.time[0])}</span>
                  ) : null}
                  <MatchText match={m} />
                  {m.transcript && !m.time ? (
                    <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400">{t('transcriptFile')}</span>
                  ) : null}
                  {m.granularity ? (
                    <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400">
                      {(TEXT_GRANULARITIES as readonly string[]).includes(m.granularity) ? t(`granularity_${m.granularity}`) : m.granularity}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {shown.length > limit ? (
        <button type="button" className={BUTTON} onClick={() => setLimit((n) => n + LIST_STEP)}>
          {t('more', { count: shown.length - limit })}
        </button>
      ) : null}
    </div>
  );
}

// 文字の検索。マニフェストに検索の窓口（SearchService2 / SearchService1）が書かれているか、
// 手元に探せる文字（本文のある注釈・推論の結果・字幕と文字起こしのファイル）があるときに出す。
export const contentSearchPanel: Panel = {
  id: 'contentSearch',
  // 書き起こし（70）と Canvas の注釈（80）の間
  order: 75,
  available: (ctx) => !!findContentSearchService(ctx.manifest) || canSearchLocal(ctx),
  Component: ContentSearchPanelBody,
};

