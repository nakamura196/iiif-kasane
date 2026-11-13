import { describe, expect, it } from 'vitest';
import { puzzleFromParams, puzzleQuery } from './puzzleLink';

const read = (q: string) => puzzleFromParams(new URLSearchParams(q));

describe('puzzleFromParams', () => {
  it('reads the page (from 1) and the grid', () => {
    expect(read('puzzle=4&grid=6')).toEqual({ index: 3, size: 6 });
  });
  it('uses the default grid when it is missing or not offered', () => {
    expect(read('puzzle=2')).toEqual({ index: 1, size: 4 });
    expect(read('puzzle=2&grid=7')).toEqual({ index: 1, size: 4 });
  });
  it('treats a bare ?puzzle as the first page', () => {
    expect(read('puzzle')).toEqual({ index: 0, size: 4 });
  });
  it('ignores a missing or broken page', () => {
    expect(read('tab=views')).toBeNull();
    expect(read('puzzle=0')).toBeNull();
    expect(read('puzzle=abc')).toBeNull();
    expect(read('puzzle=1.5')).toBeNull();
  });
});

describe('puzzleQuery', () => {
  it('round-trips through puzzleFromParams', () => {
    const q = puzzleQuery('https://example.org/m.json', 3, 5);
    expect(q).toBe('iiif-content=https%3A%2F%2Fexample.org%2Fm.json&puzzle=4&grid=5');
    expect(read(q)).toEqual({ index: 3, size: 5 });
  });
});
