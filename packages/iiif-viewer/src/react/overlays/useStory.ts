'use client';

import { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { containersOf, readingTime, scrollOf, stepTarget, storyOf, type ManifestV4, type StoryStep } from '../../core';
import { manifestAtom } from '../atoms';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { useLocale } from '../env';
import { selectedCanvasAnnotationAtom } from './canvasAnnotationState';
import { storyCameraAtom, storyStepAtom } from './storyState';

/** How long autoplay stays on a step: the time to read it, and the move there (the glide takes up to 1.8 s). */
export const autoplayDelay = (step: StoryStep, locale: string): number => readingTime(step, locale) + 1200;

// The story of the open manifest and the move to one of its steps, shared by the story tab, the caption
// over the picture and the strip, so that all three go the same way.
export function useStory(given?: ManifestV4 | null) {
  const own = useAtomValue(manifestAtom);
  const manifest = given ?? own;
  const locale = useLocale();
  const story = useMemo(() => storyOf(manifest, locale), [manifest, locale]);
  const sizes = useMemo(() => {
    const m = new Map<string, { width?: number; height?: number }>();
    for (const c of manifest ? containersOf(manifest) : []) m.set(c.id, { width: c.width, height: c.height });
    return m;
  }, [manifest]);
  const scroll = useMemo(
    () => (story ? scrollOf(story, sizes.get(story.steps[0]?.canvasId ?? '')) : null),
    [story, sizes],
  );
  const [index, setIndex] = useAtom(storyStepAtom);
  const setSelected = useSetAtom(selectedCanvasAnnotationAtom);
  const setRequest = useSetAtom(navRequestAtom);
  const setCamera = useSetAtom(storyCameraAtom);
  const total = story?.steps.length ?? 0;
  const at = Math.min(Math.max(index, 0), Math.max(total - 1, 0));

  const go = useCallback(
    (i: number) => {
      const s = story?.steps[i];
      if (!s) return;
      setIndex(i);
      setSelected(s.id);
      if (s.camera !== undefined) {
        // a step in a Scene: show that Scene, and fly to the step's Camera (none: the view stays)
        if (s.camera) setCamera({ seq: nextSeq(), sceneId: s.canvasId, camera: s.camera });
        setRequest({ seq: nextSeq(), target: { canvasId: s.canvasId } });
        return;
      }
      const view = scroll?.views?.[i];
      setRequest({ seq: nextSeq(), target: view ? { canvasId: s.canvasId, xywh: view } : stepTarget(s, sizes.get(s.canvasId)) });
    },
    [story, scroll, sizes, setIndex, setSelected, setRequest, setCamera],
  );

  return { story, at, total, go, setIndex, scroll, sizes, locale };
}
