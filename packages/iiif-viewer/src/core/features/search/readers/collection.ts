// 読み手: コレクション（Presentation 2 / 3）。
// マニフェストごとに 1 項目。コレクションには metadata が書かれていないことが多いので、
// 各マニフェストを取ってきて、その metadata を使う。入れ子のコレクションは MAX_DEPTH 段までたどる。

import { labelIn } from '../../../services/paintedModels';
import { upgradeToV3 } from '../../../services/upgradeV2';
import { asList, countFailed, fetchAllReporting, idOf, isObject, typeOf, type Json } from '../json';
import { metadataRecordOf } from '../metadata';
import { firstThumbnailId, manifestThumbnail } from '../thumbnails';
import type { FetchJson, ReadResult, SearchItem, SearchReader } from '../types';

const MAX_DEPTH = 2;

interface ManifestRef {
  id: string;
  label: unknown;
  thumbnail?: string;
}

const isCollection = (json: unknown): boolean => /Collection$/.test(typeOf(json));

/**
 * コレクション（3 に直したもの）から、マニフェストへの参照を出てきた順に out へ足していく。
 * 入れ子を 1 つ読むたびに onFound を呼ぶ（入れ子が多いと、参照を集めるだけで時間がかかるため）。
 */
async function collectManifestRefs(
  collection: Json,
  fetchJson: FetchJson,
  depth: number,
  seen: Set<string>,
  out: ManifestRef[],
  onFound: () => void,
): Promise<void> {
  for (const item of asList(collection.items)) {
    const id = idOf(item);
    if (!id || !isObject(item) || seen.has(id)) continue;
    seen.add(id);
    if (/Manifest$/.test(typeOf(item))) {
      const ref: ManifestRef = { id, label: item.label };
      const t = firstThumbnailId(item.thumbnail);
      if (t) ref.thumbnail = t;
      out.push(ref);
    } else if (isCollection(item) && depth > 0) {
      try {
        const sub = upgradeToV3(await fetchJson(id));
        if (isObject(sub)) await collectManifestRefs(sub, fetchJson, depth - 1, seen, out, onFound);
      } catch {
        /* 読めない入れ子は飛ばす */
      }
      onFound();
    }
  }
}

export const collectionReader: SearchReader = {
  kind: 'collection',
  accepts: isCollection,
  async read(json, ctx) {
    const { url, fetchJson, locale, onPartial } = ctx;
    const v3 = upgradeToV3(json);
    if (!isObject(v3)) return { label: '', items: [], failed: 0 };
    const refs: ManifestRef[] = [];

    const build = (manifests: Map<string, Json | null>): ReadResult => {
      const items = refs.map((ref, i): SearchItem => {
        const m = manifests.get(ref.id) ?? null;
        const item: SearchItem = {
          key: String(i + 1),
          label: labelIn(m?.label ?? ref.label, locale) || ref.id,
          metadata: m ? metadataRecordOf(m.metadata, locale) : {},
          target: { content: ref.id },
        };
        const thumb = ref.thumbnail ?? (m ? manifestThumbnail(m) : undefined);
        if (thumb) item.thumbnail = thumb;
        return item;
      });
      return { label: labelIn(v3.label, locale), items, failed: countFailed(manifests) };
    };

    await collectManifestRefs(v3, fetchJson, MAX_DEPTH, new Set([idOf(v3) ?? url]), refs, () => onPartial?.(build(new Map())));
    const urls = refs.map((r) => r.id);
    return build(await fetchAllReporting(urls, ctx, build));
  },
};
