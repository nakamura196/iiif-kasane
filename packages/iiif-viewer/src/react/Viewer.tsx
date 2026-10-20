'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Provider, createStore, useAtomValue, useSetAtom } from 'jotai';
import { containersOf, type ContainerInfo } from '../core';
import { manifestAtom, modelChoicesAtom } from './atoms';
import ContainerList from './ContainerList';
import { DISPLAYS } from './displays/registry';
import { ViewerEnv, useTranslations, type ResolvedTheme } from './env';
import Info, { type InfoTab } from './layout/panels/Info';
import SidePanel from './layout/SidePanel';
import { navRequestAtom, nextSeq } from './displays/structureState';
import {
  CanvasNavigationContext,
  indexOfCanvas,
  targetKey,
  type CanvasNavigation,
  type ViewerSelection,
  type ViewerTarget,
} from './navigation';
import type { Panel } from './panels/types';
import { PlaybackContext, type Playback } from './playback';
import { useManifest } from './useManifest';

export interface ViewerActionsState {
  iiifContent: string;
  /** The main model (or, on an image Canvas, an image) has two or more candidates (a Choice). */
  hasChoices: boolean;
  /** Index of the shown Canvas / Scene in the manifest. */
  selectedIndex: number;
}

export interface ViewerProps {
  /** URL of the IIIF manifest. */
  iiifContent: string;
  locale?: 'ja' | 'en';
  theme?: 'light' | 'dark' | 'auto';
  /** Controlled side panel tab. Without it the viewer keeps the tab itself. */
  tab?: InfoTab;
  onTabChange?: (tab: InfoTab) => void;
  /** Extra controls placed next to the model choice (bottom left of the 3D view). */
  renderActions?: (state: ViewerActionsState) => ReactNode;
  /** Extra side panel tabs from the host page (e.g. links to its other pages). */
  panels?: Panel[];
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
  className?: string;
}

function usePrefersDark(enabled: boolean): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [enabled]);
  return dark;
}

function ViewerBody({
  iiifContent,
  tab,
  onTabChange,
  renderActions,
  panels,
  target,
  onSelect,
  panelOpen,
  pager,
  className = '',
  dark,
}: Pick<
  ViewerProps,
  'iiifContent' | 'tab' | 'onTabChange' | 'renderActions' | 'panels' | 'target' | 'onSelect' | 'panelOpen' | 'pager' | 'className'
> & {
  dark: boolean;
}) {
  const t = useTranslations('Viewer');
  const manifest = useAtomValue(manifestAtom);
  const setModelChoices = useSetAtom(modelChoicesAtom);
  const { failed } = useManifest(iiifContent);

  const containers = useMemo(() => containersOf(manifest), [manifest]);
  const [picked, setPicked] = useState<{ content: string; index: number }>({ content: iiifContent, index: 0 });
  const selected = Math.min(picked.content === iiifContent ? picked.index : 0, Math.max(containers.length - 1, 0));
  const container: ContainerInfo | undefined = containers[selected];

  // 動画・音声の再生位置。文字起こし（右パネル）と動画・音声の表示がこれで連動する。
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const playback = useMemo<Playback>(
    () => ({
      mediaRef,
      currentTime,
      setCurrentTime,
      seek: (seconds: number) => {
        if (mediaRef.current) mediaRef.current.currentTime = seconds;
        setCurrentTime(seconds);
      },
    }),
    [currentTime],
  );

  const select = (index: number) => {
    setPicked({ content: iiifContent, index });
    setModelChoices({});
    setCurrentTime(0);
  };

  const navigation = useMemo<CanvasNavigation>(
    () => ({
      goToCanvas: (canvasId: string) => {
        const index = indexOfCanvas(containers, canvasId);
        if (index < 0) return false;
        setPicked({ content: iiifContent, index });
        setModelChoices({});
        setCurrentTime(0);
        return true;
      },
    }),
    [containers, iiifContent, setModelChoices],
  );

  // 外（使う側のページ）から指定された Canvas・範囲へ移る。マニフェストが読めてから、値が変わったときだけ。
  // 移り終わるまでは、途中で出た最初の頁（start など）を onSelect で知らせない。
  // 知らせると、使う側がそれを target に戻して、指定した頁に着かなくなるため。
  const setNavRequest = useSetAtom(navRequestAtom);
  const key = targetKey(target);
  const targetRef = useRef(target);
  const onSelectRef = useRef(onSelect);
  const shownId = useRef<string | undefined>(undefined);
  useEffect(() => {
    targetRef.current = target;
    onSelectRef.current = onSelect;
    shownId.current = container?.id;
  });
  const appliedTarget = useRef<string | null>(null);
  const waitingFor = useRef<string | null>(null);
  useEffect(() => {
    const next = targetRef.current;
    if (!next || !manifest || containers.length === 0) {
      if (!next) waitingFor.current = null;
      return;
    }
    const applied = `${manifest.id}|${key}`;
    if (appliedTarget.current === applied) return;
    appliedTarget.current = applied;
    if (indexOfCanvas(containers, next.canvasId) < 0) {
      waitingFor.current = null;
      return;
    }
    waitingFor.current = shownId.current === next.canvasId ? null : next.canvasId;
    setNavRequest({
      seq: nextSeq(),
      target: { canvasId: next.canvasId, ...(next.xywh ? { xywh: next.xywh } : {}) },
      highlight: next.highlight,
    });
  }, [key, manifest, containers, setNavRequest]);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!container || !manifest) return;
    if (waitingFor.current) {
      if (container.id !== waitingFor.current) return;
      waitingFor.current = null;
    }
    const shown = `${manifest.id}|${container.id}`;
    if (reported.current === shown) return;
    reported.current = shown;
    onSelectRef.current?.({ canvasId: container.id, index: selected });
  }, [container, manifest, selected]);

  const display = container ? DISPLAYS.find((d) => d.match(container)) : undefined;

  let view: ReactNode;
  if (failed) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]" role="alert">{t('manifestError')}</div>;
  } else if (!manifest) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]">{t('loadingManifest')}</div>;
  } else if (!container) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]">{t('empty')}</div>;
  } else if (!display) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]">{t('unsupportedContent')}</div>;
  } else {
    view = (
      <display.Component
        container={container}
        manifest={manifest}
        iiifContent={iiifContent}
        containers={containers}
        selectedIndex={selected}
        select={select}
        renderActions={renderActions}
      />
    );
  }

  return (
    <PlaybackContext.Provider value={playback}>
      <CanvasNavigationContext.Provider value={navigation}>
      <div className={`flex flex-col sm:flex-row w-full ${dark ? 'dark' : ''} ${className}`.trim()}>
        <div className="flex-1 min-h-0 min-w-0 sm:h-full flex flex-col bg-gray-100 dark:bg-gray-900">
          <ContainerList containers={containers} selected={selected} onSelect={select} pager={pager} />
          {display && container ? view : <div className="relative flex-1 min-h-0 min-w-0">{view}</div>}
        </div>
        <SidePanel
          initialOpen={panelOpen}
          className="bg-[var(--ds-surface)] shadow-lg overflow-y-auto border-t sm:border-t-0 sm:border-l border-[var(--ds-border)]"
        >
          <Info tab={tab} onTabChange={onTabChange} container={container} manifest={manifest} extraPanels={panels} />
        </SidePanel>
      </div>
      </CanvasNavigationContext.Provider>
    </PlaybackContext.Provider>
  );
}

/**
 * The IIIF 3D viewer: 3D view, model choice, annotation toggle, and the side
 * panel (metadata / annotations). It owns its jotai store, so several viewers
 * (or a surrounding app's own store) do not interfere.
 */
export function Viewer({
  iiifContent,
  locale = 'ja',
  theme = 'auto',
  tab,
  onTabChange,
  renderActions,
  panels,
  target,
  onSelect,
  panelOpen,
  pager,
  className,
}: ViewerProps) {
  const [store] = useState(() => createStore());
  const prefersDark = usePrefersDark(theme === 'auto');
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;

  return (
    <Provider store={store}>
      <ViewerEnv locale={locale} resolvedTheme={resolvedTheme}>
        <ViewerBody
          iiifContent={iiifContent}
          tab={tab}
          onTabChange={onTabChange}
          renderActions={renderActions}
          panels={panels}
          target={target}
          onSelect={onSelect}
          panelOpen={panelOpen}
          pager={pager}
          className={className}
          dark={resolvedTheme === 'dark'}
        />
      </ViewerEnv>
    </Provider>
  );
}
