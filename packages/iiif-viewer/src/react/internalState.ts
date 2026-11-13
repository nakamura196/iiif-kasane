// State shared inside the viewer that is not part of the public API (atoms.ts is exported as a whole).

import { atom, type createStore } from 'jotai';
import type { CompareItem } from '../core';
import type { NavRequest } from './displays/structureState';

/**
 * The page picked by the reader, and the shown manifest (ShownManifest.seq) it belongs to. Another manifest
 * shown starts at its first page, unless going back restores the page saved on the trail.
 */
export const pickedPageAtom = atom<{ shown: number; index: number }>({ shown: 0, index: 0 });

/**
 * Index of the shown container: the picked one while the same manifest is shown, else the first.
 * Kept within the containers.
 */
export function pickedIndex(picked: { shown: number; index: number }, shownSeq: number, count: number): number {
  return Math.min(picked.shown === shownSeq ? picked.index : 0, Math.max(count - 1, 0));
}

/** Counts every manifest shown; it only grows (clearing what is shown does not take it back). */
export const shownSeqAtom = atom(0);

/**
 * The Scene the annotations in annotationsAtom were read from (its id), or null for the first Scene.
 * Whoever sets annotationsAtom sets this with it, so a new locale reads that same Scene again.
 */
export const notesSceneAtom = atom<string | null>(null);

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

/** Leave the sequence, focus and compare of the manifest shown. */
export function resetViewState(store: ReturnType<typeof createStore>): void {
  store.set(sequenceIdAtom, null);
  store.set(focusAtom, null);
  store.set(compareAtom, []);
  store.set(compareMultiAtom, null);
}
