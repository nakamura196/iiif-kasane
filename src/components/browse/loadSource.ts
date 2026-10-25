// /browse/ が資料を取ってくる部分（ネットワークを使う）。並べるカードへの直し方は lib/browse.ts。

import { curationReader, fetchJson, fetchManifest, isCuration } from '@nakamura196/iiif-viewer/core';
import { sourceFromResource, thumbnailOfManifest, type BrowseItem, type BrowseSource } from '@/lib/browse';

/**
 * URL の Collection・Manifest・Curation を読み、カードの配列にする。
 * Curation と、画像 1 枚の info.json などは、Kasane のビューアと同じ手順（fetchManifest）で仮の Manifest にしてから読む。
 * 読めない・カードが 0 枚のときは例外。
 */
export async function loadBrowseSource(
  url: string,
  locale: string,
  limit: number
): Promise<BrowseSource> {
  const raw = await fetchJson(url);
  // Curation は元の Manifest を全部取ってから範囲を切り出すので、数を絞っても通信は減らない。上限（500）だけ掛ける
  if (isCuration(raw)) return curationSource(raw, url, locale, 500);
  let source = isCuration(raw) ? null : sourceFromResource(raw, url, locale);
  if (!source) {
    const manifest = await fetchManifest(url);
    source = manifest ? sourceFromResource(manifest, url, locale) : null;
  }
  if (!source) throw new Error('unreadable');
  if (source.items.length === 0) throw new Error('empty');
  return { ...source, items: source.items.slice(0, limit) };
}

/**
 * Curation は、検索のページと同じく member（顔などの範囲）ごとに 1 枚のカードにする。
 * 画像は元の Manifest の画像サービスから範囲を切り出したもの。束ねる名前は資料の名前。
 */
async function curationSource(
  raw: unknown,
  url: string,
  locale: string,
  limit: number
): Promise<BrowseSource> {
  const { label, items } = await curationReader.read(raw, { url, fetchJson, locale });
  if (items.length === 0) throw new Error('empty');
  const cards: BrowseItem[] = items.slice(0, limit).map((it) => ({
    id: `${url}#${it.key}`,
    label: it.label,
    manifestUrl: url,
    canvasIndex: null,
    pos: it.target.pos,
    thumbnail: it.thumbnail ?? '',
    group: it.label,
    summary: '',
    metadata: it.metadata,
  }));
  return { kind: 'collection', title: label, items: cards };
}

/**
 * Collection が画像を持っていない Manifest のサムネイルを、Manifest を取って補う（同時に 6 件まで）。
 * 取れたものから onThumb で知らせる。signal が中断されたら、そこで止める。
 */
export async function fillThumbnails(
  urls: { index: number; manifestUrl: string }[],
  onThumb: (index: number, url: string) => void,
  signal: AbortSignal,
  // 1 件ずつ、取れても取れなくても数える（画面に「補っています 12 / 60」と出すため）
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const { index, manifestUrl } = urls[next++];
      try {
        const m = await fetchManifest(manifestUrl);
        const t = m ? thumbnailOfManifest(m) : '';
        if (t && !signal.aborted) onThumb(index, t);
      } catch {
        // その 1 件だけ画像なしのまま
      }
      done += 1;
      if (!signal.aborted) onProgress?.(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
}
