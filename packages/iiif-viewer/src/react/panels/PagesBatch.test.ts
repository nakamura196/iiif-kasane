import { Provider, createStore } from 'jotai';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContainerInfo } from '../../core';
import { batchStateAtom, type BatchState } from '../inference/batch';
import { inferenceResultsAtom, resultKey, type InferenceResult } from '../inference/state';
import { PageThumbMarks, PagesReadingStyle, batchModelAtom, batchStatusOf } from './PagesBatch';

const page = { id: 'c1', kind: 'Canvas', label: {}, width: 100, height: 100, painting: [], supplementing: [] } as ContainerInfo;
const result = {
  canvasId: 'c1',
  modelId: 'm1',
  page: {
    items: [{ type: 'Annotation', target: 'c1#xywh=1,1,10,10', body: { type: 'TextualBody', value: 'a' } }],
  },
} as unknown as InferenceResult;

const batch = (s: Partial<BatchState>): BatchState => ({
  modelId: 'm1',
  total: 2,
  done: 0,
  failed: 0,
  current: null,
  running: true,
  stopped: false,
  ...s,
});

const render = (state: BatchState | null, withResult: boolean) => {
  const store = createStore();
  store.set(batchModelAtom, 'm1');
  store.set(batchStateAtom, state);
  if (withResult) store.set(inferenceResultsAtom, { [resultKey('c1', 'm1')]: result });
  return renderToStaticMarkup(createElement(Provider, { store }, createElement(PageThumbMarks, { page })));
};

describe('how a page looks in the pages grid during a run', () => {
  it('shows the scan line and the glowing frame on the page being read', () => {
    const html = render(batch({ current: 'c1' }), false);
    expect(html).toContain('kasane-scan-frame');
    expect(html).toContain('kasane-scan-sweep');
  });

  it('shows nothing on a page that is not being read', () => {
    expect(render(batch({ current: 'other' }), false)).toBe('');
    expect(render(batch({ current: 'c1', running: false }), false)).toBe('');
  });

  it('flashes once and fades the marks in on the page just read', () => {
    const html = render(batch({ current: 'c2', lastRead: 'c1' }), true);
    expect(html).toContain('kasane-scan-done');
    expect(html).toContain('kasane-marks-in');
    expect(html).not.toContain('kasane-scan-frame');
  });

  it('shows a result plainly when it was not just read (opened later, or read in the inference tab)', () => {
    for (const state of [null, batch({ running: false, lastRead: null }), batch({ running: false, lastRead: 'c1', modelId: 'm2' })]) {
      const html = render(state, true);
      expect(html).toContain('<svg');
      expect(html).not.toContain('kasane-scan-done');
      expect(html).not.toContain('kasane-marks-in');
    }
  });

  it('keeps a still frame on the page being read when reduced motion is asked for', () => {
    const css = renderToStaticMarkup(createElement(PagesReadingStyle));
    // The frame is drawn outside the animation, so turning the animation off leaves it
    const frame = /\.kasane-scan-frame \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(frame).toContain('box-shadow');
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.kasane-scan-frame[^{]*\{ animation: none; \}/);
    expect(reduced).not.toMatch(/kasane-scan-frame[^{]*\{ display: none/);
  });
});

describe('the message under the run button', () => {
  it('says the run is waiting while the image server refuses', () => {
    expect(batchStatusOf(batch({ done: 1, waiting: true }), 'm1')).toEqual({ key: 'batchWaiting', values: { done: 1, total: 2 } });
    expect(batchStatusOf(batch({ done: 1 }), 'm1')?.key).toBe('batchProgress');
  });

  it('tells a stop by the image server from a stop by the user', () => {
    expect(batchStatusOf(batch({ running: false, stopped: true, blocked: true, done: 1 }), 'm1')?.key).toBe('batchBlocked');
    expect(batchStatusOf(batch({ running: false, stopped: true, done: 1 }), 'm1')?.key).toBe('batchStopped');
    expect(batchStatusOf(batch({ running: false, done: 2 }), 'm1')).toEqual({ key: 'batchDone', values: { total: 2 } });
  });

  it('says nothing for another model', () => {
    expect(batchStatusOf(batch({}), 'm2')).toBeNull();
  });
});
