import { atom } from 'jotai';
import type { ManifestV4 } from '../core';
import type { PaintedModel } from '../core';
import type { Annotation, InfoPanelContent, Annotation3 } from '../core';
import { EMPTY_FILTER, filterAnnotations, type AnnotationFilter } from '../core';
import type { LayerItem, LayerSetting, PlaybackDirection } from '../core';

export const infoPanelAtom = atom<InfoPanelContent | null>(null);

export const manifestAtom = atom<ManifestV4 | null>(null);

export const annotationsAtom = atom<Annotation[]>([]);

// The 3D models placed in the Scene (one per candidate of a Choice), and the candidate chosen in each Choice
export const paintedModelsAtom = atom<PaintedModel[]>([]);
export const modelChoicesAtom = atom<Record<string, number>>({});

// id of the shown Scene (null: the first Scene). Annotations, the first view and the camera buttons are read from it
export const sceneIdAtom = atom<string | null>(null);

// Animations in the main model (GLB). clips is the number of clips (0: no play button)
export const modelAnimationAtom = atom<{ clips: number; playing: boolean }>({ clips: 0, playing: true });

// Layers over an image Canvas: the list for the shown Canvas (read by the right panel tab), the visibility and
// opacity the reader set (per layer id), and the stacking order (per Canvas id, from the bottom)
export const canvasLayersAtom = atom<{ canvasId: string; items: LayerItem[] } | null>(null);
export const layerSettingsAtom = atom<Record<string, LayerSetting>>({});
export const layerOrderAtom = atom<Record<string, string[]>>({});

// Compare the candidates of an image Choice in place (chosen in the Choice bar). single: no comparison.
// b is the candidate on side B (per painting id). The way of showing is kept across Canvases (front and back alike)
export type ChoiceCompareMode = 'single' | 'swipe' | 'spyglass' | 'overlay' | 'side';
export const choiceCompareAtom = atom<{ mode: ChoiceCompareMode; b: Record<string, number>; opacity: number }>({
  mode: 'single',
  b: {},
  opacity: 0.5,
});

// Layer playback. Kept outside the tab so it does not stop when the reader switches tabs in the right panel.
// The image display (ImageCanvasDisplay) runs the timer. ids are the layers played (from the bottom), groups their steps
export interface LayerPlayback {
  canvasId: string;
  ids: string[];
  groups: number[];
  direction: PlaybackDirection;
  step: number;
}
export const layerPlaybackAtom = atom<LayerPlayback | null>(null);
// Playback interval (seconds), repeat and direction (assemble / take apart)
export const layerPlaybackOptionsAtom = atom<{ seconds: number; loop: boolean; direction: PlaybackDirection }>({
  seconds: 1,
  loop: true,
  direction: 'build',
});

// Search and filter of the list. The 3D marks show only the result
export const annotationFilterAtom = atom<AnnotationFilter>(EMPTY_FILTER);

export const visibleAnnotationsAtom = atom((get) =>
  filterAnnotations(get(annotationsAtom), get(annotationFilterAtom)),
);

export const annotationsAtom3 = atom<Annotation3[]>([]);

// id of the selected annotation
export const selectedAnnotationIdAtom = atom<string | null>(null);

// The URL first given to the viewer (iiif-content). It stays the same while moving inside a Collection
export const manifestUrlAtom = atom<string | null>(null);

/** How a manifest came to be shown (see ShownManifest.origin). */
export type ShownOrigin = 'content' | 'move' | 'back';

/**
 * The manifest (or Collection) shown now, as one value: its URL, the JSON as served (before convertToV4,
 * which drops the Image API service and other details that the displays need) and the converted one.
 * `seq` grows by one each time something is shown, so parts can tell a new manifest from the same one shown again.
 */
export interface ShownManifest {
  url: string;
  raw: unknown;
  manifest: ManifestV4;
  seq: number;
  /**
   * How it came to be shown: 'content' the iiif-content given to the viewer (or the manifest its content state
   * points to), 'move' an entry opened from what was shown, 'back' going back along the trail.
   * The page URL arguments and the host's target belong to 'content'; 'back' keeps the reader's page.
   */
  origin: ShownOrigin;
  /** A Canvas or Scene of the manifest has a geographic position (georeferencing, navPlace features). */
  hasGeo: boolean;
  /**
   * Internal: set for a manifest that `onShownChange` does not report (a dropped link: the host has no address to
   * write for it; or the place the host asked for with the browser's Back, which it set itself). Optional, so a host that sets the value is unaffected.
   */
  quiet?: boolean;
}
export const shownManifestAtom = atom<ShownManifest | null>(null);

// whether annotations are shown
export const showAnnotationsAtom = atom<boolean>(true);

// Radius of the main model's bounding sphere (in model units). Limits the zoom buttons' distance
export const modelRadiusAtom = atom<number | null>(null);

// The floor grid in 3D. Hidden by default (it gets in the way); shown with a button
export const showGridAtom = atom<boolean>(false);

// Whether "measure" is on in 3D. While on, clicks on the model measure distances and annotation marks are hidden
export const measuringAtom = atom<boolean>(false);
