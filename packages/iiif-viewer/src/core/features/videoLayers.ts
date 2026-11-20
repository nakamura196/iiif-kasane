// videoLayers: videos painted with the images of a Canvas (no React).
//
// Recipe 0036 builds one view from several images placed with "#xywh=". A video can take the place of one of
// them (for example AI-made clips that make some figures of a handscroll move). Such a video is read as a layer
// like the images (core/features/image.ts, `media: 'Video'`), so it is placed, stacked, shown and hidden with
// them (the Layers tab). What is here: when a Canvas is that kind of picture rather than a timeline, and how
// the clips play in the view.

import type { ImageRegion } from './image';
import { timelineOf } from './temporal';

/**
 * A picture made of images and videos with no time: the Canvas has no `duration`, no target has "#t=", it paints
 * only images and videos (no sound, no text), at least one of each. It is shown as a zoomable image with its
 * videos as layers, not on the timed stage (recipe 0489 and the like, which have a duration).
 */
export const isPictureWithVideo = (container: unknown): boolean => {
  const c = container && typeof container === 'object' ? (container as Record<string, unknown>) : null;
  if (!c || (c.duration != null && c.duration !== '')) return false;
  const timeline = timelineOf(c);
  if (!timeline || timeline.items.length === 0) return false;
  if (timeline.items.some((m) => m.timed || (m.kind !== 'Image' && m.kind !== 'Video'))) return false;
  return timeline.items.some((m) => m.kind === 'Image') && timeline.items.some((m) => m.kind === 'Video');
};

/** How loud a video is when its sound is on: full at the middle of the view, nothing far away (0–1). */
export const regionVolume = (
  region: ImageRegion,
  view: { x: number; y: number; w: number; h: number },
): number => {
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const vx = view.x + view.w / 2;
  const vy = view.y + view.h / 2;
  // distance in half-diagonals of the view: 0 at the middle, 1 at a corner
  const half = Math.hypot(view.w, view.h) / 2 || 1;
  const d = Math.hypot(cx - vx, cy - vy) / half;
  return Math.max(0, Math.min(1, 1 - d));
};

/** The region shares some area with the view. */
export const regionInView = (region: ImageRegion, view: { x: number; y: number; w: number; h: number }): boolean =>
  region.x < view.x + view.w && region.x + region.w > view.x && region.y < view.y + view.h && region.y + region.h > view.y;
