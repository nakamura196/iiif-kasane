import { describe, expect, it } from 'vitest';
import { encodeContentState } from 'iiif-kasane/core';
import { PushedLocations, locationKey } from './pushedLocations';

const top = '?iiif-content=T';
const sub = '?iiif-content=S&collection=T';

describe('PushedLocations', () => {
  it('compares addresses by what they open, not by how they are written', () => {
    expect(locationKey('?iiif-content=a%3Ab&tab=x')).toBe(locationKey('?tab=x&iiif-content=a:b'));
    expect(locationKey(sub)).not.toBe(locationKey(top));
  });

  it('reads a content state and the URL it names as the same place', () => {
    const state = encodeContentState('https://example.org/t.json');
    expect(locationKey(`?iiif-content=${state}&collection=${state}`)).toBe(
      locationKey('?iiif-content=https%3A%2F%2Fexample.org%2Ft.json&collection=https%3A%2F%2Fexample.org%2Ft.json'),
    );
  });

  it('is the entry before only when it is exactly the place returned to', () => {
    const h = new PushedLocations();
    h.push(top);
    h.push(sub);
    expect(h.takeIfPrevious(top)).toBe(false);
    expect(h.takeIfPrevious(sub)).toBe(true);
    expect(h.takeIfPrevious(top)).toBe(true);
    expect(h.takeIfPrevious(top)).toBe(false);
  });

  it("follows the browser's own Back, and forgets on anything else", () => {
    const h = new PushedLocations();
    h.push(top);
    h.push(sub);
    h.browsed(sub);
    expect(h.depth).toBe(1);
    h.browsed('?iiif-content=elsewhere');
    expect(h.depth).toBe(0);
  });
});
