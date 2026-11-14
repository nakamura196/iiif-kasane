'use client';

import type { ReactNode } from 'react';
import { CanvasView } from './CanvasView';
import Info, { type InfoTab } from './layout/panels/Info';
import SidePanel from './layout/SidePanel';
import type { ViewerSelection, ViewerTarget } from './navigation';
import type { Panel } from './panels/types';
import { ViewerProvider, useViewer, type ViewerProviderProps } from './ViewerProvider';

export interface ViewerActionsState {
  /** The iiif-content given to the viewer. */
  iiifContent: string;
  /** URL of the manifest shown now (the entry opened from a Collection); `selectedIndex` counts in it. */
  shownUrl?: string;
  /** The main model (or, on an image Canvas, an image) has two or more candidates (a Choice). */
  hasChoices: boolean;
  /** Index of the shown Canvas / Scene in the manifest. */
  selectedIndex: number;
}

export interface ViewerProps {
  /** URL of the IIIF manifest. */
  iiifContent: string;
  /** The Collections walked through to reach `iiifContent`, top first (see `ViewerProviderProps.collection`). */
  collection?: ViewerProviderProps['collection'];
  /** Called each time a manifest (or Collection) is shown (see `ViewerProviderProps.onShownChange`). */
  onShownChange?: ViewerProviderProps['onShownChange'];
  locale?: 'ja' | 'en';
  theme?: 'light' | 'dark' | 'auto';
  /** Controlled side panel tab. Without it the viewer keeps the tab itself. */
  tab?: InfoTab;
  onTabChange?: (tab: InfoTab) => void;
  /** Extra controls placed next to the model choice (bottom left of the 3D view). */
  renderActions?: (state: ViewerActionsState) => ReactNode;
  /** Extra side panel tabs from the host page (e.g. links to its other pages). */
  panels?: Panel[];
  /** Ids of the viewer's own side panel tabs not to show (e.g. a host page that puts the puzzle in a tab of its own). */
  hidePanels?: string[];
  /**
   * The Canvas (and region) to show, set by the host page. The viewer moves there when the
   * manifest is loaded and whenever the value points somewhere else. In between, the reader can
   * still turn the pages.
   */
  target?: ViewerTarget;
  /** Called when the shown Canvas changes: the first one, the page turns, and moves to `target`. */
  onSelect?: (selection: ViewerSelection) => void;
  /**
   * Whether the side panel (metadata etc.) starts open. Without it the viewer uses the reader's
   * last choice, or opens it on wide screens. The reader can still open and close it.
   */
  panelOpen?: boolean;
  /**
   * false: hide the previous / next buttons above the image, for a host page that turns the pages
   * itself (through `target`). The arrow keys still turn the pages, and `onSelect` still reports them.
   */
  pager?: boolean;
  /**
   * Lighting of the 3D view. "built-in" (default) draws a small studio-like environment inside the
   * viewer, with no network request. "none" uses plain lights only. A drei preset name ("city", ...)
   * is fetched from drei's CDN (raw.githack.com). Any other value is the URL of an .hdr / .exr file.
   */
  environment?: string;
  className?: string;
}

function ViewerLayout({
  tab,
  onTabChange,
  renderActions,
  panels,
  hidePanels,
  panelOpen,
  pager,
}: Pick<ViewerProps, 'tab' | 'onTabChange' | 'renderActions' | 'panels' | 'hidePanels' | 'panelOpen' | 'pager'>) {
  const { manifest, container } = useViewer();
  return (
    <>
      <CanvasView pager={pager} renderActions={renderActions} className="flex-1 sm:h-full" />
      <SidePanel
        initialOpen={panelOpen}
        className="bg-[var(--ds-surface)] shadow-lg overflow-y-auto border-t sm:border-t-0 sm:border-l border-[var(--ds-border)]"
      >
        <Info
          tab={tab}
          onTabChange={onTabChange}
          container={container}
          manifest={manifest}
          extraPanels={panels}
          hiddenPanels={hidePanels}
        />
      </SidePanel>
    </>
  );
}

/**
 * The IIIF viewer: `ViewerProvider` with the default layout (the shown Canvas on the left, the
 * side panel with metadata / annotations / … on the right). It owns its jotai store, so several
 * viewers (or a surrounding app's own store) do not interfere. For another layout, use
 * `ViewerProvider` with `CanvasView`, `AnnotationList`, `Metadata`, … directly.
 */
export function Viewer({
  iiifContent,
  collection,
  onShownChange,
  locale = 'ja',
  theme = 'auto',
  target,
  onSelect,
  environment,
  className = '',
  ...layout
}: ViewerProps) {
  return (
    <ViewerProvider
      iiifContent={iiifContent}
      collection={collection}
      onShownChange={onShownChange}
      locale={locale}
      theme={theme}
      target={target}
      onSelect={onSelect}
      environment={environment}
      className={`flex flex-col sm:flex-row w-full ${className}`.trim()}
    >
      <ViewerLayout {...layout} />
    </ViewerProvider>
  );
}
