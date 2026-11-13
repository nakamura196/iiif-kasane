import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { containersOf, convertToV4 } from '../../core';
import { ViewerEnv } from '../env';
import { messages } from '../messages';
import { createStore } from 'jotai';
import { annotationsAtom, paintedModelsAtom, sceneIdAtom, selectedAnnotationIdAtom } from '../atoms';
import { tryPrepareShow } from '../useManifest';
import { sceneDisplay, writeSceneState } from './SceneDisplay';
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

// Scenes whose models are SpecificResource-wrapped (as in the Smithsonian Triceratops sample): two Scenes, one model each.
const wrapped = (id: string) => {
  const sceneOf = (n: number) => ({
    id: `${id}/scene/${n}`,
    type: 'Scene',
    items: [
      {
        id: `${id}/scene/${n}/page`,
        type: 'AnnotationPage',
        items: [
          {
            id: `${id}/scene/${n}/model`,
            type: 'Annotation',
            motivation: ['painting'],
            body: { type: 'SpecificResource', source: { id: `https://example.org/model-${n}.glb`, type: 'Model', format: 'model/gltf-binary' } },
            target: { id: `${id}/scene/${n}`, type: 'Scene' },
          },
        ],
      },
    ],
    annotations: [
      {
        type: 'AnnotationPage',
        id: `${id}/scene/${n}/notes`,
        items: [
          {
            id: `${id}/scene/${n}/note`,
            type: 'Annotation',
            motivation: ['commenting'],
            label: { en: [`note ${n}`] },
            body: { type: 'TextualBody', value: `note ${n}` },
            target: { type: 'SpecificResource', source: { id: `${id}/scene/${n}`, type: 'Scene' }, selector: [{ type: 'PointSelector', x: 0, y: 0, z: 0 }] },
          },
        ],
      },
    ],
  });
  return convertToV4({
    '@context': 'http://iiif.io/api/presentation/4/context.json',
    id,
    type: 'Manifest',
    label: { en: ['wrapped'] },
    items: [sceneOf(1), sceneOf(2)],
  });
};

describe('SceneDisplay with SpecificResource-wrapped models', () => {
  const props = (manifest: ReturnType<typeof wrapped>, i: number) => {
    const containers = containersOf(manifest);
    return { container: containers[i], containers, manifest, iiifContent: 'x', shownUrl: 'x', selectedIndex: i } as unknown as DisplayProps;
  };
  const html = (p: DisplayProps) =>
    renderToStaticMarkup(createElement(ViewerEnv, { locale: 'en', messages: messages as never, children: createElement(sceneDisplay.Component, p) } as never));

  it('draws its model from the manifest it is given (also one a host set itself), without waiting for an effect', () => {
    const manifest = wrapped('https://example.org/wr/m.json');
    // the Suspense fallback of the 3D canvas shows only when a model URL was found in this render
    expect(html(props(manifest, 1))).toContain('Viewer.loading');
  });

  it('puts the Scene it draws in the store: Scene 2 gives Scene 2 model and notes, and clears the selection', () => {
    const manifest = wrapped('https://example.org/wr2/m.json');
    const store = createStore();
    store.set(selectedAnnotationIdAtom, 'old');
    writeSceneState(store, `${manifest.id}/scene/2`, tryPrepareShow(manifest, 'en', `${manifest.id}/scene/2`));
    expect(store.get(sceneIdAtom)).toBe(`${manifest.id}/scene/2`);
    expect(store.get(paintedModelsAtom)[0].options[0].url).toBe('https://example.org/model-2.glb');
    expect(store.get(annotationsAtom).map((a) => a.title)).toEqual(['note 2']);
    expect(store.get(selectedAnnotationIdAtom)).toBeNull();
  });
});
