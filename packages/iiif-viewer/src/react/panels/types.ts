import type { ComponentType } from 'react';
import type { ContainerInfo, ManifestV4 } from '../../core';
import type { ShownManifest } from '../atoms';

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
   * The manifest shown in the viewer (its URL, the JSON as served, how it came to be shown), when `manifest`
   * is that one. Tabs that link to the shown item or need details the conversion drops read it.
   */
  shown?: ShownManifest;
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
