import type { ComponentType } from 'react';
import type { ContainerInfo, ManifestV4 } from '../../core';

// The contract of one tab of the right panel. A new tab adds one file to panels/ with these types
// (it joins the list by itself). Its text goes in Info.<id> of messages/features/<feature>.{ja,en}.json.
export interface PanelContext {
  container?: ContainerInfo;
  manifest?: ManifestV4 | null;
  /** Number of 3D annotations loaded (annotationsAtom). Used when no container is given (compare page). */
  annotationCount?: number;
  /** Number of annotation pages made in the browser (inference results etc.), not counting search marks. */
  localAnnotationCount?: number;
  /**
   * The shown manifest as served (before conversion), when `manifest` is the one shown in the viewer.
   * Tabs that need details the conversion drops read it.
   */
  rawManifest?: unknown;
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
