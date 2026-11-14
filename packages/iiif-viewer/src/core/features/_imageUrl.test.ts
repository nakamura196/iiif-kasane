import { describe, expect, it } from 'vitest';
import { largestKeyword, largestRequestUrl } from './_imageUrl';
import { singleImageUrl, type ImageInfo } from './image';

describe('the size keyword for the largest image', () => {
  it('is `max` in Image API 3 (it rejects `full`) and `full` before (2.0 rejects `max`)', () => {
    expect(largestKeyword(3)).toBe('max');
    expect(largestKeyword(2)).toBe('full');
    expect(largestKeyword(1)).toBe('full');
  });
  it('builds the URL for the whole image or a region', () => {
    expect(largestRequestUrl({ id: 'u', version: 3 }, 'full')).toBe('u/full/max/0/default.jpg');
    expect(largestRequestUrl({ id: 'u', version: 2 }, { x: 1.4, y: 2, w: 30.6, h: 40 })).toBe('u/1,2,31,40/full/0/default.jpg');
    expect(largestRequestUrl({ id: 'u', version: 1 }, 'full')).toBe('u/full/full/0/native.jpg');
  });
  it('is the rule singleImageUrl uses for a level 0 service without sizes', () => {
    const info: ImageInfo = { width: 100, height: 80, version: 2, level: 0, tiles: [], sizes: [] };
    expect(singleImageUrl({ id: 'u', version: 2 }, info, 50)).toBe('u/full/full/0/default.jpg');
    expect(singleImageUrl({ id: 'u', version: 3 }, { ...info, version: 3 }, 50)).toBe('u/full/max/0/default.jpg');
  });
});
