'use client';

// State of the structure feature. It lives in each Viewer's jotai store (no global variables).
// The table of contents in the right panel, the page navigation and the displays are connected through it.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePlayback } from '../playback';
import { atom, useAtomValue, useStore, type createStore } from 'jotai';
import {
  canvasBehaviorsOf,
  groupSpreads,
  orderOf,
  sequencesOf,
  viewingOf,
  type CanvasTarget,
  type ContainerInfo,
  type ManifestV4,
  type SequenceInfo,
  type ViewingInfo,
} from '../../core';
import { manifestUrlAtom, shownManifestAtom, type ShownOrigin } from '../atoms';
import {
  compareAtom,
  compareMultiAtom,
  focusAtom,
  backFailedAtom,
  pickedPageAtom,
  resetViewState,
  sequenceIdAtom,
  type CompareMulti,
} from '../internalState';
import {
  isContentLoading,
  loadManifest,
  tryPrepareShow,
  showManifest,
  trailAtom,
  useLocaleRef,
  type OpenResult,
  type TrailItem,
} from '../useManifest';

/** A request to move (sent by the table of contents etc., received by ContainerList). */
export interface NavRequest {
  seq: number;
  target: CanvasTarget;
  /** false: move there without drawing the box around the region (the asker marks it itself). */
  highlight?: boolean;
  /** true: show the region at once, without the glide (opening from a link: the reader came for that place). */
  instant?: boolean;
}

export const navRequestAtom = atom<NavRequest | null>(null);

export { focusAtom, compareAtom, compareMultiAtom, sequenceIdAtom, type CompareMulti };

export { trailAtom, type OpenResult, type TrailItem };

/** How an opened manifest counts: part of the iiif-content (its content state), or a move from what was shown. */
type OpenOrigin = Exclude<ShownOrigin, 'back'>;

let seqCounter = 0;
export const nextSeq = (): number => ++seqCounter;

export interface PageOrder {
  viewing: ViewingInfo;
  sequences: SequenceInfo[];
  /** container indexes in display order */
  order: number[];
  /** groups such as spreads (in display order) */
  groups: number[][];
}

/** Work out how the manifest is viewed: page order and spreads. */
export function usePageOrder(manifest: ManifestV4 | null | undefined, containers: ContainerInfo[]): PageOrder {
  const sequenceId = useAtomValue(sequenceIdAtom);
  return useMemo(() => {
    const viewing = viewingOf(manifest);
    const sequences = sequencesOf(manifest);
    const chosen = sequences.find((s) => s.id === sequenceId) ?? null;
    const order = orderOf(containers, chosen);
    const behaviors = canvasBehaviorsOf(manifest);
    const standalone = (i: number) => {
      const b = behaviors.get(containers[i]?.id) ?? [];
      return b.includes('non-paged') || b.includes('facing-pages');
    };
    return { viewing, sequences, order, groups: groupSpreads(order, viewing.mode, standalone) };
  }, [manifest, containers, sequenceId]);
}

type Store = ReturnType<typeof createStore>;

/**
 * Open the manifest (or Collection) at the URL in the viewer of this store. With push, "back" returns
 * to what is shown now. Only the latest request is shown: when another open, a back or a new
 * iiif-content comes before this one is read, this one is dropped ('stale'). It is also dropped at once while
 * a new iiif-content is being read. `origin` is 'content' when the iiif-content (a content state) leads here.
 */
export async function openManifest(
  store: Store,
  url: string,
  push: boolean,
  locale: () => string,
  origin: OpenOrigin = 'move',
): Promise<OpenResult> {
  // a new iiif-content is being read: it wins, and this move (inside what was shown before) is dropped
  if (isContentLoading(store)) return 'stale';
  return loadManifest(store, url, locale, origin, () => {
    const here = store.get(shownManifestAtom);
    if (push && here) {
      // what goes on the trail is the one being left (its own URL, not the one being opened), with its page
      const picked = store.get(pickedPageAtom);
      const index = picked.shown === here.seq ? picked.index : 0;
      const item: TrailItem = { url: here.url, manifest: here.manifest, raw: here.raw, index };
      const owner = store.get(manifestUrlAtom);
      store.set(trailAtom, (t) => ({ owner, items: t.owner === owner ? [...t.items, item] : [item] }));
    }
    // before the new manifest is shown, so what is set for it afterwards (a content state's region) stays
    resetViewState(store);
  });
}

/** Go back one step of the trail, to the page the reader was on. false when there is nothing to go back to. */
export function goBack(store: Store, locale: string): boolean {
  // a new iiif-content is being read: it wins (and the trail belongs to the old one)
  if (isContentLoading(store)) return false;
  const owner = store.get(manifestUrlAtom);
  const trail = store.get(trailAtom);
  const items = trail.owner === owner ? trail.items : [];
  // an item that cannot be parsed again is dropped from the trail (Back would do nothing forever otherwise)
  // and the one before it is tried
  let rest = items;
  while (rest.length > 0) {
    const prev = rest[rest.length - 1];
    const prepared = tryPrepareShow(prev.manifest, locale);
    if (!prepared) {
      rest = rest.slice(0, -1);
      continue;
    }
    store.set(trailAtom, { owner, items: rest.slice(0, -1) });
    resetViewState(store);
    showManifest(store, prev.url, { raw: prev.raw, manifest: prev.manifest }, 'back', prepared);
    store.set(pickedPageAtom, { shown: store.get(shownManifestAtom)?.seq ?? 0, index: prev.index });
    return true;
  }
  if (rest.length !== items.length) store.set(trailAtom, { owner, items: rest });
  // the steps could not be shown: say so, rather than leave the reader pressing a button that does nothing
  if (items.length > 0) store.set(backFailedAtom, true);
  return false;
}

/**
 * Open a manifest whose Canvases the targets point into (a content state, a dropped link). The targets wait in
 * `pending` until the manifest is shown; when it is not (dropped or unreadable), they are cleared so that they
 * do not apply to whatever is shown next.
 */
export async function openWithTargets<T>(
  open: (url: string, push: boolean, origin?: OpenOrigin) => Promise<OpenResult>,
  pending: { current: T | null },
  url: string,
  targets: T,
  origin: OpenOrigin,
): Promise<OpenResult> {
  pending.current = targets;
  const result = await open(url, false, origin);
  if (result !== 'shown' && pending.current === targets) pending.current = null;
  return result;
}

/** Open manifests (from their URL) in the viewer, and go back. Used by moves inside a Collection. */
export function useManifestSwitch() {
  const store = useStore();
  const locale = useLocaleRef();
  const manifestUrl = useAtomValue(manifestUrlAtom);
  const trail = useAtomValue(trailAtom);

  /** Open the manifest (or Collection) at the URL. With push, "back" returns to what is shown now. */
  const open = useCallback(
    (url: string, push: boolean, origin?: OpenOrigin): Promise<OpenResult> =>
      openManifest(store, url, push, () => locale.current, origin),
    [store, locale],
  );

  const back = useCallback(() => {
    goBack(store, locale.current);
  }, [store, locale]);

  const canGoBack = trail.owner === manifestUrl && trail.items.length > 0;
  return { open, back, canGoBack };
}

// Seeks to the time that a content state / table of contents entry points to, once the
// media element of the Canvas exists.
export function useSeekOnFocus(container: ContainerInfo) {
  const focus = useAtomValue(focusAtom);
  const { seek, mediaRef } = usePlayback();
  const done = useRef(0);
  const time = focus && focus.target.canvasId === container.id ? focus.target.t?.[0] : undefined;
  const seq = focus?.seq ?? 0;
  useEffect(() => {
    if (time === undefined || done.current === seq) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (mediaRef.current || tries > 30) {
        window.clearInterval(timer);
        done.current = seq;
        seek(time);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [time, seq, seek, mediaRef]);
}
