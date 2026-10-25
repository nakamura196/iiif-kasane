// /browse/ が資料を取ってくる部分（ネットワークを使う）。並べるカードへの直し方は lib/browse.ts。

import { fetchJson, fetchManifest, isCuration } from '@nakamura196/iiif-viewer/core';
import { sourceFromResource, thumbnailOfManifest, type BrowseSource } from '@/lib/browse';

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
 * Collection が画像を持っていない Manifest のサムネイルを、Manifest を取って補う（同時に 6 件まで）。
 * 取れたものから onThumb で知らせる。signal が中断されたら、そこで止める。
 */
export async function fillThumbnails(
  urls: { index: number; manifestUrl: string }[],
  onThumb: (index: number, url: string) => void,
  signal: AbortSignal
): Promise<void> {
  let next = 0;
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
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
}
