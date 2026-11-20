'use client';

import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { regionInView, regionVolume, type ImageLayer } from '../../core';
import { pixelsPerUnit, visibleBoxOf } from '../overlays/annotationMarks';
import type { StageInfo } from './ImageView';
import { videoLayersPlayingAtom, videoLayersSoundAtom } from './videoLayerState';

// A video drawn as a layer of an image Canvas (recipe 0036 with a clip in place of an image): placed on its target,
// stacked, shown and given its opacity like the image layers. It loops without sound; it is put in the page only
// when it is near the view and big enough to see, and plays only while it is on screen. Its edges fade into the
// picture under it, and a video with an alpha channel (WebM) shows the picture through its transparent parts.

const pct = (v: number) => `${v * 100}%`;

// Edges fade over this share of the size, so the frame of a clip does not show as a hard line.
const FEATHER = '4%';
const MASK =
  `linear-gradient(to right, transparent, #000 ${FEATHER}, #000 calc(100% - ${FEATHER}), transparent), ` +
  `linear-gradient(to bottom, transparent, #000 ${FEATHER}, #000 calc(100% - ${FEATHER}), transparent)`;

// A video narrower than this on screen (CSS pixels) is left out: seen whole, a long scroll would load every clip
// while each is a few pixels wide. The picture under it shows the same place.
const MIN_SCREEN_WIDTH = 48;

export default function VideoLayerView({
  layer,
  canvasWidth,
  canvasHeight,
  stage,
  opacity,
}: {
  layer: ImageLayer;
  canvasWidth: number;
  canvasHeight: number;
  stage?: StageInfo;
  opacity: number;
}) {
  const playing = useAtomValue(videoLayersPlayingAtom);
  const sound = useAtomValue(videoLayersSoundAtom);
  const ref = useRef<HTMLVideoElement | null>(null);

  const region = layer.target ?? { x: 0, y: 0, w: canvasWidth, h: canvasHeight };
  const view = visibleBoxOf(stage, canvasWidth, canvasHeight);
  // within one view's size around the view
  const near = regionInView(region, visibleBoxOf(stage, canvasWidth, canvasHeight, 2));
  const big = region.w * pixelsPerUnit(stage, canvasWidth) >= MIN_SCREEN_WIDTH;
  const shown = near && big;
  const onScreen = shown && regionInView(region, view);
  const volume = sound ? regionVolume(region, view) : undefined;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = volume === undefined;
    if (volume !== undefined) el.volume = volume;
  }, [volume, shown]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing && onScreen) {
      el.play().catch(() => {
        // sound may be refused before a click on the page: play muted instead
        if (!el.muted) {
          el.muted = true;
          el.play().catch(() => {});
        }
      });
    } else el.pause();
  }, [playing, onScreen]);

  if (!shown) return null;
  return (
    <video
      ref={ref}
      src={layer.url}
      data-video-layer={layer.url}
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
      aria-hidden
      className="absolute pointer-events-none object-fill"
      style={{
        left: pct(region.x / canvasWidth),
        top: pct(region.y / canvasHeight),
        width: pct(region.w / canvasWidth),
        height: pct(region.h / canvasHeight),
        ...(opacity < 1 ? { opacity } : {}),
        maskImage: MASK,
        WebkitMaskImage: MASK,
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    />
  );
}
