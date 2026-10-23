// 読み手: IIIF Change Discovery API 1.0 の更新一覧（Activity Streams の OrderedCollection）。
// https://iiif.io/api/discovery/1.0/
//
// 一覧は古い順に並ぶページの連なりなので、仕様の勧めどおり最後のページ（last）から prev へ
// 新しい順にたどる。マニフェストごとに一番新しい出来事だけを見て、Delete・Remove されたものは除き、
// Move は移った先の URL を載せる。Refresh（全件の出し直し）より前は、その後に出し直されているので読まない。
//
// 大きな機関の一覧は数万件ある（2026-10-22、Bodleian は 21,857 件・219 ページ）。
// 各マニフェストも取ってくるので、新しいほうから DISCOVERY_MAX_ITEMS 件・DISCOVERY_MAX_PAGES ページで打ち切る。

import { labelIn } from '../../../services/paintedModels';
import { asList, countFailed, fetchAllV3, idOf, isObject, str, typeOf, type Json } from '../json';
import { metadataRecordOf } from '../metadata';
import { manifestThumbnail } from '../thumbnails';
import type { FetchJson, SearchItem, SearchReader } from '../types';

export const DISCOVERY_MAX_ITEMS = 100;
export const DISCOVERY_MAX_PAGES = 30;

interface ManifestRef {
  id: string;
  label: unknown;
}

const isManifest = (v: unknown): boolean => /Manifest$/.test(typeOf(v));

/** 出来事の対象の名前。Activity Streams の name か、IIIF の label。 */
const labelOf = (obj: unknown): unknown => (isObject(obj) ? (obj.label ?? str(obj.name)) : undefined);

/**
 * 最後のページから新しい順にたどり、今も公開されているマニフェストを、新しく変わった順に集める。
 * 最初に読むページが取れなければ例外。途中のページが取れなければ、そこまでで止める。
 */
export async function recentManifests(
  start: Json,
  fetchJson: FetchJson,
  { maxItems = DISCOVERY_MAX_ITEMS, maxPages = DISCOVERY_MAX_PAGES } = {},
): Promise<ManifestRef[]> {
  const out: ManifestRef[] = [];
  // 一番新しい出来事をもう見たもの（削除・移動で消えたものも含む）
  const decided = new Set<string>();
  const visited = new Set<string>();
  let page: unknown = typeOf(start) === 'OrderedCollectionPage' ? start : undefined;
  let pageId = page ? idOf(start) : idOf(start.last);

  while (pageId && visited.size < maxPages && out.length < maxItems && !visited.has(pageId)) {
    visited.add(pageId);
    if (!page) {
      try {
        page = await fetchJson(pageId);
      } catch (e) {
        if (visited.size === 1) throw e;
        break;
      }
    }
    if (!isObject(page)) break;
    const activities = asList(page.orderedItems);
    for (let i = activities.length - 1; i >= 0 && out.length < maxItems; i--) {
      const activity = activities[i];
      if (!isObject(activity)) continue;
      const type = typeOf(activity);
      if (type === 'Refresh') return out;
      const object = activity.object;
      const id = idOf(object);
      if (!id || !isManifest(object) || decided.has(id)) continue;
      decided.add(id);
      if (type === 'Create' || type === 'Update' || type === 'Add') {
        out.push({ id, label: labelOf(object) });
      } else if (type === 'Move') {
        const target = activity.target;
        const to = idOf(target);
        if (to && !decided.has(to)) {
          decided.add(to);
          out.push({ id: to, label: labelOf(target) ?? labelOf(object) });
        }
      }
      // Delete・Remove は載せない（decided に入れたので、それより古い出来事も無視される）
    }
    pageId = idOf(page.prev);
    page = undefined;
  }
  return out;
}

export const discoveryReader: SearchReader = {
  kind: 'discovery',
  accepts: (json) => /^OrderedCollection(Page)?$/.test(typeOf(json)),
  async read(json, { url, fetchJson, locale, onProgress, fetchOptions }) {
    if (!isObject(json)) return { label: '', items: [], failed: 0 };
    const refs = await recentManifests(json, fetchJson);
    const manifests = await fetchAllV3(
      refs.map((r) => r.id),
      fetchJson,
      { ...fetchOptions, onProgress },
    );
    const items = refs.map((ref, i): SearchItem => {
      const m = manifests.get(ref.id) ?? null;
      const item: SearchItem = {
        key: String(i + 1),
        label: labelIn(m?.label ?? ref.label, locale) || ref.id,
        metadata: m ? metadataRecordOf(m.metadata, locale) : {},
        target: { content: ref.id },
      };
      const thumb = m ? manifestThumbnail(m) : undefined;
      if (thumb) item.thumbnail = thumb;
      return item;
    });
    return { label: labelIn(json.label, locale) || str(json.summary) || url, items, failed: countFailed(manifests) };
  },
};
