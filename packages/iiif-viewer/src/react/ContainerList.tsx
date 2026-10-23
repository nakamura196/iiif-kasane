'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  canvasParamTarget,
  contentStateOf,
  curationMemberAt,
  compareIndexesOf,
  containersOf,
  convertToV4,
  fetchManifest,
  labelIn,
  matchTargets,
  remoteGroupsOf,
  resolveCompareItems,
  parseContentState,
  parseDroppedText,
  startOf,
  stepArrows,
  type CanvasTarget,
  type ContentStateTargets,
  type ContainerInfo,
} from '../core';
import { manifestAtom } from './atoms';
import {
  compareAtom,
  compareMultiAtom,
  focusAtom,
  navRequestAtom,
  nextSeq,
  usePageOrder,
  useManifestSwitch,
} from './displays/structureState';
import { useLocale, useTranslations } from './env';

interface Props {
  containers: ContainerInfo[];
  selected: number;
  onSelect: (index: number) => void;
  /** false: hide the previous / next buttons (the host page has its own). The arrow keys still work. */
  pager?: boolean;
}

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLMediaElement
  );
};

// The page navigation of a manifest: previous / next and the arrow keys. The list of the pages
// is a tab of the right panel (panels/PagesPanel.tsx).
// It also receives the requests of the table of contents (right panel), opens the Canvas that
// the content state or `start` points to, and takes a dropped iiif-content link.
// Nothing is shown for a single container.
export default function ContainerList({ containers, selected, onSelect, pager = true }: Props) {
  const t = useTranslations('Structure');
  const manifest = useAtomValue(manifestAtom);
  const [request, setRequest] = useAtom(navRequestAtom);
  const setFocus = useSetAtom(focusAtom);
  const setCompare = useSetAtom(compareAtom);
  const setCompareMulti = useSetAtom(compareMultiAtom);
  const multiRun = useRef(0);
  const locale = useLocale();
  const { open, back, canGoBack } = useManifestSwitch();
  const { viewing, groups } = usePageOrder(manifest, containers);
  const sentinel = useRef<HTMLSpanElement>(null);
  // targets that wait for the manifest being opened (a content state, a drop)
  const pending = useRef<ContentStateTargets['targets'] | null>(null);
  const applied = useRef<string | null>(null);
  const opened = useRef<string | null>(null);

  const type = (manifest as { type?: string } | null)?.type;
  const isCollection = type === 'Collection';
  const rtl = viewing.direction === 'right-to-left';
  const btt = viewing.direction === 'bottom-to-top';
  const arrows = stepArrows(viewing.direction);

  const go = useCallback(
    (index: number, target?: CanvasTarget, highlight?: boolean, instant?: boolean) => {
      if (index < 0 || index >= containers.length) return;
      if (index !== selected) onSelect(index);
      setFocus(target && (target.xywh || target.t) ? { seq: nextSeq(), target, highlight, instant } : null);
      setCompare([]);
      multiRun.current++;
      setCompareMulti(null);
    },
    [containers.length, selected, onSelect, setFocus, setCompare, setCompareMulti],
  );

  // --- page movement (in display order; a spread moves two pages at once) ---
  const groupAt = groups.findIndex((g) => g.includes(selected));
  const step = (delta: number) => {
    const g = groups[groupAt + delta];
    if (g) go(g[0]);
  };
  const hasPrev = groupAt > 0;
  const hasNext = groupAt >= 0 && groupAt < groups.length - 1;

  // 0540: target が別のマニフェストの Canvas も指すとき、そのマニフェストを読んで並べて見せる
  const startMulti = useCallback(
    (targets: ContentStateTargets['targets'], anchor: number) => {
      if (!manifest) return;
      const remote = remoteGroupsOf(targets, containers);
      if (remote.length === 0) return;
      const run = ++multiRun.current;
      const nameOf = (m: { label?: unknown }, url: string) => labelIn(m.label as never, locale) || url.split('/').pop() || url;
      void (async () => {
        const sources = [{ label: nameOf(manifest, manifest.id), containers }] as Array<{
          manifestUrl?: string;
          label: string;
          containers: ContainerInfo[];
        }>;
        const failed: string[] = [];
        await Promise.all(
          remote.map(async (g) => {
            try {
              const raw = await fetchManifest(g.manifestUrl);
              if (!raw) throw new Error('fetch failed');
              const m = convertToV4(raw);
              sources.push({ manifestUrl: g.manifestUrl, label: nameOf(m, g.manifestUrl), containers: containersOf(m) });
            } catch {
              failed.push(g.manifestUrl);
            }
          }),
        );
        if (run !== multiRun.current) return;
        const items = resolveCompareItems(targets, sources);
        setCompareMulti({ anchor, items, failed });
      })();
    },
    [manifest, containers, locale, setCompareMulti],
  );

  // --- requests from the table of contents ---
  useEffect(() => {
    if (!request) return;
    const index = containers.findIndex((c) => c.id === request.target.canvasId);
    if (index >= 0) go(index, request.target, request.highlight);
    setRequest(null);
  }, [request, containers, go, setRequest]);

  // --- a content state (the URL, a loaded Annotation) or `start` decides the first Canvas ---
  useEffect(() => {
    if (!manifest || containers.length === 0) return;
    const key = `${manifest.id}`;
    if (applied.current === key) return;
    applied.current = key;
    let matched: Array<CanvasTarget & { index: number }> = [];
    let allTargets: ContentStateTargets['targets'] = [];
    if (pending.current) {
      allTargets = pending.current;
      matched = matchTargets(pending.current, containers);
      pending.current = null;
    }
    if (matched.length === 0 && typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('iiif-content');
      const state = parseContentState(param);
      if (state) {
        allTargets = state.targets;
        matched = matchTargets(state.targets, containers);
      }
    }
    // ?pos= of a curation: which item to show first (from 1, as in IIIF Curation Viewer)
    if (matched.length === 0 && typeof window !== 'undefined') {
      const target = curationMemberAt(manifest, Number(new URLSearchParams(window.location.search).get('pos')));
      if (target) matched = matchTargets([target], containers);
    }
    // ?canvas= : the frame number (from 1) or a Canvas URI
    if (matched.length === 0 && typeof window !== 'undefined') {
      const target = canvasParamTarget(new URLSearchParams(window.location.search).get('canvas'), containers);
      if (target) matched = [target];
    }
    if (matched.length > 0) {
      // リンク（content state・canvas=・pos=）や読み込み時の start で開いたときは、動きを付けずにその場所を出す
      go(matched[0].index, matched[0], undefined, true);
      // 0540: 複数の Canvas を指すときは、並べて見せる
      setCompare(compareIndexesOf(matched));
      startMulti(allTargets, matched[0].index);
      return;
    }
    const start = startOf(manifest, containers);
    // a region (#xywh=) or a time in `start` is highlighted
    if (start) go(start.index, start, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, containers]);

  // --- an Annotation (content state) that was given instead of a manifest ---
  useEffect(() => {
    if (!manifest || type !== 'Annotation') return;
    const state = contentStateOf(manifest);
    const url = state?.manifestUrl;
    if (!state || !url || opened.current === manifest.id) return;
    opened.current = manifest.id;
    pending.current = state.targets;
    void open(url, false);
  }, [manifest, type, open]);

  // --- keyboard: arrow keys follow the viewing direction ---
  const keyRef = useRef({ step, rtl, btt, groups, go });
  useEffect(() => {
    keyRef.current = { step, rtl, btt, groups, go };
  });
  useEffect(() => {
    const host = sentinel.current?.parentElement?.parentElement;
    if (!host) return;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '0');
    host.classList.add('outline-none');
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const { step: move, rtl: isRtl, btt: isBtt, groups: gs, go: goTo } = keyRef.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
          move(isRtl ? -1 : 1);
          break;
        case 'ArrowLeft':
          move(isRtl ? 1 : -1);
          break;
        case 'ArrowDown':
          move(isBtt ? -1 : 1);
          break;
        case 'ArrowUp':
          move(isBtt ? 1 : -1);
          break;
        case 'PageDown':
          move(1);
          break;
        case 'PageUp':
          move(-1);
          break;
        case 'Home':
          if (gs[0]) goTo(gs[0][0]);
          break;
        case 'End':
          if (gs.length) goTo(gs[gs.length - 1][0]);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    host.addEventListener('keydown', onKey);
    return () => host.removeEventListener('keydown', onKey);
  }, []);

  // --- drag and drop of an iiif-content link ---
  const onDropRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    onDropRef.current = (text: string) => {
      const state = parseDroppedText(text);
      if (!state) return;
      if (state.manifestUrl) {
        pending.current = state.targets;
        void open(state.manifestUrl, false);
        return;
      }
      const matched = matchTargets(state.targets, containers);
      if (matched.length > 0) {
        go(matched[0].index, matched[0]);
        setCompare(compareIndexesOf(matched));
        startMulti(state.targets, matched[0].index);
      }
    };
  });
  useEffect(() => {
    const host = sentinel.current?.parentElement?.parentElement;
    const el = host?.parentElement ?? host;
    if (!el) return;
    const hasText = (e: DragEvent) =>
      !!e.dataTransfer && ['text/uri-list', 'text/plain'].some((ty) => e.dataTransfer?.types.includes(ty));
    const onOver = (e: DragEvent) => {
      if (hasText(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasText(e)) return;
      e.preventDefault();
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      onDropRef.current(text);
    };
    el.addEventListener('dragover', onOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  const showPager = pager && !isCollection && containers.length >= 2;
  const showBack = canGoBack;

  if (!showPager && !showBack) {
    return (
      <div hidden>
        <span ref={sentinel} />
      </div>
    );
  }

  const group = groups[groupAt] ?? [selected];
  const progress =
    group.length > 1
      ? t('spread', { from: group[0] + 1, to: group[group.length - 1] + 1, total: containers.length })
      : t('page', { current: selected + 1, total: containers.length });

  const btn =
    'shrink-0 px-2 py-1 text-sm rounded border border-[var(--ds-border)] text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] disabled:opacity-40 disabled:hover:bg-transparent';
  // on the screen the left button is "previous" except for right-to-left and bottom-to-top books;
  // books read up or down get up/down arrows (the up one on the left)
  const leftIsNext = arrows.nextFirst;
  const [leftIcon, rightIcon] = arrows.vertical ? (leftIsNext ? [arrows.next, arrows.prev] : [arrows.prev, arrows.next]) : ['‹', '›'];

  return (
    <div className="bg-[var(--ds-surface)] border-b border-[var(--ds-border)]">
      <span ref={sentinel} hidden />
      {showBack && (
        <div className="p-1.5">
          <button type="button" className={btn} onClick={back}>
            {`‹ ${t('back')}`}
          </button>
        </div>
      )}
      {showPager && (
        <div className="flex items-center justify-center gap-2 p-1.5" role="group" aria-label={t('pager')}>
          <button
            type="button"
            className={btn}
            disabled={leftIsNext ? !hasNext : !hasPrev}
            onClick={() => step(leftIsNext ? 1 : -1)}
            aria-label={leftIsNext ? t('next') : t('prev')}
            title={leftIsNext ? t('next') : t('prev')}
          >
            {leftIcon}
          </button>
          <span className="text-sm tabular-nums text-[var(--ds-fg)]" aria-live="polite">
            {progress}
          </span>
          <button
            type="button"
            className={btn}
            disabled={leftIsNext ? !hasPrev : !hasNext}
            onClick={() => step(leftIsNext ? -1 : 1)}
            aria-label={leftIsNext ? t('prev') : t('next')}
            title={leftIsNext ? t('prev') : t('next')}
          >
            {rightIcon}
          </button>
        </div>
      )}
    </div>
  );
}
