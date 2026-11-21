import { describe, expect, it } from 'vitest';
import { contentLangForViewer, shownLocationSearch, withContentLang } from './contentLang';
import { PushedLocations } from './pushedLocations';

describe('content language across navigation', () => {
  it('writes the reader\'s choice into the address of an entry the viewer moves to', () => {
    const next = shownLocationSearch({ url: 'https://example.org/b.json', collections: ['https://example.org/c.json'], tab: 'metadata' }, 'fr');
    expect(new URLSearchParams(next).get('content-lang')).toBe('fr');
    expect(new URLSearchParams(next).get('iiif-content')).toBe('https://example.org/b.json');
    expect(new URLSearchParams(shownLocationSearch({ url: 'u', collections: [], tab: null }, undefined)).has('content-lang')).toBe(false);
  });

  it('keeps the choice when the address has no parameter, and lets the address win when it has one', () => {
    expect(contentLangForViewer(undefined, 'fr')).toBe('fr');
    expect(contentLangForViewer('zh', 'fr')).toBe('zh');
    expect(contentLangForViewer(undefined, '')).toBe(''); // "Automatic" chosen on purpose
    expect(contentLangForViewer(undefined, undefined)).toBeUndefined();
  });

  it('removes the parameter for Automatic', () => {
    expect(withContentLang(new URLSearchParams('a=1&content-lang=fr'), '').toString()).toBe('a=1');
  });

  it('does not make the content language a different place for the history (the viewer\'s Back keeps working)', () => {
    const stack = new PushedLocations();
    stack.push('?iiif-content=https%3A%2F%2Fexample.org%2Fa.json&tab=metadata&content-lang=fr');
    expect(stack.takeIfPrevious('?iiif-content=https%3A%2F%2Fexample.org%2Fa.json&tab=metadata')).toBe(true);
  });
});
