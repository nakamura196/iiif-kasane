import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from './env';
import { CanvasNavigationContext, indexOfCanvas, shouldApplyTarget, targetKey } from './navigation';
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
  it('applies a target once per manifest and value', () => {
    expect(shouldApplyTarget(null, { manifestId: 'a', key, restored: false })).toBe(true);
    expect(shouldApplyTarget({ manifestId: 'a', key }, { manifestId: 'a', key, restored: false })).toBe(false);
    expect(shouldApplyTarget({ manifestId: 'a', key }, { manifestId: 'b', key, restored: false })).toBe(true);
  });
  it('leaves a manifest shown again by going back on the page the reader was on', () => {
    // target X, open another manifest, go back: the restored page stays
    expect(shouldApplyTarget({ manifestId: 'b', key }, { manifestId: 'a', key, restored: true })).toBe(false);
  });
  it('still applies a new target from the host to a restored manifest', () => {
    expect(shouldApplyTarget({ manifestId: 'b', key }, { manifestId: 'a', key: 'https://e/c2', restored: true })).toBe(true);
  });
});
