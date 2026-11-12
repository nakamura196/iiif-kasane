import { collectionDisplay } from './CollectionDisplay';
import { compositeDisplay } from './CompositeDisplay';
import { flatDisplay } from './FlatDisplay';
import { imageCanvasDisplay } from './ImageCanvasDisplay';
import { pagedDisplay } from './PagedDisplay';
import { sceneMissingDisplay } from './SceneMissingDisplay';
import type { ContainerInfo } from '../../core';
import type { Display } from './types';

// 上にあるものが先に当たる。専用の表示（ページ送り・合成など）は、flatDisplay より前に 1 行足す。
// - collection: Collection（マニフェストの一覧）
// - composite: 1 つの Canvas に、時間でつながる複数のメディア
// - paged: Canvas / Timeline（ページ送り・見開き。1 枚だけのときは imageCanvas に任せる）
// - imageCanvas: 画像の深いズーム・回転・重ね表示など。画像以外は、次に当たる表示に任せる
// - scene: 3D のモデル。既定は案内だけで、iiif-kasane/scene を import すると本物に差し替わる
//   （three.js などの 3D の部品を、3D を使わないサイトに入れさせないため）
export const DISPLAYS: Display[] = [
  collectionDisplay,
  compositeDisplay,
  pagedDisplay,
  imageCanvasDisplay,
  sceneMissingDisplay,
  flatDisplay,
];

/** 同じ id の表示を差し替える。無ければ flatDisplay（最後の受け皿）の前に足す。 */
export function registerDisplay(display: Display): void {
  const i = DISPLAYS.findIndex((d) => d.id === display.id);
  if (i >= 0) DISPLAYS[i] = display;
  else DISPLAYS.splice(DISPLAYS.indexOf(flatDisplay), 0, display);
}

/** `after` の表示より後ろで、container に当たる最初の表示。 */
export const displayAfter = (after: string, container: ContainerInfo): Display | undefined => {
  const i = DISPLAYS.findIndex((d) => d.id === after);
  return DISPLAYS.slice(i + 1).find((d) => d.match(container));
};
