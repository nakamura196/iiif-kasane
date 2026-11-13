'use client';

import { createContext, useContext } from 'react';
import type { Xywh } from '../core';

// パネルから「この Canvas へ移動する」を呼ぶための口。
// 注釈のリンク本文が同じ資料の Canvas id のとき、クリックでそこへ移る。
export interface CanvasNavigation {
  /** Move to the Canvas with this id. Returns false when the id is not a Canvas of this item. */
  goToCanvas: (canvasId: string) => boolean;
}

const fallback: CanvasNavigation = { goToCanvas: () => false };

export const CanvasNavigationContext = createContext<CanvasNavigation>(fallback);
export const useCanvasNavigation = (): CanvasNavigation => useContext(CanvasNavigationContext);

/** Index of the container with this id, or -1. */
export const indexOfCanvas = (containers: ReadonlyArray<{ id: string }>, canvasId: string): number =>
  containers.findIndex((c) => c.id === canvasId);

/** The Canvas (and region) that the host page asks the viewer to show. */
export interface ViewerTarget {
  /** Canvas id, without a fragment. Without it: the Canvas being shown (useful with `t` alone). */
  canvasId?: string;
  /** Region in Canvas pixels: x, y, width, height. */
  xywh?: Xywh;
  /** false: zoom to the region without drawing a box around it. */
  highlight?: boolean;
  /** Time in seconds on an audio / video Canvas: the player moves there once it is ready. */
  t?: number;
  /** With `t`: start playing from there. The browser may refuse until the reader has used the page. */
  play?: boolean;
}

/** The shown Canvas, as reported to the host page. */
export interface ViewerSelection {
  canvasId: string;
  /** Index of the Canvas in the manifest. */
  index: number;
}

/** A key that changes only when the target points somewhere else. */
export const targetKey = (target: ViewerTarget | undefined): string =>
  target
    ? `${target.canvasId ?? ''}#${target.xywh?.join(',') ?? ''}#${target.highlight === false ? 0 : 1}#${target.t ?? ''}#${target.play ? 1 : 0}`
    : '';

/**
 * Whether the host page's `target` is applied now. It is applied once per shown manifest and target value,
 * except to a manifest shown again by going back with the same target: the reader returns to the page they were on.
 */
export function shouldApplyTarget(
  last: { manifestId: string; key: string } | null,
  now: { manifestId: string; key: string; restored: boolean },
): boolean {
  if (last && last.manifestId === now.manifestId && last.key === now.key) return false;
  if (now.restored && last?.key === now.key) return false;
  return true;
}
