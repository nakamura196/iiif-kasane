import { describe, expect, it } from 'vitest';
import { OTHER_VIEWS_TAB, viewerTabOf } from './viewerTabs';

describe('viewerTabOf', () => {
  it('opens Other views for a tab moved into it (old ?tab=puzzle links)', () => {
    expect(viewerTabOf('puzzle')).toBe(OTHER_VIEWS_TAB);
  });

  it('keeps the other tabs, and drops unknown ones', () => {
    expect(viewerTabOf('metadata')).toBe('metadata');
    expect(viewerTabOf(OTHER_VIEWS_TAB)).toBe(OTHER_VIEWS_TAB);
    expect(viewerTabOf('nope')).toBeUndefined();
    expect(viewerTabOf(null)).toBeUndefined();
  });
});
