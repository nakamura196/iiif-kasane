import { describe, expect, it } from 'vitest';
import { chooseContentLang, contentLangForViewer, settleContentLang, shownLocationSearch, withContentLang } from './contentLang';
import { PushedLocations } from './pushedLocations';

describe('content language across navigation', () => {
  it('writes the reader\'s choice into the address of an entry the viewer moves to', () => {
    const next = shownLocationSearch({ url: 'https://example.org/b.json', collections: ['https://example.org/c.json'], tab: 'metadata' }, 'fr');
    expect(new URLSearchParams(next).get('content-lang')).toBe('fr');
    expect(new URLSearchParams(next).get('iiif-content')).toBe('https://example.org/b.json');
    expect(new URLSearchParams(shownLocationSearch({ url: 'u', collections: [], tab: null }, undefined)).has('content-lang')).toBe(false);
  });

  it('keeps the choice when the address has no parameter, and lets the address win when it has one', () => {
    expect(contentLangForViewer(undefined, { chosen: 'fr', pending: null })).toBe('fr');
    expect(contentLangForViewer('zh', { chosen: 'fr', pending: null })).toBe('zh');
    expect(contentLangForViewer(undefined, { chosen: '', pending: null })).toBe(''); // "Automatic" chosen on purpose
    expect(contentLangForViewer(undefined, { chosen: undefined, pending: null })).toBeUndefined();
  });

  it('removes the parameter for Automatic', () => {
    expect(withContentLang(new URLSearchParams('a=1&content-lang=fr'), '').toString()).toBe('a=1');
  });

  it('does not make the content language a different place for the history (the viewer\'s Back keeps working)', () => {
    const stack = new PushedLocations();
    stack.push('?iiif-content=https%3A%2F%2Fexample.org%2Fa.json&tab=metadata&content-lang=fr');
    expect(stack.takeIfPrevious('?iiif-content=https%3A%2F%2Fexample.org%2Fa.json&tab=metadata')).toBe(true);
  });

  it('Automatic chosen while the address still has content-lang=fr stays Automatic until the address catches up', () => {
    let state = settleContentLang({ chosen: 'fr', pending: null }, 'fr');
    state = chooseContentLang(undefined);
    // the address still says fr (router.replace is on its way): neither the state nor the viewer snaps back
    expect(settleContentLang(state, 'fr')).toBe(state);
    expect(contentLangForViewer('fr', state)).toBe('');
    // the address has caught up: pending ends, the choice stays Automatic
    const done = settleContentLang(state, undefined);
    expect(done).toEqual({ chosen: '', pending: null });
    expect(contentLangForViewer(undefined, done)).toBe('');
    // later, a link with a value is a new choice
    expect(settleContentLang(done, 'zh')).toEqual({ chosen: 'zh', pending: null });
  });

  it('a pending choice of another language is not overwritten by the old value either', () => {
    const state = chooseContentLang('zh');
    expect(settleContentLang(state, 'fr')).toBe(state);
    expect(settleContentLang(state, 'zh')).toEqual({ chosen: 'zh', pending: null });
  });
});
