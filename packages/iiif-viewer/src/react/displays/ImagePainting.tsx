'use client';

import type { ContainerInfo, MediaOption } from '../../core';
import { labelIn } from '../../core';
import { useContentLocale } from '../env';
import ImageView from './ImageView';

// 画像 1 枚（選ばれた中身）の表示。FlatDisplay が使う単純な形で、重ね表示の層も載せる。
// Image API の深いズーム・合成・回転は ImageCanvasDisplay（Canvas 全体を読む表示）が行う。
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
