'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Provider, createStore, useAtomValue, useSetAtom } from 'jotai';
import { containersOf, type ContainerInfo, type ManifestV4 } from '../core';
import { manifestAtom, modelChoicesAtom, shownManifestAtom } from './atoms';
import { navRequestAtom, nextSeq } from './displays/structureState';
import { ViewerEnv, type ResolvedTheme } from './env';
import {
  CanvasNavigationContext,
  indexOfCanvas,
  targetKey,
  type CanvasNavigation,
  type ViewerSelection,
  type ViewerTarget,
} from './navigation';
import { PlaybackContext, type Playback } from './playback';
import { useManifest } from './useManifest';

export interface ViewerProviderProps {
  /** URL of the IIIF manifest (or a IIIF Content State). */
  iiifContent: string;
  locale?: 'ja' | 'en';
  theme?: 'light' | 'dark' | 'auto';
  /**
   * The Canvas (and region) to show, set by the host page. The viewer moves there when the
   * manifest is loaded and whenever the value points somewhere else.
   */
  target?: ViewerTarget;
  /** Called when the shown Canvas changes: the first one, the page turns, and moves to `target`. */
  onSelect?: (selection: ViewerSelection) => void;
  /** Lighting of the 3D view (see `ViewerProps.environment`). */
  environment?: string;
  /**
   * Classes of the provider's element. The provider draws one `<div class="iiif-viewer">` around its
   * children: it carries the viewer's colors (--iiif-viewer-* variables), the dark theme and the
   * scope of the viewer's styles. Use it as the container of your layout, e.g. "grid grid-cols-2 h-96".
   */
  className?: string;
  children?: ReactNode;
}

/** What the parts inside a `ViewerProvider` share: the loaded manifest and the shown Canvas. */
export interface ViewerState {
  iiifContent: string;
  /**
   * URL of the manifest (or Collection) shown now: `iiifContent`, or the entry opened from a Collection.
   * Parts that read the source manifest again use this one.
   */
  shownUrl: string;
  /** null until the manifest is read. */
  manifest: ManifestV4 | null;
  /** The manifest could not be read. */
  failed: boolean;
  /** The Canvases / Scenes of the manifest. */
  containers: ContainerInfo[];
  /** Index of the shown one in `containers`. */
  selectedIndex: number;
  /** The shown Canvas / Scene (undefined while loading or for an empty manifest). */
  container: ContainerInfo | undefined;
  /** Show the container at this index. */
  select: (index: number) => void;
  resolvedTheme: ResolvedTheme;
}

const ViewerStateContext = createContext<ViewerState | null>(null);

/** The state of the surrounding `ViewerProvider`. Throws outside of one. */
export function useViewer(): ViewerState {
  const state = useContext(ViewerStateContext);
  if (!state) throw new Error('useViewer() must be used inside <ViewerProvider>.');
  return state;
}

/** Same as `useViewer()`, but null outside of a `ViewerProvider` (for parts that also work alone). */
export const useOptionalViewer = (): ViewerState | null => useContext(ViewerStateContext);

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

/**
 * Loads a manifest and holds the viewer's state (its own jotai store, the shown Canvas, the
 * playback position). It draws only one plain element around its children. Put `CanvasView`, `AnnotationList`, `Metadata`, …
 * inside it in any layout. `Viewer` is this provider with the default layout.
 */
export function ViewerProvider({
  iiifContent,
  locale = 'ja',
  theme = 'auto',
  target,
  onSelect,
  environment,
  className = '',
  children,
}: ViewerProviderProps) {
  const [store] = useState(() => createStore());
  const prefersDark = usePrefersDark(theme === 'auto');
  const resolvedTheme: ResolvedTheme = theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;

  return (
    <Provider store={store}>
      <ViewerEnv locale={locale} resolvedTheme={resolvedTheme} environment={environment}>
        <ViewerStateRoot iiifContent={iiifContent} target={target} onSelect={onSelect} resolvedTheme={resolvedTheme}>
          <div className={`iiif-viewer ${resolvedTheme === 'dark' ? 'dark' : ''} ${className}`.trim()}>{children}</div>
        </ViewerStateRoot>
      </ViewerEnv>
    </Provider>
  );
}

/**
 * Index of the shown container: the picked one while the same manifest is shown, else the first.
 * Kept within the containers.
 */
function pickedIndex(picked: { shown: number; index: number }, shownSeq: number, count: number): number {
  return Math.min(picked.shown === shownSeq ? picked.index : 0, Math.max(count - 1, 0));
}

function ViewerStateRoot({
  iiifContent,
  target,
  onSelect,
  resolvedTheme,
  children,
}: Pick<ViewerProviderProps, 'iiifContent' | 'target' | 'onSelect' | 'children'> & {
  resolvedTheme: ResolvedTheme;
}) {
  const manifest = useAtomValue(manifestAtom);
  const shown = useAtomValue(shownManifestAtom);
  const setModelChoices = useSetAtom(modelChoicesAtom);
  const { failed } = useManifest(iiifContent);

  const containers = useMemo(() => containersOf(manifest), [manifest]);
  // the page picked belongs to one shown manifest: a new one (another iiif-content, an entry of a Collection,
  // going back) starts from its first page (or where a content state / `target` / `start` sends it)
  const shownSeq = shown?.seq ?? 0;
  const [picked, setPicked] = useState<{ shown: number; index: number }>({ shown: shownSeq, index: 0 });
  const selected = pickedIndex(picked, shownSeq, containers.length);
  const container: ContainerInfo | undefined = containers[selected];

  // 動画・音声の再生位置。文字起こし（右パネル）と動画・音声の表示がこれで連動する。
  // 外から指定された時刻（target.t）。その Canvas の再生の部品が付いたときに、そこへ動かす。
  const pendingSeek = useRef<{ canvasId: string; t: number; play: boolean } | null>(null);
  const shownCanvas = useRef<string | undefined>(undefined);
  const [currentTime, setCurrentTime] = useState(0);
  const applySeek = (el: HTMLMediaElement | null) => {
    const p = pendingSeek.current;
    if (!el || !p || shownCanvas.current !== p.canvasId) return;
    pendingSeek.current = null;
    const go = () => {
      try {
        el.currentTime = p.t;
        setCurrentTime(p.t);
        if (p.play) void el.play()?.catch(() => {});
      } catch {
        /* the reader can still move the position by hand */
      }
    };
    // <video> / <audio> は長さが分かるまで動かせない。YouTube や合成の舞台の受け口は readyState を持たないので、すぐ動かす
    if (typeof el.readyState === 'number' && el.readyState < 1 && typeof el.addEventListener === 'function') {
      el.addEventListener('loadedmetadata', go, { once: true });
    } else go();
  };
  const applySeekRef = useRef(applySeek);
  useLayoutEffect(() => {
    shownCanvas.current = container?.id;
    applySeekRef.current = applySeek;
  });
  // 再生の部品（MediaView・YouTubeView・合成の舞台）は mediaRef.current に自分を入れる。入った時点で、待っている時刻へ動かす
  const mediaRef = useMemo(() => {
    let el: HTMLMediaElement | null = null;
    return {
      get current() {
        return el;
      },
      set current(v: HTMLMediaElement | null) {
        el = v;
        // 新しい Canvas の部品は、この部品の useLayoutEffect（shownCanvas の更新）より先に入るので、描画が終わってから見る
        if (v) queueMicrotask(() => applySeekRef.current(v));
      },
    };
  }, []);
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
    [currentTime, mediaRef],
  );

  const select = (index: number) => {
    setPicked({ shown: shownSeq, index });
    setModelChoices({});
    setCurrentTime(0);
  };

  const navigation = useMemo<CanvasNavigation>(
    () => ({
      goToCanvas: (canvasId: string) => {
        const index = indexOfCanvas(containers, canvasId);
        if (index < 0) return false;
        setPicked({ shown: shownSeq, index });
        setModelChoices({});
        setCurrentTime(0);
        return true;
      },
    }),
    [containers, shownSeq, setModelChoices],
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
    const canvasId = next.canvasId ?? shownId.current ?? containers[0].id;
    if (indexOfCanvas(containers, canvasId) < 0) {
      waitingFor.current = null;
      return;
    }
    if (next.t != null && Number.isFinite(next.t) && next.t >= 0) {
      pendingSeek.current = { canvasId, t: next.t, play: !!next.play };
    }
    if (next.canvasId == null && !next.xywh) {
      // 時刻だけの指定: 頁は動かさない。再生の部品がもう付いていれば、ここで動かす
      waitingFor.current = null;
      applySeekRef.current(mediaRef.current);
      return;
    }
    waitingFor.current = shownId.current === canvasId ? null : canvasId;
    setNavRequest({
      seq: nextSeq(),
      target: { canvasId, ...(next.xywh ? { xywh: next.xywh } : {}) },
      highlight: next.highlight,
    });
    if (shownId.current === canvasId) applySeekRef.current(mediaRef.current);
  }, [key, manifest, containers, setNavRequest, mediaRef]);

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

  const state: ViewerState = {
    iiifContent,
    shownUrl: shown?.url ?? iiifContent,
    manifest,
    failed,
    containers,
    selectedIndex: selected,
    container,
    select,
    resolvedTheme,
  };

  return (
    <ViewerStateContext.Provider value={state}>
      <PlaybackContext.Provider value={playback}>
        <CanvasNavigationContext.Provider value={navigation}>{children}</CanvasNavigationContext.Provider>
      </PlaybackContext.Provider>
    </ViewerStateContext.Provider>
  );
}
