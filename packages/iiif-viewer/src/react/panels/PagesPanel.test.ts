// The pages tab shows the run over every page the same way in both layouts. Until this test, the run controls, the
// scan line on the page being read and the marks over the thumbnails were drawn in the grid only, so someone in the
// list view (the default) could not find the run at all.
import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import type { ManifestV4 } from '../../core';
import { ViewerEnv } from '../env';
import { manifestAtom } from '../atoms';
import { batchStateAtom, type BatchState } from '../inference/batch';
import { batchModelAtom } from './PagesBatch';
import { pagesPanel } from './PagesPanel';

// The real run bar first looks up the downloaded models in an effect, which server rendering never runs, so it
// would render nothing here. A stand-in shows whether the panel places the bar at all.
vi.mock('./PagesBatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./PagesBatch')>()),
  PagesBatchBar: () => createElement('div', { 'data-testid': 'batch-bar' }),
}));

const canvas = (n: number) => ({
  id: `https://example.org/canvas/${n}`,
  type: 'Canvas',
  label: { en: [`p${n}`] },
  width: 1000,
  height: 1400,
  thumbnail: [{ id: `https://example.org/thumb/${n}.jpg`, type: 'Image', format: 'image/jpeg' }],
  items: [],
});
const manifest = { id: 'https://example.org/manifest', type: 'Manifest', items: [canvas(1), canvas(2)] } as unknown as ManifestV4;

const running: BatchState = {
  modelId: 'm1',
  total: 2,
  done: 0,
  failed: 0,
  current: 'https://example.org/canvas/1',
  running: true,
  stopped: false,
};

// Server rendering runs no effects, so the layout stays at its first value: the list
const renderList = () => {
  const store = createStore();
  store.set(manifestAtom, manifest);
  store.set(batchModelAtom, 'm1');
  store.set(batchStateAtom, running);
  const Panel = pagesPanel.Component as FunctionComponent<Record<string, unknown>>;
  return renderToStaticMarkup(
    createElement(
      Provider,
      { store },
      createElement(
        ViewerEnv as FunctionComponent<{ locale: string; resolvedTheme: 'light'; children?: ReactNode }>,
        { locale: 'en', resolvedTheme: 'light' },
        createElement(Panel, { manifest, container: null }),
      ),
    ),
  );
};

describe('the run over every page in the list view of the pages tab', () => {
  it('is the list view that is rendered here', () => {
    expect(renderList()).toMatch(/aria-pressed="true"[^>]*title="List"/);
  });

  it('has the run controls, not only the grid', () => {
    expect(renderList()).toContain('data-testid="batch-bar"');
  });

  it('marks the page being read, so the list can follow it', () => {
    const html = renderList();
    expect(html.match(/data-reading="true"/g)?.length).toBe(1);
  });

  it('shows the scan line on the thumbnail of the page being read, with its styles', () => {
    const html = renderList();
    expect(html).toContain('kasane-scan-frame');
    expect(html).toContain('@keyframes kasane-scan-sweep');
  });
});
