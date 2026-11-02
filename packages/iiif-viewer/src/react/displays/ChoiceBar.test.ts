import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerEnv } from '../env';
import type { PaintingContent } from '../../core';
import ChoiceBar, { compareBIndex, type ChoiceCompareControls } from './ChoiceBar';

const painting: PaintingContent = {
  id: 'https://e/canvas/1/painting',
  label: undefined,
  options: [
    { url: 'https://e/vl.jpg', kind: 'Image', label: { en: ['VL'], ja: ['可視光'] } },
    { url: 'https://e/ir.jpg', kind: 'Image', label: { en: ['IR'], ja: ['赤外光'] } },
    { url: 'https://e/uvf.jpg', kind: 'Image', label: { en: ['UVF'], ja: ['紫外蛍光'] } },
  ],
} as PaintingContent;

const controls = (mode: ChoiceCompareControls['mode']): ChoiceCompareControls => ({
  mode,
  onModeChange: () => {},
  b: 2,
  onBChange: () => {},
  opacity: 0.5,
  onOpacityChange: () => {},
});

const render = (compare?: ChoiceCompareControls) =>
  renderToStaticMarkup(
    createElement(
      ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light' }>,
      { locale: 'en', resolvedTheme: 'light' },
      createElement(ChoiceBar, { painting, index: 0, onChange: () => {}, compare }),
    ),
  );

describe('ChoiceBar compare', () => {
  it('has no compare menu without controls (a video or audio Choice)', () => {
    expect(render()).not.toContain('iiif-viewer-choice-compare');
  });

  it('offers the compare modes, but no B menu while not comparing', () => {
    const html = render(controls('single'));
    expect(html).toContain('id="iiif-viewer-choice-compare"');
    for (const m of ['Swipe', 'Spyglass', 'Overlay', 'Side by side']) expect(html).toContain(m);
    expect(html).not.toContain('iiif-viewer-choice-b');
  });

  it('shows the B menu when comparing, and the opacity only in overlay', () => {
    expect(render(controls('swipe'))).toContain('id="iiif-viewer-choice-b"');
    expect(render(controls('swipe'))).not.toContain('type="range"');
    expect(render(controls('overlay'))).toContain('type="range"');
  });
});

describe('compareBIndex', () => {
  it('takes the candidate after A by default, wrapping round', () => {
    expect(compareBIndex(undefined, 0, 5)).toBe(1);
    expect(compareBIndex(undefined, 4, 5)).toBe(0);
  });

  it('keeps the chosen B unless it is A or out of range', () => {
    expect(compareBIndex(3, 0, 5)).toBe(3);
    expect(compareBIndex(0, 0, 5)).toBe(1);
    expect(compareBIndex(7, 0, 5)).toBe(1);
  });
});
