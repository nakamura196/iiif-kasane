import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from '../env';
import AnnotationCard from './AnnotationCard';
import type { Annotation } from '../../core';

const annotationWith = (value: string): Annotation => ({
  id: 'https://e/a1',
  creator: '',
  title: 'Gate',
  description: value,
  media: [],
  wikidata: [],
  bibliography: [],
  position: { x: 0, y: 0, z: 0 },
  data: {
    body: { value, label: 'Gate' },
    target: { selector: { type: 'PointSelector', value: [0, 0, 0], area: [0, 0, 0], camPos: [0, 0, 0] } },
  },
});

const render = (value: string) =>
  renderToStaticMarkup(
    createElement(
      ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light' }>,
      { locale: 'en', resolvedTheme: 'light' },
      createElement(AnnotationCard, { annotation: annotationWith(value), selected: false, onSelect: () => {} }),
    ),
  );

describe('AnnotationCard', () => {
  it('keeps the formatting of the description', () => {
    const html = render('<p>The <b>south</b> gate</p>');
    expect(html).toContain('<b>south</b>');
  });

  it('drops scripts and event handlers that a manifest puts in the description', () => {
    const html = render('<img src="https://e/x.jpg" onerror="alert(1)"><script>alert(2)</script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(2)');
  });
});
