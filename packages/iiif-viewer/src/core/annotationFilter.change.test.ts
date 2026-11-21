import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterAfterAnnotationsChange } from './annotationFilter';
import type { Annotation } from './types/main';

const note = (id: string, tags: string[]) => ({ id, tags: tags.map((value) => ({ value })) }) as unknown as Annotation;
const filter = { query: 'x', creators: ['me'], tags: ['a', 'b'], kinds: [] };

describe('filterAfterAnnotationsChange', () => {
  it('clears everything for new annotations (a new manifest or Scene), even with the same ids', () => {
    expect(filterAfterAnnotationsChange(filter, [note('annotation-0', ['a'])], false)).toBe(EMPTY_FILTER);
  });

  it('keeps the search and filters for the same annotations read in another content language, dropping gone tags', () => {
    const next = filterAfterAnnotationsChange(filter, [note('n1', ['a'])], true);
    expect(next).toEqual({ query: 'x', creators: ['me'], tags: ['a'], kinds: [] });
    expect(filterAfterAnnotationsChange(filter, [note('n1', ['a', 'b'])], true)).toBe(filter);
  });
});
