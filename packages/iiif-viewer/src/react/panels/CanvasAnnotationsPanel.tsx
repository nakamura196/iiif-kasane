'use client';

import { useAtom, useSetAtom } from 'jotai';
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  annotationSearchText,
  annotationSourcesOf,
  containersOf,
  focusBoxOf,
  matchesSearchTerms,
  searchTerms,
  type RegionGroup,
  embeddedCanvasAnnotations,
  groupByRegion,
  isAnnotationAt,
  rawCanvasOf,
  labelIn,
  pickBodies,
  pickWikidataLabel,
  wikidataIdOf,
  wikidataLabelUrl,
  sanitizeAnnotationHtml,
  type AnnotationBodyItem,
  TEXT_GRANULARITIES,
  type CanvasAnnotation,
  type StyleDeclarations,
} from '../../core';
import { useLocale, useTranslations } from '../env';
import { useCanvasNavigation } from '../navigation';
import {
  canvasAnnotationFocusOnSelectAtom,
  canvasAnnotationGranularityAtom,
  canvasAnnotationQueryAtom,
  selectedCanvasAnnotationAtom,
} from '../overlays/canvasAnnotationState';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { scrollRowIntoView, useVirtualRows } from '../annotation/virtualList';
import { useCanvasAnnotations } from '../overlays/useCanvasAnnotations';
import AnnotationImages from '../annotation/AnnotationImages';
import { fmt } from '../displays/TranscriptPanel';
import { usePlayback } from '../playback';
import type { Panel, PanelContext } from './types';

const KNOWN_MOTIVATIONS = new Set([
  'commenting', 'tagging', 'linking', 'describing', 'identifying', 'classifying',
  'bookmarking', 'highlighting', 'questioning', 'replying', 'editing', 'moderating', 'painting',
]);

const isKnownGranularity = (g: string) => (TEXT_GRANULARITIES as readonly string[]).includes(g);
const granularityRank = (g: string) => {
  const i = (TEXT_GRANULARITIES as readonly string[]).indexOf(g);
  return i < 0 ? TEXT_GRANULARITIES.length : i;
};

const isHtml = (b: AnnotationBodyItem) => /html/i.test(b.format ?? '');
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The heading of an annotation (its label), above its text
function Title({ annotation }: { annotation: CanvasAnnotation }) {
  const locale = useLocale();
  const title = labelIn(annotation.title, locale);
  return title ? <p className="text-sm font-medium text-gray-900 dark:text-gray-50 break-words">{title}</p> : null;
}

// Wikidata のラベル。同じ項目は 1 回だけ取りに行く。失敗は覚えず、表示は URL のままにする。
const wikidataCache = new Map<string, Promise<string | undefined>>();

const fetchWikidataLabel = (id: string, locale: string): Promise<string | undefined> => {
  const key = `${id}|${locale}`;
  let p = wikidataCache.get(key);
  if (!p) {
    p = fetch(wikidataLabelUrl(id, locale), { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => pickWikidataLabel(json, id, locale));
    p.catch(() => wikidataCache.delete(key));
    wikidataCache.set(key, p);
  }
  return p;
};

function useWikidataLabel(url: string, locale: string, enabled: boolean): string | undefined {
  const id = enabled ? wikidataIdOf(url) : undefined;
  const [label, setLabel] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchWikidataLabel(id, locale).then(
      (text) => {
        if (!cancelled && text) setLabel({ key: `${id}|${locale}`, text });
      },
      () => {}, // quietly keep the URL
    );
    return () => {
      cancelled = true;
    };
  }, [id, locale]);
  return id && label?.key === `${id}|${locale}` ? label.text : undefined;
}

export function Body({ body, canvasLabels }: { body: AnnotationBodyItem; canvasLabels: Map<string, string> }) {
  const t = useTranslations('Info');
  const locale = useLocale();
  const { goToCanvas } = useCanvasNavigation();
  const wikidata = useWikidataLabel(body.url ?? '', locale, body.kind !== 'text' && !labelIn(body.label, locale));
  if (body.kind === 'text') {
    const key = body.tagging ? labelIn(body.label, locale) : '';
    if (key) {
      // a keyed tag (Keyed Tag extension): "key: value"
      return (
        <p className="text-sm text-gray-800 dark:text-gray-100 break-words" lang={body.language}>
          <span className="text-gray-500 dark:text-gray-300">{key}: </span>
          {isHtml(body) ? plainText(body.value ?? '') : body.value}
        </p>
      );
    }
    if (isHtml(body)) {
      // サニタイズ済み（許可したタグ・属性だけ）
      return (
        <div
          className="text-sm text-gray-800 dark:text-gray-100 break-words [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:inline [&_img]:h-5 [&_p]:my-1"
          lang={body.language}
          dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(body.value ?? '') }}
        />
      );
    }
    return (
      <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words" lang={body.language}>
        {body.value}
      </p>
    );
  }
  const url = body.url ?? '';
  const isWeb = /^https?:\/\//i.test(url);
  const own = canvasLabels.get(url);
  const givenLabel = labelIn(body.label, locale) || own;
  const label = givenLabel || wikidata || url;
  if (isWeb && (body.resourceType === 'Image' || /^image\//i.test(body.format ?? ''))) {
    // a picture in the annotation (recipe 0377): show it; the picture opens the full image
    return <AnnotationImages images={[{ id: url, label: labelIn(body.label, locale) || undefined }]} />;
  }
  if (own !== undefined) {
    // a Canvas of this item: the button moves the viewer there
    return (
      <button
        type="button"
        className="text-xs text-blue-600 dark:text-blue-400 underline break-words text-left"
        title={t('canvasAnnotationsCanvasLink')}
        onClick={(e) => {
          e.stopPropagation();
          goToCanvas(url);
        }}
      >
        {label}
      </button>
    );
  }
  if (!isWeb) return <p className="text-xs text-gray-500 dark:text-gray-300 break-all">{label}</p>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-blue-600 dark:text-blue-400 underline break-all"
      title={t('canvasAnnotationsOpen')}
    >
      {label}
    </a>
  );
}

function Item({
  annotation,
  more = [],
  selected,
  onSelect,
  canvasLabels,
  bodyStyle,
  playing,
}: {
  bodyStyle?: StyleDeclarations;
  annotation: CanvasAnnotation;
  /** The other annotations of the same region (Shared Region extension), shown under the first. */
  more?: CanvasAnnotation[];
  selected: boolean;
  /** The annotation's time contains the current position of the video or audio. */
  playing?: boolean;
  onSelect: () => void;
  canvasLabels: Map<string, string>;
}) {
  const t = useTranslations('Info');
  const locale = useLocale();
  const bodies = pickBodies(annotation.bodies, locale);
  const motivation = annotation.painted ? 'painting' : annotation.motivations[0];
  const where =
    annotation.region.type === 'canvas'
      ? t('canvasAnnotationsAbout')
      : annotation.region.type === 'point'
        ? t('canvasAnnotationsPoint')
        : t('canvasAnnotationsRegion');
  return (
    <div
      className={`rounded border p-2 cursor-pointer ${
        selected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
          : playing
            ? 'border-blue-300 dark:border-blue-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
      onClick={onSelect}
      aria-current={selected || undefined}
    >
      <div className="flex gap-2 text-xs text-gray-500 dark:text-gray-300 mb-1">
        {motivation ? (
          <span>
            {KNOWN_MOTIVATIONS.has(motivation) ? t(`canvasAnnotationsMotivation_${motivation}`) : motivation}
          </span>
        ) : null}
        <span>{where}</span>
        {annotation.granularity ? (
          <span>
            {isKnownGranularity(annotation.granularity)
              ? t(`canvasAnnotationsGranularity_${annotation.granularity}`)
              : annotation.granularity}
          </span>
        ) : null}
        {annotation.time ? (
          <span className="ml-auto tabular-nums">
            {fmt(annotation.time.start)}
            {annotation.time.end !== undefined && fmt(annotation.time.end) !== fmt(annotation.time.start)
              ? `–${fmt(annotation.time.end)}`
              : ''}
          </span>
        ) : null}
        {annotation.layer ? (
          <span>{t('canvasAnnotationsLayer', { label: labelIn(annotation.layer.label, locale) || annotation.layer.id })}</span>
        ) : null}
      </div>
      <div
        className={`space-y-1 ${bodyStyle?.color ? '[&_*]:!text-inherit' : ''}`}
        style={bodyStyle}
      >
        <Title annotation={annotation} />
        {bodies.map((b, i) => (
          <Body key={i} body={b} canvasLabels={canvasLabels} />
        ))}
        {more.map((m) => (
          <div key={m.id} className="space-y-1 border-t border-gray-200 dark:border-gray-700 pt-1" data-annotation-id={m.id}>
            <Title annotation={m} />
            {pickBodies(m.bodies, locale).map((b, i) => (
              <Body key={i} body={b} canvasLabels={canvasLabels} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// 一覧の 1 行: 注釈のまとまり（AnnotationCollection）の見出しか、注釈（同じ領域のものは 1 行）
type Row =
  | { kind: 'header'; key: string; label: unknown; fallback: string; count: number }
  | { kind: 'item'; key: string; group: RegionGroup<CanvasAnnotation> };

// 一覧の上の余白（スクロールする枠の padding-top と同じ値）
const LIST_TOP = 8;

export function CanvasAnnotationsPanelBody({ container, manifest }: PanelContext) {
  const t = useTranslations('Info');
  const locale = useLocale();
  const { annotations: all, loading, failed, styleOf } = useCanvasAnnotations(manifest, container);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  // Text Granularity: 行と語が両方あるときなど、単位で絞り込めるようにする
  const [granularity, setGranularity] = useAtom(canvasAnnotationGranularityAtom);
  const [query, setQuery] = useAtom(canvasAnnotationQueryAtom);
  const [focusOnSelect, setFocusOnSelect] = useAtom(canvasAnnotationFocusOnSelectAtom);
  const setRequest = useSetAtom(navRequestAtom);
  // 打っている間は入力を先に返し、一覧の絞り込みは後から追いつかせる
  const deferredQuery = useDeferredValue(query);
  const granularities = useMemo(
    () =>
      [...new Set(all.map((a) => a.granularity).filter((g): g is string => !!g))].sort(
        (a, b) => granularityRank(a) - granularityRank(b),
      ),
    [all],
  );
  const activeGranularity = granularity && granularities.includes(granularity) ? granularity : null;
  const annotations = useMemo(
    () => (activeGranularity ? all.filter((a) => a.granularity === activeGranularity) : all),
    [all, activeGranularity],
  );
  const terms = useMemo(() => searchTerms(deferredQuery), [deferredQuery]);
  const { currentTime, seek } = usePlayback();
  const timed = annotations.some((a) => a.time);

  // clear the selection when the Canvas changes
  useEffect(() => {
    setSelected(null);
  }, [container?.id, setSelected]);

  const canvasLabels = useMemo(() => {
    const m = new Map<string, string>();
    containersOf(manifest).forEach((c, i) => m.set(c.id, labelIn(c.label, locale) || `Canvas ${i + 1}`));
    return m;
  }, [manifest, locale]);

  // group by AnnotationCollection (annotations of no collection come first), then by region;
  // a region is kept when one of its annotations has all the words of the search
  const { rows, shown } = useMemo(() => {
    const groups = new Map<string, { label: unknown; items: CanvasAnnotation[] }>();
    for (const a of annotations) {
      const key = a.collection?.id ?? '';
      const g = groups.get(key) ?? { label: a.collection?.label, items: [] };
      g.items.push(a);
      groups.set(key, g);
    }
    const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : 0));
    const out: Row[] = [];
    let count = 0;
    for (const [key, g] of ordered) {
      const regions = groupByRegion(g.items).filter(
        (rg) => terms.length === 0 || rg.annotations.some((a) => matchesSearchTerms(annotationSearchText(a), terms)),
      );
      if (regions.length === 0) continue;
      if (key) out.push({ kind: 'header', key: `h:${key}`, label: g.label, fallback: key, count: regions.length });
      for (const rg of regions) out.push({ kind: 'item', key: `${key}|${rg.key}`, group: rg });
      count += regions.length;
    }
    return { rows: out, shown: count };
  }, [annotations, terms]);
  const total = useMemo(() => (terms.length === 0 ? shown : groupByRegion(annotations).length), [annotations, terms, shown]);

  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const list = useVirtualRows(scroller, keys, { listTop: LIST_TOP });

  // a mark chosen on the image (or elsewhere): bring its row into view
  const rowOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.kind === 'item') for (const a of r.group.annotations) m.set(a.id, i);
    });
    return m;
  }, [rows]);
  const showRow = useEffectEvent((id: string) => {
    const i = rowOf.get(id);
    if (i !== undefined) scrollRowIntoView(scroller.current, list.offsets, i, LIST_TOP);
  });
  useEffect(() => {
    if (!selected) return;
    showRow(selected);
    // once more after the rows drawn there are measured (their heights were estimated)
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => showRow(selected));
    });
    return () => cancelAnimationFrame(id);
  }, [selected]);

  const choose = (a: CanvasAnnotation, isSelected: boolean) => {
    // an annotation on a moment of a video or audio: go there, so that its frame is shown
    // (a little past the start: a seek may land a hair before the asked position)
    if (a.time && !isSelected) seek(a.time.start + 0.01);
    if (focusOnSelect && !isSelected && container) {
      const box = focusBoxOf(a.region, { width: container.width ?? 0, height: container.height ?? 0 });
      // the chosen annotation is marked on the image already: no second box around the wider part shown
      if (box) setRequest({ seq: nextSeq(), target: { canvasId: container.id, xywh: box }, highlight: false });
    }
    setSelected(isSelected ? null : a.id);
  };

  const searching = query.trim().length > 0;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 pb-2 space-y-2 border-b border-gray-200 dark:border-gray-700">
        {loading ? <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsLoading')}</p> : null}
        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {t('canvasAnnotationsFailed')}
          </p>
        ) : null}
        {all.length > 0 ? (
          <div className="flex items-center gap-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('canvasAnnotationsSearch')}
              aria-label={t('canvasAnnotationsSearch')}
              className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-800 dark:text-gray-100"
            />
          </div>
        ) : null}
        {all.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-300">
            <span aria-live="polite">
              {searching
                ? t('canvasAnnotationsSearchCount', { count: shown, total })
                : t('canvasAnnotationsTotal', { count: shown })}
            </span>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={focusOnSelect} onChange={(e) => setFocusOnSelect(e.target.checked)} />
              {t('canvasAnnotationsFocusOnSelect')}
            </label>
          </div>
        ) : null}
        {granularities.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label={t('canvasAnnotationsGranularity')}>
            <span className="text-gray-500 dark:text-gray-300 mr-1">{t('canvasAnnotationsGranularity')}</span>
            {[null, ...granularities].map((g) => (
              <button
                key={g ?? 'all'}
                type="button"
                aria-pressed={activeGranularity === g}
                onClick={() => setGranularity(g)}
                className={`px-2 py-0.5 rounded-full border ${
                  activeGranularity === g
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {g === null
                  ? t('canvasAnnotationsGranularityAll')
                  : isKnownGranularity(g)
                    ? t(`canvasAnnotationsGranularity_${g}`)
                    : g}
              </button>
            ))}
          </div>
        ) : null}
        {!loading && annotations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsEmpty')}</p>
        ) : null}
        {annotations.length > 0 && rows.length === 0 && terms.length > 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsNoMatch')}</p>
        ) : null}
      </div>
      {/* 見えている行とその前後だけを描く（注釈が数万件あっても重くならないように） */}
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-auto px-3 pb-3 [overflow-anchor:none]"
        style={{ paddingTop: LIST_TOP }}
        data-annotation-list
      >
        <div className="relative" style={{ height: list.offsets[list.offsets.length - 1] }}>
          <div className="absolute inset-x-0" style={{ top: list.offsets[list.start] }}>
            {rows.slice(list.start, list.end).map((r, j) => (
              <div key={r.key} ref={list.measure} data-key={r.key} data-top={list.offsets[list.start + j]} className="pb-2">
                {r.kind === 'header' ? (
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 pt-1">
                    <LabelOf label={r.label} fallback={r.fallback} /> ({t('canvasAnnotationsCount', { count: r.count })})
                  </h3>
                ) : (
                  (() => {
                    const rg = r.group;
                    const a = rg.annotations[0];
                    const isSelected = rg.annotations.some((m) => m.id === selected);
                    return (
                      <Item
                        annotation={a}
                        more={rg.annotations.slice(1)}
                        selected={isSelected}
                        onSelect={() => choose(a, isSelected)}
                        playing={timed && !!a.time && isAnnotationAt(a, currentTime)}
                        canvasLabels={canvasLabels}
                        bodyStyle={styleOf(a).body}
                      />
                    );
                  })()
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LabelOf({ label, fallback }: { label: unknown; fallback: string }) {
  const locale = useLocale();
  return <>{labelIn(label, locale) || fallback}</>;
}

// Canvas 上の注釈（コメント・タグ・リンクなど）の一覧。3D の Scene では出さない。
export const canvasAnnotationsPanel: Panel = {
  id: 'canvasAnnotations',

  order: 80,
  // 書かれている注釈か、取りに行く参照のどちらかがあるときだけ出す
  available: ({ container, manifest }) => {
    if (container?.kind !== 'Canvas') return false;
    if (annotationSourcesOf(rawCanvasOf(manifest, container.id)).references.length > 0) return true;
    return embeddedCanvasAnnotations(manifest, container.id, container).length > 0;
  },
  Component: CanvasAnnotationsPanelBody,
};
