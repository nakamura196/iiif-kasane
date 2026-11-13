import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { containersOf, convertToV4 } from '../../core';
import { ViewerEnv } from '../env';
import { messages } from '../messages';
import { sceneDisplay } from './SceneDisplay';
import type { DisplayProps } from './types';

// SceneDisplay rendered on the server (no DOM needed): what it shows for a Scene, and for one that cannot be parsed.

afterEach(() => {
  vi.restoreAllMocks();
});

const scene = (id: string, selector: object) => ({
  id,
  type: 'Scene',
  items: [],
  annotations: [
    {
      type: 'AnnotationPage',
      id: `${id}/notes`,
      items: [
        {
          id: `${id}/note`,
          type: 'Annotation',
          motivation: ['commenting'],
          body: { type: 'TextualBody', value: 'x' },
          target: { type: 'SpecificResource', source: { id, type: 'Scene' }, selector: [selector] },
        },
      ],
    },
  ],
});

const render = (selector: object) => {
  const id = 'https://example.org/sd/m.json';
  const manifest = convertToV4({
    '@context': 'http://iiif.io/api/presentation/4/context.json',
    id,
    type: 'Manifest',
    label: { en: ['m'] },
    items: [scene(`${id}/scene/1`, { type: 'PointSelector', x: 0, y: 0, z: 0 }), scene(`${id}/scene/2`, selector)],
  });
  const containers = containersOf(manifest);
  const props = {
    container: containers[1],
    containers,
    manifest,
    iiifContent: id,
    shownUrl: id,
    selectedIndex: 1,
    renderActions: () => createElement('button', { id: 'host-action' }, 'host'),
  } as unknown as DisplayProps;
  const Component = sceneDisplay.Component;
  return renderToStaticMarkup(createElement(ViewerEnv, { locale: 'en', messages: messages as never, children: createElement(Component, props) } as never));
};

describe('SceneDisplay', () => {
  it('keeps one root element, with the host actions, for a Scene that can be parsed', () => {
    const html = render({ type: 'PointSelector', x: 1, y: 1, z: 1 });
    expect(html.startsWith('<div class="relative flex-1')).toBe(true);
    expect(html).toContain('host-action');
    expect(html).not.toContain('role="alert"');
  });

  it('shows a notice inside the same root element, and keeps the host actions, for a Scene that cannot be parsed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = render({ type: 'WKTSelector' });
    // the same root as above (the ResizeObserver on it keeps working), not a different element
    expect(html.startsWith('<div class="relative flex-1')).toBe(true);
    expect(html).toContain('role="alert"');
    expect(html).toContain('host-action');
  });
});
