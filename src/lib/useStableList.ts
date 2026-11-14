import { useState } from 'react';
import { sameUrlList } from 'iiif-kasane/core';

// A copy of packages/iiif-viewer/src/react/stableList.ts: the site only imports the package's public API, and
// exporting a hook for one caller would grow it. Keep the two in step.
/** The same array while its elements are the same: a new array with equal elements is not a change. */
export function useStableList(list: readonly string[]): string[] {
  const [stable, setStable] = useState<string[]>(() => [...list]);
  if (sameUrlList(stable, list)) return stable;
  const next = [...list];
  setStable(next);
  return next;
}
