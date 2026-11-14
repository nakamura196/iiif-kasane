import { useState } from 'react';
import { sameUrlList } from '../core';

// The site has a copy of this hook (src/lib/useStableList.ts): the site only imports the public API of the
// package, and exporting a hook for one caller would grow it. Keep the two in step.
/** The same array while its elements are the same: a new array with equal elements is not a change. */
export function useStableList(list: readonly string[]): string[] {
  const [stable, setStable] = useState<string[]>(() => [...list]);
  if (sameUrlList(stable, list)) return stable;
  const next = [...list];
  setStable(next);
  return next;
}
