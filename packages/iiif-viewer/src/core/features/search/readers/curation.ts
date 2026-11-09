// 読み手: キュレーション（CODH の Curation API 1.0、cr:Curation）。
// member ごとに 1 項目。member の metadata（顔貌コレクションなどがタグに使っている）をそのまま使う。
// サムネイルのために、元のマニフェストを取ってきて、Canvas の画像サービスから領域を切り出す。

import { labelIn } from '../../../services/paintedModels';
import { curationSelectionsOf, isCuration } from '../../curation';
import { asList, countFailed, fetchAllReporting, idOf, isObject, type Json } from '../json';
import { metadataRecordOf } from '../metadata';
import { canvasThumbnail, firstThumbnailId, regionOf } from '../thumbnails';
import type { ReadResult, SearchItem, SearchReader } from '../types';

/** selections の順に、member の元の JSON（metadata・thumbnail を読むため）を並べる。curationSelectionsOf と同じ順・同じ除外。 */
const rawMembersOf = (curation: unknown): unknown[][] =>
  asList(isObject(curation) ? curation.selections : undefined)
    .filter((s): s is Json => isObject(s) && Boolean(idOf(asList(s.within)[0])))
    .map((s) => (asList(s.members).length > 0 ? asList(s.members) : asList(s.canvases)).filter((m) => idOf(m)));

export const curationReader: SearchReader = {
  kind: 'curation',
  accepts: isCuration,
  async read(json, ctx) {
    const { url, locale } = ctx;
    const selections = curationSelectionsOf(json);
    const rawMembers = rawMembersOf(json);
    const urls = [...new Set(selections.filter((s) => s.readable && s.members.length > 0).map((s) => s.manifestUrl))];

    const build = (manifests: Map<string, Json | null>): ReadResult => {
      const canvases = new Map<string, Json>();
      for (const m of manifests.values()) {
        for (const c of asList(m?.items)) if (isObject(c) && typeof c.id === 'string') canvases.set(c.id, c);
      }

      const items: SearchItem[] = [];
      let pos = 0;
      selections.forEach((s, si) => {
        s.members.forEach((member, mi) => {
          // 番号は、ビューアの pos と揃えるため、読まない member（Timeline API 版など）も数える
          pos++;
          if (!s.readable) return;
          const raw = rawMembers[si]?.[mi];
          const canvas = canvases.get(member.canvasId);
          const item: SearchItem = {
            key: String(pos),
            label:
              labelIn(member.label, locale) || labelIn(s.label, locale) || labelIn(s.manifestLabel, locale) || member.canvasId,
            metadata: metadataRecordOf(isObject(raw) ? raw.metadata : undefined, locale),
            target: { content: url, pos },
          };
          const thumb =
            (isObject(raw) ? firstThumbnailId(raw.thumbnail) : undefined) ??
            (canvas ? canvasThumbnail(canvas, regionOf(member.id)) : undefined);
          if (thumb) item.thumbnail = thumb;
          items.push(item);
        });
      });
      return { label: labelIn(isObject(json) ? json.label : undefined, locale), items, failed: countFailed(manifests) };
    };

    return build(await fetchAllReporting(urls, ctx, build));
  },
};
