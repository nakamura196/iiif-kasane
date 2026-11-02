import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from '../env';
import AnnotationResources, { AnnotationResourcesContent } from './AnnotationResources';
import type { AnnotationResource } from '../../core';

const resources: AnnotationResource[] = [
  { kind: 'image', role: 'related', url: 'https://e/dog.jpg', label: { en: ['dog relief'] } },
  { kind: 'wikidata', role: 'identifying', url: 'https://www.wikidata.org/wiki/Q144' },
  { kind: 'wikipedia', role: 'related', url: 'https://ja.wikipedia.org/wiki/イヌ' },
  { kind: 'citation', role: 'related', label: { en: ['Choyke 2003'] } },
];

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light'; children?: ReactNode }>,
      { locale: 'ja', resolvedTheme: 'light' },
      node,
    ),
  );

describe('AnnotationResources', () => {
  it('shows only a button with the counts in the list, not the pictures', () => {
    const html = render(createElement(AnnotationResources, { resources }));
    expect(html).toContain('data-annotation-resources-button');
    expect(html).toContain('画像 1');
    expect(html).toContain('リンク 2');
    expect(html).toContain('文献 1');
    expect(html).not.toContain('https://e/dog.jpg');
    expect(html).not.toContain('Choyke 2003');
  });

  it('shows nothing without resources', () => {
    expect(render(createElement(AnnotationResources, { resources: [] }))).toBe('');
  });

  it('puts the pictures and references in the opened part', () => {
    const html = render(createElement(AnnotationResourcesContent, { resources }));
    expect(html).toContain('https://e/dog.jpg');
    expect(html).toContain('Choyke 2003');
  });
});
