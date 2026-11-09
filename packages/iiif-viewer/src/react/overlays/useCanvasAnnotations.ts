'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  annotationSourcesOf,
  annotationStyles,
  fallbackStyleOf,
  paletteOrderOf,
  parseAnnotationCss,
  type AnnotationStyles,
  type StyleRules,
  nextPageOf,
  withReferenceLabels,
  rawCanvasOf,
  canvasIdsOf,
  readCanvasAnnotations,
  type CanvasAnnotation,
  type ContainerInfo,
  type ManifestV4,
} from '../../core';
import { localAnnotationPagesAtom } from './canvasAnnotationState';

const MAX_FOLLOWED_PAGES = 5;

// 参照だけの AnnotationPage の取得結果。同じ画面で右パネルと重ね表示が同じ物を使うので、
// 取得は 1 回だけにする（失敗は覚えず、次に開いたとき取り直す）。
const pageCache = new Map<string, Promise<unknown>>();

export const fetchPage = (url: string): Promise<unknown> => {
  let p = pageCache.get(url);
  if (!p) {
    p = fetch(url, { headers: { Accept: 'application/ld+json, application/json' } }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return p;
};

// 外部の stylesheet（Recipe 0045）。取得してすぐ、許可した性質だけに読み直す（生の CSS はここから外に出さない）。
const MAX_CSS_BYTES = 100_000;
const sheetCache = new Map<string, Promise<StyleRules>>();

const fetchSheet = (url: string): Promise<StyleRules> => {
  let p = sheetCache.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'text/css, text/plain' } })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => parseAnnotationCss(text.slice(0, MAX_CSS_BYTES)));
    p.catch(() => sheetCache.delete(url));
    sheetCache.set(url, p);
  }
  return p;
};

interface Fetched {
  key: string;
  pages: unknown[];
  failed: boolean;
}

export interface CanvasAnnotationsState {
  annotations: CanvasAnnotation[];
  loading: boolean;
  failed: boolean;
  /** 注釈の見た目（許可した性質だけ。外部 stylesheet は取得できたら反映される）。 */
  styleOf: (annotation: CanvasAnnotation) => AnnotationStyles;
}

// Canvas の注釈。マニフェストに書かれたものはすぐ、参照だけのページは取得してから足す。
// 閲覧者の手元で作ったページ（localAnnotationPagesAtom）も足す。
export function useCanvasAnnotations(
  manifest: ManifestV4 | null | undefined,
  container: ContainerInfo | undefined,
): CanvasAnnotationsState {
  const canvasId = container?.kind === 'Canvas' ? container.id : undefined;
  const width = container?.width;
  const height = container?.height;

  const sources = useMemo(
    () => annotationSourcesOf(canvasId ? rawCanvasOf(manifest, canvasId) : undefined),
    [manifest, canvasId],
  );
  const canvasIds = useMemo(() => canvasIdsOf(manifest), [manifest]);
  const key = `${canvasId ?? ''}|${sources.references.join('|')}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (!canvasId || sources.references.length === 0) return;
    let cancelled = false;
    const rawAnnotations = (rawCanvasOf(manifest, canvasId)?.annotations ?? []) as unknown[];
    const stubOf = (id: string) =>
      rawAnnotations.find((e) => typeof e === 'object' && e !== null && (e as { id?: unknown }).id === id);
    (async () => {
      const pages: unknown[] = [];
      let failed = false;
      for (const ref of sources.references) {
        let url: string | undefined = ref;
        for (let n = 0; url && n < MAX_FOLLOWED_PAGES; n++) {
          try {
            // マニフェストの参照に付いた AnnotationCollection の名前を、取得したページ（続きのページも）に引き継ぐ
            const page = withReferenceLabels(await fetchPage(url), stubOf(ref));
            pages.push(page);
            // follow `next` only while this page still has annotations for this Canvas
            const mine = readCanvasAnnotations(canvasId, [page], { width, height }, canvasIds);
            url = mine.length > 0 ? nextPageOf(page) : undefined;
          } catch {
            failed = true;
            url = undefined;
          }
        }
      }
      if (!cancelled) setFetched({ key, pages, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasId, key, sources, width, height, canvasIds, manifest]);

  const current = fetched?.key === key ? fetched : null;
  const local = useAtomValue(localAnnotationPagesAtom);
  const annotations = useMemo(
    () =>
      canvasId
        ? [
            // the Canvas's own pages: an annotation whose target is no Canvas of the manifest is on this one
            ...readCanvasAnnotations(canvasId, [...sources.pages, ...(current?.pages ?? [])], { width, height }, canvasIds),
            ...readCanvasAnnotations(canvasId, local.filter((l) => l.canvasId === canvasId).map((l) => l.page), { width, height }),
          ]
        : [],
    [canvasId, sources, current, local, width, height, canvasIds],
  );
  const sheetUrls = useMemo(
    () => [...new Set(annotations.map((a) => a.stylesheetUrl).filter((u): u is string => !!u))].slice(0, 5),
    [annotations],
  );
  const sheetKey = sheetUrls.join('|');
  const [sheets, setSheets] = useState<Record<string, StyleRules>>({});
  const [failedSheets, setFailedSheets] = useState<Record<string, true>>({});
  useEffect(() => {
    let cancelled = false;
    for (const url of sheetUrls) {
      fetchSheet(url).then(
        (rules) => {
          if (!cancelled) setSheets((prev) => (prev[url] ? prev : { ...prev, [url]: rules }));
        },
        // 取得できない（CORS など）ときは、下の styleOf で styleClass ごとの代わりの配色にする
        () => {
          if (!cancelled) setFailedSheets((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey]);
  const order = useMemo(() => paletteOrderOf(annotations), [annotations]);
  const styleOf = useCallback(
    (a: CanvasAnnotation) => {
      const own = annotationStyles(a, sheets);
      // 外部 stylesheet が読めなかった注釈だけ、クラスごとの代わりの配色にする
      if (a.stylesheetUrl && failedSheets[a.stylesheetUrl]) {
        const alt = fallbackStyleOf(a, order);
        if (alt) return { target: { ...alt.target, ...own.target }, body: { ...alt.body, ...own.body } };
      }
      return own;
    },
    [sheets, failedSheets, order],
  );

  return {
    styleOf,
    annotations,
    loading: sources.references.length > 0 && !current,
    failed: current?.failed ?? false,
  };
}
