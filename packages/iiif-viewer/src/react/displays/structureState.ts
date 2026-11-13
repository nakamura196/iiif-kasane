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
  type CompareItem,
  type ContainerInfo,
  type ManifestV4,
  type SequenceInfo,
  type ViewingInfo,
} from '../../core';
import { manifestUrlAtom, shownManifestAtom } from '../atoms';
import { isContentLoading, loadManifest, showManifest, useLocaleRef } from '../useManifest';

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

/** The region / time highlighted now (the result of a move). Cleared when the page changes. */
export const focusAtom = atom<NavRequest | null>(null);

/** 0540: when a content state points to several Canvases, the containers shown side by side (the first is selected). */
export const compareAtom = atom<number[]>([]);

/**
 * 0540: when a content state points to Canvases of different manifests, what is shown side by side.
 * anchor is the Canvas index in the open manifest (moving away ends it). failed lists manifests that could not be read.
 */
export interface CompareMulti {
  anchor: number;
  items: CompareItem[];
  failed: string[];
}
export const compareMultiAtom = atom<CompareMulti | null>(null);

/** The alternative page order chosen (the id of a sequence Range). null: the original order. */
export const sequenceIdAtom = atom<string | null>(null);

/** One step of the trail: what was shown, its URL, its served JSON and the page the reader was on. */
export interface TrailItem {
  url: string;
  manifest: ManifestV4;
  raw: unknown;
  /** Index of the page (container) shown when the reader left it. */
  index: number;
}

/** The way taken through Collections: what was shown before each move, to go back to it. */
export const trailAtom = atom<{ owner: string | null; items: TrailItem[] }>({ owner: null, items: [] });

/**
 * The page picked by the reader, and the shown manifest (ShownManifest.seq) it belongs to. Another manifest
 * shown starts at its first page, unless going back restores the page saved on the trail.
 */
export const pickedPageAtom = atom<{ shown: number; index: number }>({ shown: 0, index: 0 });

/**
 * The iiif-content whose page URL arguments (?canvas=, ?pos=, a content state in ?iiif-content=) were used.
 * They point into the first manifest shown for it, not into the entries opened from it afterwards.
 */
export const urlTargetsUsedForAtom = atom<string | null>(null);

/** seq of a manifest shown again by going back: its first page is not chosen again from content state or `start`. */
export const restoredSeqAtom = atom<number | null>(null);

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

// the first load shows a manifest through showManifest too; a move also leaves the sequence, focus and compare
function leaveViewState(store: Store) {
  store.set(sequenceIdAtom, null);
  store.set(focusAtom, null);
  store.set(compareAtom, []);
  store.set(compareMultiAtom, null);
}

/** Result of opening a manifest: shown, could not be read, or dropped because a later request replaced it. */
export type OpenResult = 'shown' | 'failed' | 'stale';

/**
 * Open the manifest (or Collection) at the URL in the viewer of this store. With push, "back" returns
 * to what is shown now. Only the latest request is shown: when another open, a back or a new
 * iiif-content comes before this one is read, this one is dropped ('stale'). It is also dropped at once while
 * a new iiif-content is being read.
 */
export async function openManifest(store: Store, url: string, push: boolean, locale: () => string): Promise<OpenResult> {
  // a new iiif-content is being read: it wins, and this move (inside what was shown before) is dropped
  if (isContentLoading(store)) return 'stale';
  return loadManifest(store, url, locale, () => {
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
    leaveViewState(store);
  });
}

/** Go back one step of the trail, to the page the reader was on. false when there is nothing to go back to. */
export function goBack(store: Store, locale: string): boolean {
  const owner = store.get(manifestUrlAtom);
  const trail = store.get(trailAtom);
  const items = trail.owner === owner ? trail.items : [];
  const prev = items[items.length - 1];
  if (!prev) return false;
  store.set(trailAtom, { owner, items: items.slice(0, -1) });
  leaveViewState(store);
  showManifest(store, prev.url, { raw: prev.raw, manifest: prev.manifest }, locale);
  const seq = store.get(shownManifestAtom)?.seq ?? 0;
  store.set(pickedPageAtom, { shown: seq, index: prev.index });
  store.set(restoredSeqAtom, seq);
  return true;
}

/** Open manifests (from their URL) in the viewer, and go back. Used by moves inside a Collection. */
export function useManifestSwitch() {
  const store = useStore();
  const locale = useLocaleRef();
  const manifestUrl = useAtomValue(manifestUrlAtom);
  const trail = useAtomValue(trailAtom);

  /** Open the manifest (or Collection) at the URL. With push, "back" returns to what is shown now. */
  const open = useCallback(
    (url: string, push: boolean): Promise<OpenResult> => openManifest(store, url, push, () => locale.current),
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
