// The numbers on the marks sit outside their boxes: above a tall box, to the left of a wide or square one.
// Rendered on the server (no DOM library), reading where each number was placed.
import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider, createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import type { ContainerInfo, ManifestV4 } from '../../core';
import { ViewerEnv } from '../env';
import { manifestAtom } from '../atoms';
import { localAnnotationPagesAtom, selectedCanvasAnnotationAtom } from './canvasAnnotationState';
import { AnnotationOverlayView } from './AnnotationOverlay';

const canvasId = 'https://example.org/canvas/1';

const annotation = (id: string, target: string) => ({
  id,
  type: 'Annotation',
  motivation: 'commenting',
  body: { type: 'TextualBody', value: id },
  target: `${canvasId}#${target}`,
});

const polygon = (id: string, points: string) => ({
  id,
  type: 'Annotation',
  motivation: 'commenting',
  body: { type: 'TextualBody', value: id },
  target: {
    type: 'SpecificResource',
    source: canvasId,
    selector: { type: 'SvgSelector', value: `<svg xmlns="http://www.w3.org/2000/svg"><polygon points="${points}"/></svg>` },
  },
});

const point = (id: string, x: number, y: number) => ({
  id,
  type: 'Annotation',
  motivation: 'commenting',
  body: { type: 'TextualBody', value: id },
  target: { type: 'SpecificResource', source: canvasId, selector: { type: 'PointSelector', x, y } },
});

const render = (width: number, height: number, items: unknown[], selected?: string) => {
  const container: ContainerInfo = { id: canvasId, kind: 'Canvas', label: 'p1', width, height, painting: [], supplementing: [] };
  const manifest = { id: 'https://example.org/manifest', type: 'Manifest', items: [{ id: canvasId, type: 'Canvas', width, height, items: [] }] };
  const store = createStore();
  store.set(manifestAtom, manifest as unknown as ManifestV4 as never);
  store.set(localAnnotationPagesAtom, [{ source: 'test', canvasId, page: { id: 'urn:page', type: 'AnnotationPage', items } }]);
  if (selected) store.set(selectedCanvasAnnotationAtom, selected as never);
  return renderToStaticMarkup(
    createElement(
      Provider,
      { store },
      createElement(
        ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light'; children?: ReactNode }>,
        { locale: 'en', resolvedTheme: 'light' },
        createElement(AnnotationOverlayView, { container, canvasWidth: width, canvasHeight: height }),
      ),
    ),
  );
};

// Each number badge: its side, number, anchor (percent), and the rest of its markup. Attributes are read one by one,
// so the order of the props and of the style keys does not matter.
const badges = (html: string) =>
  [...html.matchAll(/<span([^>]*data-number-side="[^"]*"[^>]*)>(\d+)<\/span>/g)]
    .map((m) => {
      const attrs = m[1];
      const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
      const style = attr('style');
      const prop = (name: string) => Number(new RegExp(`(?:^|;)${name}:([-\\d.]+)%`).exec(style)?.[1]);
      return {
        side: attr('data-number-side'),
        n: Number(m[2]),
        left: prop('left'),
        top: prop('top'),
        inside: attrs.includes('data-number-inside'),
        className: attr('class'),
        style,
      };
    })
    .sort((a, b) => a.n - b.n); // the marks are drawn smaller in front, not in the order of the list

describe('the numbers on the marks', () => {
  it('go above a tall box (centred) and to the left of a wide one (centred), outside the box', () => {
    const html = render(1000, 1000, [
      annotation('urn:tall', 'xywh=100,100,20,300'),
      annotation('urn:wide', 'xywh=400,500,300,20'),
      annotation('urn:square', 'xywh=600,100,100,100'),
    ]);
    const b = badges(html);
    expect(b.map(({ side, n, left, top, inside }) => ({ side, n, left, top, inside }))).toEqual([
      { side: 'top', n: 1, left: 11, top: 10, inside: false },
      { side: 'left', n: 2, left: 40, top: 51, inside: false },
      { side: 'left', n: 3, left: 60, top: 15, inside: false },
    ]);
    // the badge is moved off the edge by its own size, so it does not cover the box
    expect(b[0].style).toContain('translate(-50%, calc(-100% - 2px))');
    expect(b[1].style).toContain('translate(calc(-100% - 2px), -50%)');
  });

  it('decide tall or wide in Canvas units, not in percents of the two axes', () => {
    // 100 x 200 units on a 1000 x 4000 Canvas is 10% wide and 5% high, but it is a tall box
    expect(badges(render(1000, 4000, [annotation('urn:a', 'xywh=0,0,100,200')]))[0].side).toBe('top');
  });

  it('follow the same rule for a polygon (its bounding box) and sit on a point', () => {
    const html = render(1000, 1000, [polygon('urn:poly', '100,100 120,100 120,400 100,400'), point('urn:pt', 500, 500)]);
    expect(badges(html).map((b) => b.side)).toEqual(['top', 'point']);
  });

  it('are not drawn inside the box any more (they would cover the text of a line)', () => {
    const html = render(1000, 1000, [annotation('urn:tall', 'xywh=100,100,20,300')]);
    expect(html).not.toMatch(/rounded-br[^"]*tabular-nums/);
  });

  it('keep the colour of the selection', () => {
    const html = render(1000, 1000, [annotation('urn:tall', 'xywh=100,100,20,300')], 'urn:tall');
    expect(badges(html)[0].className).toContain('bg-orange-500');
  });

  it('go just inside a box at the top or left edge of the Canvas, where the viewport would cut them off', () => {
    const b = badges(
      render(1000, 1000, [
        annotation('urn:tall-at-top', 'xywh=100,0,20,300'),
        annotation('urn:wide-at-left', 'xywh=0,500,300,20'),
        annotation('urn:tall-below-top', 'xywh=500,100,20,300'),
      ]),
    );
    expect(b.map(({ side, inside }) => ({ side, inside }))).toEqual([
      { side: 'top', inside: true },
      { side: 'left', inside: true },
      { side: 'top', inside: false },
    ]);
    expect(b[0].style).toContain('translate(-50%, 2px)');
    expect(b[1].style).toContain('translate(2px, -50%)');
  });

  it('can be clicked (they stand for their box) and are drawn above the marks', () => {
    // the old number inside a rectangle selected it on a click; the number outside must too
    const b = badges(render(1000, 1000, [annotation('urn:tall', 'xywh=100,100,20,300')]))[0];
    expect(b.className).toContain('pointer-events-auto');
    expect(b.className).not.toContain('pointer-events-none');
    expect(b.className).toContain('z-10');
  });
});
