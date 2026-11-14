import { useState } from 'react';
import { sameUrlList } from '../core';

/** The same array while its elements are the same: a new array with equal elements is not a change. */
export function useStableList(list: readonly string[]): string[] {
  const [stable, setStable] = useState<string[]>(() => [...list]);
  if (sameUrlList(stable, list)) return stable;
  setStable([...list]);
  return [...list];
}
