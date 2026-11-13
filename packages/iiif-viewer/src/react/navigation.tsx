'use client';

import type { ShownOrigin } from './atoms';
import { createContext, useContext } from 'react';
import type { Xywh } from '../core';

// The way panels ask "move to this Canvas".
// When an annotation's link body is a Canvas id of the same item, a click moves there.
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
 * Whether the host page's `target` is applied now. A new target value is always applied. The same value is
 * applied again to another shown manifest only when it is the iiif-content ('content'), or an entry opened from it
 * ('move') that has the target's Canvas. A target without a Canvas (a region or a time only) is not carried into
 * entries, and going back ('back') keeps the page the reader was on.
 */
export function shouldApplyTarget(
  last: { manifestId: string; key: string } | null,
  now: { manifestId: string; key: string; origin: ShownOrigin; hasCanvas: boolean },
): boolean {
  if (!last || last.key !== now.key) return true;
  if (last.manifestId === now.manifestId) return false;
  if (now.origin === 'content') return true;
  return now.origin === 'move' && now.hasCanvas;
}

/** A value that belongs to one shown manifest (ShownManifest.seq): `fallback` once another one is shown. */
export const forShown = <T,>(v: { shown: number; value: T }, shown: number, fallback: T): T =>
  v.shown === shown ? v.value : fallback;
