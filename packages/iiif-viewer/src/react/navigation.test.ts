import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from './env';
import { CanvasNavigationContext, indexOfCanvas, targetKey } from './navigation';
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
