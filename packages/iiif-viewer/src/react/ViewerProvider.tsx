'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Provider, createStore, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { containersOf, type ContainerInfo, type ManifestV4 } from '../core';
import { manifestAtom, modelChoicesAtom, shownManifestAtom } from './atoms';
import { navRequestAtom, nextSeq, pickedPageAtom } from './displays/structureState';
import { ViewerEnv, type ResolvedTheme } from './env';
import {
  CanvasNavigationContext,
  indexOfCanvas,
  forShown,
  shouldApplyTarget,
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
  // the page picked belongs to one shown manifest: a new one (another iiif-content, an entry of a Collection)
  // starts from its first page (or where a content state / `target` / `start` sends it); going back restores
  // the page the reader was on. It is in the store so that the trail can keep it.
  const shownSeq = shown?.seq ?? 0;
  const [picked, setPicked] = useAtom(pickedPageAtom);
  const selected = pickedIndex(picked, shownSeq, containers.length);
  const container: ContainerInfo | undefined = containers[selected];

  // The playback position of video and audio. The transcript (right panel) and the media display follow it.
  // A time given from outside (target.t) is applied when the player of that Canvas is attached.
  // Both belong to the shown manifest: another one shown (an entry, going back) starts at 0 with nothing waiting.
  const pendingSeek = useRef<{ shown: number; value: { canvasId: string; t: number; play: boolean } } | null>(null);
  const shownCanvas = useRef<string | undefined>(undefined);
  const shownSeqRef = useRef(shownSeq);
  const [time, setTime] = useState({ shown: shownSeq, value: 0 });
  const currentTime = forShown(time, shownSeq, 0);
  const setCurrentTime = useCallback((t: number) => setTime({ shown: shownSeqRef.current, value: t }), []);
  const applySeek = (el: HTMLMediaElement | null) => {
    const waiting = pendingSeek.current;
    const p = waiting ? forShown(waiting, shownSeqRef.current, null) : null;
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
    // <video> / <audio> cannot seek before the duration is known. YouTube and the composite stage have no readyState, so seek at once
    if (typeof el.readyState === 'number' && el.readyState < 1 && typeof el.addEventListener === 'function') {
      el.addEventListener('loadedmetadata', go, { once: true });
    } else go();
  };
  const applySeekRef = useRef(applySeek);
  useLayoutEffect(() => {
    shownCanvas.current = container?.id;
    shownSeqRef.current = shownSeq;
    applySeekRef.current = applySeek;
  });
  // Players (MediaView, YouTubeView, the composite stage) put themselves in mediaRef.current; then the waiting time is applied
  const mediaRef = useMemo(() => {
    let el: HTMLMediaElement | null = null;
    return {
      get current() {
        return el;
      },
      set current(v: HTMLMediaElement | null) {
        el = v;
        // the player of a new Canvas arrives before this component's useLayoutEffect (which updates shownCanvas), so check after rendering
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
    [currentTime, setCurrentTime, mediaRef],
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
    [containers, shownSeq, setPicked, setModelChoices, setCurrentTime],
  );

  // Move to the Canvas / region given by the host page: once the manifest is read, and when the value changes.
  // Until the move is done, the first page shown on the way (start etc.) is not reported through onSelect:
  // the host would put it back into target, and the viewer would never reach the page asked for.
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
  const appliedTarget = useRef<{ manifestId: string; key: string } | null>(null);
  const origin = shown && shown.manifest === manifest ? shown.origin : 'content';
  const waitingFor = useRef<string | null>(null);
  useEffect(() => {
    const next = targetRef.current;
    if (!next || !manifest || containers.length === 0) {
      if (!next) waitingFor.current = null;
      return;
    }
    const now = { manifestId: manifest.id, key, origin, hasCanvas: next.canvasId != null };
    const apply = shouldApplyTarget(appliedTarget.current, now);
    appliedTarget.current = { manifestId: manifest.id, key };
    if (!apply) return;
    const canvasId = next.canvasId ?? shownId.current ?? containers[0].id;
    if (indexOfCanvas(containers, canvasId) < 0) {
      waitingFor.current = null;
      return;
    }
    if (next.t != null && Number.isFinite(next.t) && next.t >= 0) {
      pendingSeek.current = { shown: shownSeqRef.current, value: { canvasId, t: next.t, play: !!next.play } };
    }
    if (next.canvasId == null && !next.xywh) {
      // only a time: the page stays. If the player is already attached, seek here
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
  }, [key, manifest, containers, origin, setNavRequest, mediaRef]);

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
