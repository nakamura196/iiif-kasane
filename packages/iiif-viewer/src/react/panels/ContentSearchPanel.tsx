'use client';

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TEXT_GRANULARITIES,
  collectManifestAnnotations,
  containersOf,
  contentSearchAnnotationPage,
  hitUnionXywh,
  fetchContentSearchTerms,
  findContentSearchService,
  findSceneAnnotation,
  highlightParts,
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

// Search the text inside a resource. There are two places to search:
// - A search service (IIIF Content Search API 1.0 / 2.0) declared in the manifest's service
// - Local annotations: the manifest's annotations (pages that only hold a reference are fetched), in-browser inference results,
//   and caption/transcript files (WebVTT and text/plain; selecting a caption hit seeks to its time)
// Hits are listed and also marked on the image (using the same local-annotation mechanism as inference results).
// Selecting a hit moves to its page and zooms to the match. If units (line, word) are given, they can be used to filter.

import { CONTENT_SEARCH_SOURCE } from '../overlays/contentSearchSource';
export { CONTENT_SEARCH_SOURCE };
const SOURCE = CONTENT_SEARCH_SOURCE;
const MAX_PAGES = 20;
const MAX_MATCHES = 2000;
/** Number of hits shown in the list at a time (Wellcome can return 1,753 in one response) */
const LIST_STEP = 200;

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
const PRIMARY = 'px-3 py-1 rounded text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40';

/** service: the provider's search service. local: local annotations */
type Scope = 'service' | 'local';

interface SearchState {
  /** Which search this is. A late response from an old search must not overwrite newer results */
  run: number;
  /** Which manifest this search belongs to (discarded when another resource is opened) */
  manifestId: string;
  q: string;
  scope: Scope;
  status: 'running' | 'done' | 'error';
  result?: ContentSearchResult;
  /** Local annotations: progress of fetching the annotation pages */
  progress?: { done: number; total: number };
  /** Local annotations: number of pages that failed to load or were skipped because of the limit */
  missed?: number;
}

/** Search results. Kept when switching tabs. One per Viewer (per jotai store). */
const contentSearchAtom = atom<SearchState | null>(null);
let runCounter = 0;
/** Unit to filter by (null means all) */
const granularityAtom = atom<string | null>(null);
const showMarksAtom = atom<boolean>(true);
/** Chosen search target (null is the default: the search service if there is one) */
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

/** Local annotations to search (excluding the search markers themselves). Inference results are searched even when not shown on the image. */
const localSearchPages = (local: LocalAnnotationPage[], inference: Record<string, { canvasId: string; modelId: string; page: unknown }>) => {
  const out = local.filter((l) => l.source !== SOURCE);
  for (const r of Object.values(inference)) {
    const source = `inference:${r.modelId}`;
    if (!out.some((l) => l.source === source && l.canvasId === r.canvasId)) out.push({ source, canvasId: r.canvasId, page: r.page });
  }
  return out;
};

/**
 * Whether local search is possible (whether to show the tab).
 * Canvas: hide it for resources whose only annotations point to caption files (e.g. Cookbook 0219), as there is no text to search.
 * 3D Scene: searches the loaded Scene's annotations (headings and body). Hidden if there are none.
 */
export const canSearchLocal = ({ container, manifest, localAnnotationCount, annotationCount }: PanelContext) =>
  container?.kind === 'Scene'
    ? (annotationCount ?? 0) > 0
    : container?.kind === 'Canvas' && (manifestHasSearchableText(manifest) || (localAnnotationCount ?? 0) > 0);

const granularityRank = (g: string) => {
  const i = (TEXT_GRANULARITIES as readonly string[]).indexOf(g);
  return i < 0 ? TEXT_GRANULARITIES.length : i;
};

function useAutocomplete(service: ContentSearchService | undefined, text: string, locale: string): ContentSearchTerm[] {
  const [terms, setTerms] = useState<{ q: string; terms: ContentSearchTerm[] }>({ q: '', terms: [] });
  const ac = service?.autocomplete;
  const q = text.trim();
  useEffect(() => {
    if (!ac || q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      fetchContentSearchTerms(ac, q, fetchJson, locale).then(
        (ts) => live && setTerms({ q, terms: ts.slice(0, 20) }),
        () => {}, // Only suppresses suggestions
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [ac, q, locale]);
  return ac && q.length >= 2 && terms.q === q ? terms.terms : [];
}

function Highlighted({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 dark:text-white rounded-sm px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

// 3D hit: show the annotation heading on the first line (highlighting the searched term) and the body smaller on the second
function SceneMatchText({ match, q, title }: { match: ContentSearchMatch; q: string; title: string }) {
  const body = match.regions[0]?.text ?? '';
  return (
    <span className="break-words">
      <span className="block">{title ? <Highlighted text={title} q={q} /> : '—'}</span>
      {body && body !== title ? (
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          <Highlighted text={body} q={q} />
        </span>
      ) : null}
    </span>
  );
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
  const service = useMemo(() => findContentSearchService(manifest, locale), [manifest, locale]);
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
  // Use the search service if there is one. Local annotations if the URL has scope=local or the user re-selected them
  const wantedScope: Scope = scopeChoice ?? (urlParam('scope') === 'local' ? 'local' : 'service');
  const scope: Scope = !service ? 'local' : !localOk ? 'service' : wantedScope;
  const [text, setText] = useState(() => current?.q ?? urlQuery());
  const [limit, setLimit] = useState(LIST_STEP);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const terms = useAutocomplete(scope === 'service' ? service : undefined, text, locale);

  const search = (q: string, where: Scope = scope) => {
    const word = q.trim();
    abort.current?.abort();
    if (!word || (where === 'service' && !service) || (where === 'local' && !localOk)) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const run = ++runCounter;
    // Write only while this search is still the latest (abort.current changes when the tab is reopened, so check the sequence number too)
    const put = (next: Omit<SearchState, 'run' | 'manifestId' | 'q' | 'scope'>) =>
      setState((prev) => (ctl.signal.aborted || prev?.run !== run ? prev : { run, manifestId, q: word, scope: where, ...next }));
    setLimit(LIST_STEP);
    setGranularity(null);
    setSelected(null);
    setState({ run, manifestId, q: word, scope: where, status: 'running' });
    if (where === 'local' && isScene) {
      // 3D Scene: search the already-loaded annotations in place (nothing to fetch)
      const matches = searchSceneAnnotations(sceneAnnotations, container!.id, word, MAX_MATCHES);
      put({ status: 'done', result: { matches, truncated: matches.length >= MAX_MATCHES } });
      return;
    }
    if (where === 'local') {
      const pages = localSearchPages(local, inference);
      // Caption/transcript files are read in parallel with annotations. Those that fail are counted as failed to load
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
      // Show the list as soon as the first page arrives (the rest is appended later)
      onPage: (soFar) => put({ status: 'running', result: { ...soFar, truncated: false } }),
    }).then(
      (result) => put({ status: 'done', result }),
      () => put({ status: 'error' }),
    );
  };

  // If ?q= is present, search once on open
  const fromUrl = useRef(false);
  useEffect(() => {
    if (fromUrl.current || (!service && !localOk)) return;
    fromUrl.current = true;
    const q = urlQuery();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL can only be read in the browser
    if (q && (current?.q !== q || current.scope !== scope)) search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, localOk]);

  // Closing the tab does not stop the search (results stay in Viewer state and the markers keep showing).
  // It stops only when the next search starts or when Clear is pressed.

  const matches = useMemo(() => current?.result?.matches ?? [], [current]);
  const granularities = useMemo(
    () => [...new Set(matches.map((m) => m.granularity).filter((g): g is string => !!g))].sort((a, b) => granularityRank(a) - granularityRank(b)),
    [matches],
  );
  const shown = useMemo(
    () => (granularity ? matches.filter((m) => m.granularity === granularity) : matches),
    [matches, granularity],
  );

  // Markers on the image: one page per Canvas that has hits (following the filter)
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
    // Always show the ordinal. If the label equals the number or is "-" (unnumbered Wellcome pages), show only the number
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
    // 3D Scene hit: set the same state as selecting it in the annotation list (the camera moves in and the label opens)
    if (isSceneMatch(m)) {
      const hit = findSceneAnnotation(m, sceneAnnotations);
      if (hit) setSelectedScene(hit.id);
      return;
    }
    // A caption hit goes to that time on that Canvas
    if (m.time) {
      setRequest({ seq: nextSeq(), target: { canvasId: m.canvasId, t: m.time } });
      return;
    }
    // fit all the regions of the hit (a phrase spans several words), not only the first
    const union = hitUnionXywh(m.regions, m.canvasId);
    // A hit of several words: while the marks are shown they mark each word, so no frame is drawn around the union
    // (it would also cover the text between the words). With the marks hidden the frame is the only sign of the hit.
    const marked = showMarks && (union?.count ?? 0) > 1;
    setRequest({ seq: nextSeq(), target: { canvasId: m.canvasId, ...(union ? { xywh: union.box } : {}) }, ...(marked ? { highlight: false } : {}) });
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
      // Do nothing where the clipboard is unavailable
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
                // If a term was searched, search again on the newly chosen target
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
              {/* Caption hits have no marker on the image, so show this only when there are hits with markers */}
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
                  {isSceneMatch(m) ? (
                    <SceneMatchText
                      match={m}
                      q={current?.q ?? ''}
                      title={
                        findSceneAnnotation(m, sceneAnnotations)?.title ?? labelIn(m.regions[0]?.label, locale).trim()
                      }
                    />
                  ) : (
                    <MatchText match={m} />
                  )}
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

// Text search. Shown when the manifest declares a search service (SearchService2 / SearchService1),
// or when there is local searchable text (annotations with a body, inference results, caption and transcript files).
export const contentSearchPanel: Panel = {
  id: 'contentSearch',
  // Between the transcript (70) and Canvas annotations (80)
  order: 75,
  available: (ctx) => !!findContentSearchService(ctx.manifest) || canSearchLocal(ctx),
  Component: ContentSearchPanelBody,
};

