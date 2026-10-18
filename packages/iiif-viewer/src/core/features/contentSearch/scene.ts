// contentSearch（3D の Scene 版）: 窓口の当たりや手元の検索の当たりを、Scene の注釈（3D ビューアで選べるもの）に結びつける。
// 当たりの Annotation が Scene を指すとき、target は SpecificResource（source は Scene、selector は PointSelector）。
// React に依存しない。

import type { Annotation } from '../../types/main';
import { foldForSearch, type ContentSearchMatch, type ContentSearchRegion } from './index';

const SAME_POINT = 1e-6;

const samePoint = (a: [number, number, number], p: Annotation['position']): boolean =>
  Math.abs(a[0] - p.x) < SAME_POINT && Math.abs(a[1] - p.y) < SAME_POINT && Math.abs(a[2] - p.z) < SAME_POINT;

/** 当たりが Scene 上の点を指しているか（印を画像に重ねる対象ではない）。 */
export const isSceneMatch = (m: ContentSearchMatch): boolean => m.regions.length > 0 && m.regions.every((r) => !!r.point);

/**
 * 当たりに対応する Scene の注釈を探す。まず注釈の id が同じもの。窓口が別の id を返したときは、
 * 同じ Scene の同じ点（PointSelector の x・y・z）を指す注釈。見つからなければ undefined。
 */
export function findSceneAnnotation(
  match: Pick<ContentSearchMatch, 'canvasId' | 'regions'>,
  annotations: Annotation[],
): Annotation | undefined {
  for (const r of match.regions) {
    const byId = annotations.find((a) => a.id === r.annotationId);
    if (byId) return byId;
  }
  for (const r of match.regions) {
    if (!r.point) continue;
    const byPoint = annotations.find((a) => samePoint(r.point!, a.position));
    if (byPoint) return byPoint;
  }
  return undefined;
}

const CONTEXT_CHARS = 30;

/**
 * 窓口が無いとき、Scene の注釈（見出しと本文）から語を探す。1 つの注釈は 1 件の当たりにする
 * （最初に見つかった所を示す）。当たりの id は注釈の id にそろえる。
 */
export function searchSceneAnnotations(
  annotations: Annotation[],
  sceneId: string,
  q: string,
  maxMatches = 2000,
): ContentSearchMatch[] {
  const needle = foldForSearch(q.trim()).folded;
  if (!needle) return [];
  const out: ContentSearchMatch[] = [];
  for (const a of annotations) {
    // 見出し → 本文の順に探し、先に当たった方を示す
    for (const text of [a.title, a.description]) {
      if (!text) continue;
      const { folded, at } = foldForSearch(text);
      const hit = folded.indexOf(needle);
      if (hit < 0) continue;
      const start = at[hit];
      const end = at[hit + needle.length];
      const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
      const after = text.slice(end, end + CONTEXT_CHARS);
      const region: ContentSearchRegion = {
        annotationId: a.id,
        canvasId: sceneId,
        point: [a.position.x, a.position.y, a.position.z],
        text,
      };
      out.push({
        id: a.id,
        canvasId: sceneId,
        regions: [region],
        match: text.slice(start, end),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      });
      break;
    }
    if (out.length >= maxMatches) break;
  }
  return out;
}
