// Canvas に重ねて描かれた画像を「レイヤー」として扱う。表示・非表示、不透明度、重ね順。
// 合成（recipe 0036）の画像も、Choice（0033・0326）の候補も、1 枚ずつのレイヤーにする（Mirador の Layers と同じ考え方）。
// Choice の候補は、初めは 1 つ目だけを表示する。読む人が残りを重ねて透かし見られる。

import type { PaintingContent } from '../services/containers';
import type { CanvasPainting, ImageLayer } from './image';

export interface LayerItem {
  /** Unique on the Canvas: the painting id, plus the option number for a Choice. */
  id: string;
  paintingId: string;
  optionIndex: number;
  /** One of the options of a Choice. */
  choice: boolean;
  label: unknown;
  layer: ImageLayer;
}

/** What the reader changed. Absent fields: the default. */
export interface LayerSetting {
  visible?: boolean;
  /** 0 to 1. */
  opacity?: number;
}

/** The image layers of a Canvas, bottom first (painting order: later paintings are drawn on top). */
export const layerItemsOf = (paintings: CanvasPainting[]): LayerItem[] =>
  paintings.flatMap((p) => {
    const choice = p.options.length > 1;
    return p.options.flatMap((o, j) =>
      o.layer
        ? [
            {
              id: choice ? `${p.id}::${j}` : p.id,
              paintingId: p.id,
              optionIndex: j,
              choice,
              label: o.label ?? (choice ? undefined : p.label),
              layer: o.layer,
            },
          ]
        : [],
    );
  });

export const defaultVisible = (item: LayerItem): boolean => !item.choice || item.optionIndex === 0;

export const isLayerVisible = (item: LayerItem, settings: Record<string, LayerSetting>): boolean =>
  settings[item.id]?.visible ?? defaultVisible(item);

export const layerOpacity = (item: LayerItem, settings: Record<string, LayerSetting>): number => {
  const o = settings[item.id]?.opacity;
  return o === undefined || !Number.isFinite(o) ? 1 : Math.min(1, Math.max(0, o));
};

/**
 * The items in the reader's order (bottom first). Ids in `order` come in that order; items it does
 * not name keep their place relative to the default order.
 */
export const orderLayers = (items: LayerItem[], order: string[] | undefined): LayerItem[] => {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = items.filter((it) => rank.has(it.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let k = 0;
  return items.map((it) => (rank.has(it.id) ? known[k++] : it));
};

/** Moves `id` to position `to` (0 = bottom) in the order of `ids` (bottom first). */
export const moveLayer = (ids: string[], id: string, to: number): string[] => {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const out = ids.slice();
  out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
};

/** How many images a Canvas can show as layers (decides whether the Layers tab is offered). */
export const imageLayerCount = (painting: PaintingContent[]): number =>
  painting.reduce((n, p) => n + p.options.filter((o) => o.kind === 'Image').length, 0);

/**
 * How many layers a Canvas has: its images, and the videos painted with them (recipe 0036 with a clip in place of
 * an image). Decides whether the Layers tab is offered. A video in a Choice, or on a Canvas without an image, is not one.
 */
export const layerCountOf = (painting: PaintingContent[]): number => {
  const images = imageLayerCount(painting);
  if (images === 0) return 0;
  return images + painting.filter((p) => p.options.length === 1 && p.options[0].kind === 'Video').length;
};

// 再生: 重ねた画像を段ごとに見せる。2 つの向きがある。
// - 組み立て（build）: いちばん奥から始め、段ごとに手前の画像を足していく（起こし絵図を起こしていく見せ方）
// - 取り外し（peel）: すべてを重ねた状態から始め、手前の段から隠していく
// 段は、ふつうは画像 1 枚ずつ。画像のファイル名が「…_003_1.tif」のように「段_番号」になっていれば、
// 同じ段の画像をまとめて 1 段にする（東京大学の起こし絵図 utda/kaishi がこの名付け。段の情報は
// マニフェストに無いので、名前から読む）。

export type PlaybackDirection = 'build' | 'peel';

// 「_003_1.tif」「-3-12.jpg」: 末尾の 2 つの数のうち前のほうが段
const STEP_IN_NAME = /[_-](\d+)[_-]\d+\.[a-z0-9]+$/i;

/** The step number a file name gives, or null. */
export const stepInName = (url: string): number | null => {
  const path = url.split(/[?#]/)[0];
  const m = STEP_IN_NAME.exec(decodeURIComponent(path.split('/').pop() ?? ''));
  return m ? Number(m[1]) : null;
};

const nameOf = (item: LayerItem): string => item.layer.service?.id ?? item.layer.url;

/**
 * The playback step of each layer (bottom first): 0, 1, 2 … , never decreasing. Layers next to each
 * other whose file names give the same step share one. Used only when every layer but the bottom
 * one has such a name; otherwise every layer is a step of its own.
 */
export const playbackGroups = (items: LayerItem[]): number[] => {
  const steps = items.map((it) => stepInName(nameOf(it)));
  const named = steps.slice(1).every((n) => n !== null) && steps.length > 1;
  if (!named) return items.map((_, i) => i);
  const out: number[] = [];
  steps.forEach((n, i) => {
    out.push(i === 0 ? 0 : n !== null && n === steps[i - 1] ? out[i - 1] : out[i - 1] + 1);
  });
  return out;
};

/** How many steps a playback with these groups has. */
export const playbackStepCount = (groups: number[]): number => (groups.length ? groups[groups.length - 1] + 1 : 0);

/** The step after `step` in a playback of `count` steps; null when it has ended. */
export const nextPlaybackStep = (step: number, count: number, loop: boolean): number | null =>
  step + 1 < count ? step + 1 : loop && count > 1 ? 0 : null;

/**
 * `settings` with the layers of `ids` (bottom first, in steps `groups`) shown or hidden as at
 * playback step `step`. Build: the steps up to `step` are shown. Peel: the front `step` steps are hidden.
 */
export const playbackSettings = (
  settings: Record<string, LayerSetting>,
  ids: string[],
  groups: number[],
  step: number,
  direction: PlaybackDirection,
): Record<string, LayerSetting> => {
  const count = playbackStepCount(groups);
  return {
    ...settings,
    ...Object.fromEntries(
      ids.map((id, i) => [
        id,
        { ...settings[id], visible: direction === 'build' ? groups[i] <= step : groups[i] < count - step },
      ]),
    ),
  };
};
