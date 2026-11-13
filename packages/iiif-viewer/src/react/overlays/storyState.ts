import { atom } from 'jotai';
import type { DefaultCamera } from '../../core';

// ストーリー（右パネルのタブ）と、画像の上の注釈の枠で共有する状態。Viewer ごとの store に載る。

/** The story tab is open: the picture is read scene by scene, so the marks of the annotations step back. */
export const storyOpenAtom = atom<boolean>(false);

/** Show the frame of the current scene (only that one, a thin line without fill). */
export const storyFrameAtom = atom<boolean>(false);

/** The step being read (index into the story's steps). */
export const storyStepAtom = atom<number>(0);

/** Autoplay: the story moves on by itself, a step after the time to read it. */
export const storyPlayingAtom = atom<boolean>(false);

/** The caption of the current step is drawn over the picture (closed with its ×, opened again from the tab). */
export const storyCaptionAtom = atom<boolean>(true);

/** A step in a Scene asks the 3D view to fly to its Camera. `seq` tells a new request from an old one. */
export interface StoryCameraRequest {
  seq: number;
  sceneId: string;
  camera: DefaultCamera;
}
export const storyCameraAtom = atom<StoryCameraRequest | null>(null);

/** The `seq` of the last request the 3D view has flown to (a new 3D view for the same Scene must not fly again). */
export const storyCameraDoneAtom = atom<number>(0);
