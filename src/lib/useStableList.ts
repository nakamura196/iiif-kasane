import { useState } from 'react';

/** The same array while its elements are the same: a new array with equal elements is not a change. */
export function useStableList(list: readonly string[]): string[] {
  const [stable, setStable] = useState<string[]>(() => [...list]);
  if (stable.length === list.length && stable.every((v, i) => v === list[i])) return stable;
  setStable([...list]);
  return [...list];
}
