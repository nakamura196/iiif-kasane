// 手元の注釈（マニフェストに書かれた注釈・取りに行った AnnotationPage・ブラウザ内の推論の結果）を、
// 検索の窓口が無くても同じ「当たり」の形で探す。React に依存しない。
//
// 大文字と小文字、全角と半角（NFKC）の違いは無視する。前後の文は、同じ注釈の本文から切り出す。

import {
  annotationSourcesOf,
  canvasIdsOf,
  manifestItemsOf,
  nextPageOf,
  readCanvasAnnotations,
  type CanvasAnnotation,
} from '../annotations';
import type { ContentSearchMatch, ContentSearchRegion } from './index';

/** 前後に添える文字数 */
const CONTEXT_CHARS = 30;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * 本文の文字（HTML ならタグを外す）。タグ（purpose か motivation が tagging）は資料の文字ではなく分類なので含めない。
 * The body text (tags stripped from HTML). Tags (purpose or sole motivation tagging) are a classification, not the
 * document's text, so they are left out: a search for "fig" should not hit every region tagged block_fig.
 */
export const annotationPlainText = (a: CanvasAnnotation): string =>
  a.bodies
    .filter((b) => b.kind === 'text' && b.value && !b.tagging)
    .map((b) =>
      /html/i.test(b.format ?? '') || /<[a-z][^>]*>/i.test(b.value!)
        ? b
            .value!.replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e: string) => {
              if (e[0] === '#') {
                const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                return Number.isFinite(n) ? String.fromCodePoint(n) : m;
              }
              return ENTITIES[e.toLowerCase()] ?? m;
            })
        : b.value!,
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 比べるための形（NFKC・小文字）と、その 1 文字ずつが元の何文字目だったか。 */
export const foldForSearch = (text: string): { folded: string; at: number[] } => {
  let folded = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = ch.normalize('NFKC').toLowerCase();
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(i);
  return { folded, at };
};

const regionOf = (a: CanvasAnnotation, canvasId: string, text: string): ContentSearchRegion => {
  const r = a.region;
  const box = r.type === 'rect' ? r : r.type === 'polygon' ? r.bbox : undefined;
  return {
    annotationId: a.id,
    canvasId,
    ...(box && box.w > 0 && box.h > 0 ? { xywh: [box.x, box.y, box.w, box.h] as [number, number, number, number] } : {}),
    text,
    ...(a.granularity ? { granularity: a.granularity } : {}),
  };
};

export interface LocalSearchSource {
  canvasId: string;
  annotations: CanvasAnnotation[];
}

/**
 * 注釈の本文から語を探す。1 つの注釈に何度も出れば、出た数だけ当たりにする。
 * 同じ id の注釈が 2 回渡されたら（マニフェストと手元の両方にあるなど）、1 回だけ数える。
 */
export function searchLocalAnnotations(sources: LocalSearchSource[], q: string, maxMatches = 2000): ContentSearchMatch[] {
  const needle = foldForSearch(q.trim()).folded;
  if (!needle) return [];
  const out: ContentSearchMatch[] = [];
  const seen = new Set<string>();
  for (const { canvasId, annotations } of sources) {
    for (const a of annotations) {
      const key = `${canvasId}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = annotationPlainText(a);
      if (!text) continue;
      const { folded, at } = foldForSearch(text);
      let from = 0;
      for (;;) {
        const hit = folded.indexOf(needle, from);
        if (hit < 0) break;
        from = hit + needle.length;
        const start = at[hit];
        const end = at[hit + needle.length];
        const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
        const after = text.slice(end, end + CONTEXT_CHARS);
        out.push({
          id: `${a.id}#search=${start}`,
          canvasId,
          regions: [regionOf(a, canvasId, text)],
          match: text.slice(start, end),
          ...(before ? { before } : {}),
          ...(after ? { after } : {}),
          ...(a.granularity ? { granularity: a.granularity } : {}),
        });
        if (out.length >= maxMatches) return out;
      }
    }
  }
  return out;
}

// ---- マニフェストの注釈を集める ---------------------------------------------------------

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const hasAnnotationsCache = new WeakMap<object, boolean>();

/** どれかの Canvas に注釈（書かれたもの・参照）があるか。タブを出すかどうかに使う。 */
export function manifestHasCanvasAnnotations(manifest: unknown): boolean {
  if (typeof manifest !== 'object' || manifest === null) return false;
  let v = hasAnnotationsCache.get(manifest);
  if (v === undefined) {
    v = manifestItemsOf(manifest).some((c) => asList(c?.annotations).length > 0);
    hasAnnotationsCache.set(manifest, v);
  }
  return v;
}

export interface CollectOptions {
  /** 取りに行く AnnotationPage の上限（資料全体で） */
  maxFetches?: number;
  /** 1 つの参照から next をたどる上限 */
  maxFollow?: number;
  /** 同時に取りに行く数 */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface CollectedAnnotations {
  sources: LocalSearchSource[];
  /** 取りに行けなかった参照の数 */
  failed: number;
  /** 上限で取りに行かなかった参照の数 */
  skipped: number;
}

/**
 * 資料の全 Canvas の注釈を集める。マニフェストに書かれたものはそのまま、参照だけのページは取りに行く。
 * 取りに行く処理は呼ぶ側が渡す（画面の注釈タブと同じ取り置きを使えるように）。
 */
export async function collectManifestAnnotations(
  manifest: unknown,
  fetchJson: (url: string) => Promise<unknown>,
  { maxFetches = 500, maxFollow = 5, concurrency = 6, signal, onProgress }: CollectOptions = {},
): Promise<CollectedAnnotations> {
  const canvasIds = canvasIdsOf(manifest);
  const jobs: { canvasId: string; size: { width?: number; height?: number }; embedded: unknown[]; refs: string[] }[] = [];
  for (const c of manifestItemsOf(manifest)) {
    const canvasId = typeof c?.id === 'string' ? c.id : undefined;
    if (!canvasId) continue;
    const src = annotationSourcesOf(c);
    const size = { width: Number(c.width) || undefined, height: Number(c.height) || undefined };
    jobs.push({ canvasId, size, embedded: src.pages, refs: src.references });
  }
  const sources: LocalSearchSource[] = jobs.map((j) => ({
    canvasId: j.canvasId,
    annotations: readCanvasAnnotations(j.canvasId, j.embedded, j.size, canvasIds),
  }));
  const refs = jobs.flatMap((j, i) => j.refs.map((url) => ({ i, url })));
  const todo = refs.slice(0, maxFetches);
  let failed = 0;
  let done = 0;
  let next = 0;
  onProgress?.(0, todo.length);
  const worker = async () => {
    while (next < todo.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { i, url: first } = todo[next++];
      const job = jobs[i];
      let url: string | undefined = first;
      try {
        for (let n = 0; url && n < maxFollow; n++) {
          const page = await fetchJson(url);
          const mine = readCanvasAnnotations(job.canvasId, [page], job.size, canvasIds);
          sources[i].annotations.push(...mine);
          url = mine.length > 0 ? nextPageOf(page) : undefined;
        }
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress?.(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { sources, failed, skipped: refs.length - todo.length };
}
