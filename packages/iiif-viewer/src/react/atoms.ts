import { atom } from 'jotai';
import type { ManifestV4 } from '../core';
import type { PaintedModel } from '../core';
import type { Annotation, InfoPanelContent, Annotation3 } from '../core';
import { EMPTY_FILTER, filterAnnotations, type AnnotationFilter } from '../core';
import type { LayerItem, LayerSetting, PlaybackDirection } from '../core';

export const infoPanelAtom = atom<InfoPanelContent | null>(null);

export const manifestAtom = atom<ManifestV4 | null>(null);

export const annotationsAtom = atom<Annotation[]>([]);

// Scene に置かれた 3D モデル（Choice は候補ごと）と、Choice で選ばれている候補の番号
export const paintedModelsAtom = atom<PaintedModel[]>([]);
export const modelChoicesAtom = atom<Record<string, number>>({});

// 表示中の Scene の id（null は最初の Scene）。注釈・初めの視点・カメラのボタンはこの Scene から読む
export const sceneIdAtom = atom<string | null>(null);

// 主のモデル（GLB）に入っているアニメーション。clips はクリップの数（0 なら再生ボタンを出さない）
export const modelAnimationAtom = atom<{ clips: number; playing: boolean }>({ clips: 0, playing: true });

// 画像の Canvas に重なったレイヤー。表示中の Canvas の一覧（右パネルのタブが読む）と、
// 読む人が変えた表示・不透明度（レイヤーの id ごと）と重ね順（Canvas の id ごと、下から）
export const canvasLayersAtom = atom<{ canvasId: string; items: LayerItem[] } | null>(null);
export const layerSettingsAtom = atom<Record<string, LayerSetting>>({});
export const layerOrderAtom = atom<Record<string, string[]>>({});

// 画像の Choice をその場で見比べる（Choice のバーで選ぶ）。single は比較しない。
// b は B 側の候補の番号（painting の id ごと）。Canvas を移っても表示のしかたは保つ（表と裏を同じ見方で見る）
export type ChoiceCompareMode = 'single' | 'swipe' | 'spyglass' | 'overlay' | 'side';
export const choiceCompareAtom = atom<{ mode: ChoiceCompareMode; b: Record<string, number>; opacity: number }>({
  mode: 'single',
  b: {},
  opacity: 0.5,
});

// レイヤーの再生。右パネルの別のタブに移っても止まらないよう、タブの外に置く。
// タイマーは画像の表示（ImageCanvasDisplay）が動かす。ids は再生するレイヤー（下から）、groups はその段
export interface LayerPlayback {
  canvasId: string;
  ids: string[];
  groups: number[];
  direction: PlaybackDirection;
  step: number;
}
export const layerPlaybackAtom = atom<LayerPlayback | null>(null);
// 再生の間隔（秒）・繰り返し・向き（組み立て／取り外し）
export const layerPlaybackOptionsAtom = atom<{ seconds: number; loop: boolean; direction: PlaybackDirection }>({
  seconds: 1,
  loop: true,
  direction: 'build',
});

// 一覧の検索・絞り込みの条件。3D の印もこの結果だけを表示する
export const annotationFilterAtom = atom<AnnotationFilter>(EMPTY_FILTER);

export const visibleAnnotationsAtom = atom((get) =>
  filterAnnotations(get(annotationsAtom), get(annotationFilterAtom)),
);

export const annotationsAtom3 = atom<Annotation3[]>([]);

// 選択中のアノテーションIDのアトム
export const selectedAnnotationIdAtom = atom<string | null>(null);

// The URL first given to the viewer (iiif-content). It stays the same while moving inside a Collection
export const manifestUrlAtom = atom<string | null>(null);

/**
 * The manifest (or Collection) shown now, as one value: its URL, the JSON as served (before convertToV4,
 * which drops the Image API service and other details that the displays need) and the converted one.
 * `seq` grows by one each time something is shown, so parts can tell a new manifest from the same one shown again.
 */
export interface ShownManifest {
  url: string;
  raw: unknown;
  manifest: ManifestV4;
  seq: number;
}
export const shownManifestAtom = atom<ShownManifest | null>(null);

// アノテーション表示/非表示のアトム
export const showAnnotationsAtom = atom<boolean>(true);

// 主モデルの外接球の半径（モデルの単位のまま）。ズームボタンの距離の制限に使う
export const modelRadiusAtom = atom<number | null>(null);

// 3D の床の格子。閲覧の邪魔になるので既定では出さず、ボタンで出す
export const showGridAtom = atom<boolean>(false);

// 3D の「測る」が入っているか。入っている間、モデルのクリックは距離の計測に使い、注釈の印は隠す
export const measuringAtom = atom<boolean>(false);
