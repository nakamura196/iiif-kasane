import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from './env';
import { CanvasNavigationContext, forShown, indexOfCanvas, shouldApplyTarget, targetKey } from './navigation';
import AnnotationBody from './annotation/AnnotationBody';

describe('indexOfCanvas', () => {
  const cs = [{ id: 'https://e/c1' }, { id: 'https://e/c2' }];
  it('finds a Canvas by id', () => {
    expect(indexOfCanvas(cs, 'https://e/c2')).toBe(1);
  });
  it('returns -1 for an unknown id', () => {
    expect(indexOfCanvas(cs, 'https://e/zzz')).toBe(-1);
  });
});

describe('targetKey', () => {
  it('is empty without a target', () => {
    expect(targetKey(undefined)).toBe('');
  });
  it('changes with the Canvas, the region and the highlight', () => {
    const base = targetKey({ canvasId: 'https://e/c1' });
    expect(targetKey({ canvasId: 'https://e/c1' })).toBe(base);
    expect(targetKey({ canvasId: 'https://e/c2' })).not.toBe(base);
    expect(targetKey({ canvasId: 'https://e/c1', xywh: [1, 2, 3, 4] })).not.toBe(base);
    expect(targetKey({ canvasId: 'https://e/c1', highlight: false })).not.toBe(base);
  });
  it('changes with the time and the play flag, and works without a Canvas', () => {
    const base = targetKey({ canvasId: 'https://e/c1' });
    expect(targetKey({ canvasId: 'https://e/c1', t: 30 })).not.toBe(base);
    expect(targetKey({ canvasId: 'https://e/c1', t: 30, play: true })).not.toBe(targetKey({ canvasId: 'https://e/c1', t: 30 }));
    expect(targetKey({ t: 30 })).toBe(targetKey({ t: 30 }));
    expect(targetKey({ t: 30 })).not.toBe(targetKey({ t: 31 }));
  });
});

describe('annotation link body', () => {
  const render = (url: string, labels: Map<string, string>) =>
    renderToStaticMarkup(
      createElement(
        ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light' }>,
        { locale: 'en', resolvedTheme: 'light' },
        createElement(
          CanvasNavigationContext.Provider,
          { value: { goToCanvas: () => true } },
          createElement(AnnotationBody, { body: { kind: 'resource', url }, canvasLabels: labels }),
        ),
      ),
    );

  it('renders a Canvas of this item as a button, not a new-tab link', () => {
    const html = render('https://e/c2', new Map([['https://e/c2', 'Page 2']]));
    expect(html).toContain('<button');
    expect(html).toContain('Page 2');
    expect(html).not.toContain('target="_blank"');
  });
  it('keeps an external URL as a new-tab link', () => {
    const html = render('https://example.org/x', new Map());
    expect(html).toContain('<a ');
    expect(html).toContain('target="_blank"');
  });
});

describe('shouldApplyTarget', () => {
  const key = 'https://e/c1';
  const now = (manifestId: string, origin: 'content' | 'move' | 'back', hasCanvas = true, k = key) => ({
    manifestId,
    key: k,
    origin,
    hasCanvas,
  });
  it('applies a target once per manifest and value', () => {
    expect(shouldApplyTarget(null, now('a', 'content'))).toBe(true);
    expect(shouldApplyTarget({ manifestId: 'a', key }, now('a', 'content'))).toBe(false);
    expect(shouldApplyTarget({ manifestId: 'a', key }, now('b', 'content'))).toBe(true);
    // an entry that has the target's Canvas
    expect(shouldApplyTarget({ manifestId: 'a', key }, now('b', 'move'))).toBe(true);
  });
  it('leaves a manifest shown again by going back on the page the reader was on', () => {
    // target X, open another manifest, go back: the restored page stays
    expect(shouldApplyTarget({ manifestId: 'b', key }, now('a', 'back'))).toBe(false);
  });
  it('does not carry a target without a Canvas (a region or a time only) into each entry', () => {
    const regionOnly = '#1,2,3,4#1##0';
    expect(shouldApplyTarget({ manifestId: 'collection', key: regionOnly }, now('entry', 'move', false, regionOnly))).toBe(false);
  });
  it('still applies a new target from the host', () => {
    expect(shouldApplyTarget({ manifestId: 'b', key }, now('a', 'back', true, 'https://e/c2'))).toBe(true);
    expect(shouldApplyTarget({ manifestId: 'b', key }, now('a', 'move', false, 'https://e/c2'))).toBe(true);
  });
});

describe('forShown', () => {
  it('keeps a value (a playback time, a waiting seek) only for the manifest it was set on', () => {
    expect(forShown({ shown: 3, value: 42 }, 3, 0)).toBe(42);
    // another manifest shown (an entry, going back): back to the start
    expect(forShown({ shown: 3, value: 42 }, 4, 0)).toBe(0);
  });
});
