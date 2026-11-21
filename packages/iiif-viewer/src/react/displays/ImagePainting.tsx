'use client';

import type { ContainerInfo, MediaOption } from '../../core';
import { labelIn } from '../../core';
import { useContentLocale } from '../env';
import ImageView from './ImageView';

// Shows one image (the chosen content). The simple form that FlatDisplay uses; it also carries the layers of an overlay.
// Deep zoom, compositing and rotation with the Image API are done by ImageCanvasDisplay (the display that reads the whole Canvas).
export default function ImagePainting({ container, option }: { container: ContainerInfo; option: MediaOption }) {
  const locale = useContentLocale();
  return (
    <ImageView
      key={option.url}
      src={option.url}
      alt={labelIn(container.label, locale)}
      canvasWidth={container.width}
      canvasHeight={container.height}
      container={container}
    />
  );
}
