// The addresses this page pushed onto the browser's history (the ones it left), so that going back in the viewer
// can use the history's own Back when the entry before is exactly the place to return to. Without it, going
// back would push a new entry (the history grows) or replace the current one (two equal entries in a row).

import { decodeContentState, manifestFromParams } from 'iiif-kasane/core';

/**
 * An address compared by what it opens: the item, the Collections walked through, the tab. A content state and
 * the URL it names are the same place.
 */
export function locationKey(search: string): string {
  const params = new URLSearchParams(search);
  const resolved = (v: string | null) => decodeContentState(v) ?? v;
  return JSON.stringify([manifestFromParams(params), params.getAll('collection').map(resolved), params.get('tab')]);
}

export class PushedLocations {
  private stack: string[] = [];

  /** The address `search` is left by a push: the entry before the new one. */
  push(search: string): void {
    this.stack.push(locationKey(search));
  }

  /** True (and the entry is taken off) when the entry before the current one is exactly `search`. */
  takeIfPrevious(search: string): boolean {
    if (this.stack.length === 0 || this.stack[this.stack.length - 1] !== locationKey(search)) return false;
    this.stack.pop();
    return true;
  }

  /**
   * The browser went to `search` by itself (its Back or Forward button): one step back when it is the entry
   * before, else the history is not known any more.
   */
  browsed(search: string): void {
    if (!this.takeIfPrevious(search)) this.stack = [];
  }

  get depth(): number {
    return this.stack.length;
  }
}
