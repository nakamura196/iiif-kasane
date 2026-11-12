import { contentParam, type SearchTarget } from 'iiif-kasane/core';

/** 項目をビューアで開くリンク（キュレーションは pos で member を指す）。 */
export const viewerHref = (target: SearchTarget): string =>
  `/viewer?${contentParam(target.content)}${target.pos ? `&pos=${target.pos}` : ''}`;
