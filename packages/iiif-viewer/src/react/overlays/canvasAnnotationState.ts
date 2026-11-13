import { atom } from 'jotai';

// The chosen annotation, shared by the list in the right panel and the marks over the image. Kept in each Viewer's store.
export const selectedCanvasAnnotationAtom = atom<string | null>(null);

// The unit (Text Granularity: line, word …) chosen in the annotations tab; null is all. The marks over the image and
// over the page thumbnails follow it too, except the hits of a text search (highlighting), which the search tab narrows.
export const canvasAnnotationGranularityAtom = atom<string | null>(null);

// AnnotationPages made in the reader's browser (the results of inference, for example). They are not in the manifest,
// but are shown in the right panel's list and over the image like its annotations. Kept per Canvas, by their maker.
export interface LocalAnnotationPage {
  /** Who made it (for example `inference:<model id>`). One page per maker and Canvas. */
  source: string;
  canvasId: string;
  page: unknown;
}

export const localAnnotationPagesAtom = atom<LocalAnnotationPage[]>([]);

// How many AnnotationPages made in the browser are laid over the Canvas's image, not counting those of `ignore` (the
// marks of a text search, for example). A result of inference is here only while it is shown (hiding it in the
// inference tab takes it out).
export const localPageCountOn = (pages: LocalAnnotationPage[], canvasId: string | undefined, ignore: string): number =>
  canvasId ? pages.filter((l) => l.canvasId === canvasId && l.source !== ignore).length : 0;

// The text in the annotations tab's search box. The marks over the image are narrowed to the matching annotations too.
export const canvasAnnotationQueryAtom = atom<string>('');

// Tags ("key: value") chosen in the annotations tab or the pages grid. Only annotations with one of them are shown in
// the list and over the image. Tags the current Canvas lacks are ignored (the choice is kept when moving to another Canvas).
export const canvasAnnotationTagsAtom = atom<string[]>([]);

// Kinds (motivations) chosen in the annotations tab or the pages grid; empty shows every kind. The list, the marks over
// the image and the marks over the page thumbnails all follow it. Kinds the current Canvas lacks are ignored.
export const canvasAnnotationKindsAtom = atom<string[]>([]);

// Whether choosing an annotation in the list moves the image to it (off by default).
export const canvasAnnotationFocusOnSelectAtom = atom<boolean>(false);
