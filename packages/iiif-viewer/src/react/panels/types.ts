import type { ComponentType } from 'react';
import type { ContainerInfo, ManifestV4 } from '../../core';

// 右パネルのタブ 1 つ分の契約。新しいタブは、このファイルの型で panels/ に 1 ファイルを足す
// （一覧には自動で入る）。文言は messages/features/<機能>.{ja,en}.json の Info.<id> に書く。
export interface PanelContext {
  container?: ContainerInfo;
  manifest?: ManifestV4 | null;
  /** Number of 3D annotations loaded (annotationsAtom). Used when no container is given (compare page). */
  annotationCount?: number;
  /** Number of annotation pages made in the browser (inference results etc.), not counting search marks. */
  localAnnotationCount?: number;
  /** Number of annotation pages made in the browser and shown on this container's image, not counting search marks. */
  containerLocalAnnotationCount?: number;
}

export interface Panel {
  id: string;
  /** Tab position, smaller first. Without it the tab goes after the numbered ones. */
  order?: number;
  /** Tab name. Without it the name comes from Info.<id> in the viewer's messages (tabs added by the host page give their own). */
  label?: string;
  /** Whether the tab is shown for this container. */
  available: (ctx: PanelContext) => boolean;
  Component: ComponentType<PanelContext>;
}
