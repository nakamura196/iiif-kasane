import type { ComponentType } from 'react';
import type { ContainerInfo, ManifestV4 } from '../../core';
import type { ViewerActionsState } from '../Viewer';

// 表示 1 つ分の契約。新しい表示は、このファイルの型で 1 ファイルを足し、
// displays/registry.ts の一覧に 1 行足す。ほかの表示のファイルは触らない。
export interface DisplayProps {
  container: ContainerInfo;
  manifest: ManifestV4;
  /** URL of the shown manifest (after a move inside a Collection, the entry's URL, not the Collection's). */
  iiifContent: string;
  /** All containers of the manifest and the shown one (for paging, a table of contents). */
  containers: ContainerInfo[];
  selectedIndex: number;
  select: (index: number) => void;
  /** Extra controls the host app places over the view (the 3D display uses it). */
  renderActions?: (state: ViewerActionsState) => React.ReactNode;
}

export interface Display {
  id: string;
  /** The first display whose `match` is true shows the container. */
  match: (container: ContainerInfo) => boolean;
  Component: ComponentType<DisplayProps>;
}
