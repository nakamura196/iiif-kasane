import { atom } from 'jotai';

// Videos drawn as layers of an image Canvas (VideoLayerView.tsx), played and heard as set in the Layers tab.
// Visibility, opacity and order are the layer settings, as for the images. In each Viewer's store.

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The videos play (muted, so browsers allow it), unless the reader asks for reduced motion. */
export const videoLayersPlayingAtom = atom<boolean>(!prefersReducedMotion());

/** Sound on: the video nearest the middle of the view is the loudest. Off at first. */
export const videoLayersSoundAtom = atom<boolean>(false);
