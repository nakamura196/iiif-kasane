import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStore, Provider } from 'jotai';
import { describe, expect, it } from 'vitest';
import { containersOf, convertToV4, manifestThumbnailOf, pageThumbnailUrl, upgradeToV3 } from '../../core';
import { shownManifestAtom } from '../atoms';
import { ViewerEnv } from '../env';
import { compareMultiAtom } from '../internalState';
import { messages } from '../messages';
import { pagedDisplay, pagePaintOf } from './PagedDisplay';
import type { DisplayProps } from './types';

const ID = 'https://example.org/book/manifest.json';

const serviceCanvas = (n: number) => ({
  id: `https://example.org/book/${n}/canvas`,
  type: 'Canvas',
  label: { none: [`page${n}`] },
  width: 4722,
  height: 4717,
  items: [
    {
      id: `https://example.org/book/${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `https://example.org/book/${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body: {
            id: `https://example.org/book/${n}/page00${n}`,
            type: 'Image',
            format: 'image/jpeg',
            width: 4722,
            height: 4717,
            service: [{ id: `https://example.org/book/${n}/page00${n}`, type: 'ImageService2', profile: 'level0' }],
          },
          target: `https://example.org/book/${n}/canvas`,
        },
      ],
    },
  ],
});

const plainCanvas = (n: number) => ({
  id: `https://example.org/plain/${n}/canvas`,
  type: 'Canvas',
  label: { none: [`p${n}`] },
  width: 1200,
  height: 800,
  items: [
    {
      id: `https://example.org/plain/${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `https://example.org/plain/${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body: {
            id: `https://example.org/plain/p${n}.png`,
            type: 'Image',
            format: 'image/png',
            width: 1200,
            height: 800,
          },
          target: `https://example.org/plain/${n}/canvas`,
        },
      ],
    },
  ],
});

const renderSpread = (
  raw: Record<string, unknown>,
  selectedIndex = 1,
  setup?: (store: ReturnType<typeof createStore>) => void,
) => {
  const manifest = convertToV4(structuredClone(raw));
  const containers = containersOf(manifest);
  const store = createStore();
  store.set(shownManifestAtom, {
    url: String(raw.id),
    raw,
    manifest,
    seq: 1,
    origin: 'content',
    hasGeo: false,
  });
  setup?.(store);
  const props: DisplayProps = {
    container: containers[selectedIndex],
    containers,
    manifest,
    iiifContent: String(raw.id),
    shownUrl: String(raw.id),
    selectedIndex,
    select: () => {},
  };
  const Component = pagedDisplay.Component;
  return renderToStaticMarkup(
    createElement(
      Provider,
      { store },
      createElement(ViewerEnv, {
        locale: 'en',
        messages: messages as never,
        children: createElement(Component, props),
      } as never),
    ),
  );
};

describe('PagedDisplay', () => {
  it('does not request the bare body.id as an <img> on a spread whose pages declare an Image API service', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      label: { en: ['Book'] },
      behavior: ['paged'],
      items: [1, 2, 3, 4].map(serviceCanvas),
    };
    const html = renderSpread(raw, 1);
    expect(html).not.toContain('src="https://example.org/book/2/page002"');
    expect(html).not.toContain('src="https://example.org/book/3/page003"');
    expect(html).toContain('data-canvas-id="https://example.org/book/2/canvas"');
    expect(html).toContain('data-canvas-id="https://example.org/book/3/canvas"');
  });

  it('does not request the bare body.id as an <img> on a continuous strip whose pages declare an Image API service', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      label: { en: ['Scroll'] },
      behavior: ['continuous'],
      items: [1, 2, 3].map(serviceCanvas),
    };
    const html = renderSpread(raw, 0);
    expect(html).not.toContain('src="https://example.org/book/1/page001"');
    expect(html).not.toContain('src="https://example.org/book/2/page002"');
    expect(html).toContain('data-iiif-strip=""');
    expect(html).toContain('data-canvas-id="https://example.org/book/1/canvas"');
  });

  it('keeps plain <img data-canvas-id> elements on a spread without an Image API service', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://example.org/plain/manifest.json',
      type: 'Manifest',
      label: { en: ['Plain'] },
      behavior: ['paged'],
      items: [1, 2, 3].map(plainCanvas),
    };
    const html = renderSpread(raw, 1);
    expect(html).toContain('src="https://example.org/plain/p2.png"');
    expect(html).toContain('src="https://example.org/plain/p3.png"');
    expect(html).toContain('data-canvas-id="https://example.org/plain/2/canvas"');
    expect(html).toContain('data-canvas-id="https://example.org/plain/3/canvas"');
  });

  it('stages remote Canvases in cross-manifest comparisons (compareMultiAtom) using their served JSON', () => {
    const rawA = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      label: { en: ['Book A'] },
      items: [serviceCanvas(1)],
    };
    const rawB = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://example.org/book-b/manifest.json',
      type: 'Manifest',
      label: { en: ['Book B'] },
      items: [serviceCanvas(2)],
    };
    const cA = containersOf(convertToV4(structuredClone(rawA)))[0];
    const cB = containersOf(convertToV4(structuredClone(rawB)))[0];
    const html = renderSpread(rawA, 0, (store) => {
      store.set(compareMultiAtom, {
        anchor: 0,
        items: [
          { container: cA, manifestLabel: 'Book A', sourceIndex: 0 },
          { container: cB, manifestLabel: 'Book B', sourceIndex: 1 },
        ],
        failed: [],
        raws: [rawA, rawB],
      });
    });
    expect(html).not.toContain('src="https://example.org/book/1/page001"');
    expect(html).not.toContain('src="https://example.org/book/2/page002"');
    expect(html).toContain('data-canvas-id="https://example.org/book/1/canvas"');
    expect(html).toContain('data-canvas-id="https://example.org/book/2/canvas"');
  });
});

describe('pagePaintOf', () => {
  it('stages a Canvas whose painting declares an Image API service and keeps a plain Canvas unstaged', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [serviceCanvas(1), plainCanvas(2)],
    };
    const containers = containersOf(convertToV4(structuredClone(raw)));
    const staged = pagePaintOf(raw, containers[0]);
    expect(staged?.staged).toBe(true);
    expect(staged?.layers).toHaveLength(1);
    expect(staged?.layers[0].layer.service?.id).toBe('https://example.org/book/1/page001');

    const plain = pagePaintOf(raw, containers[1]);
    expect(plain?.staged).toBe(false);
    expect(plain?.plainUrl).toBe('https://example.org/plain/p2.png');
  });

  it('never falls back to bare body.id even when both the Canvas and body omit width and height', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [
        {
          id: 'https://example.org/dimless/canvas',
          type: 'Canvas',
          items: [
            {
              id: 'https://example.org/dimless/page',
              type: 'AnnotationPage',
              items: [
                {
                  id: 'https://example.org/dimless/anno',
                  type: 'Annotation',
                  motivation: 'painting',
                  body: {
                    id: 'https://example.org/dimless/img',
                    type: 'Image',
                    service: [{ id: 'https://example.org/dimless/img', type: 'ImageService2', profile: 'level0' }],
                  },
                  target: 'https://example.org/dimless/canvas',
                },
              ],
            },
          ],
        },
      ],
    };
    const containers = containersOf(convertToV4(structuredClone(raw)));
    const paint = pagePaintOf(raw, containers[0]);
    expect(paint?.staged).toBe(true);
    expect(paint?.plainUrl).toBeUndefined();
    expect(paint?.layers[0].layer.service?.id).toBe('https://example.org/dimless/img');
  });

  it('stages Presentation 2 paged Canvases upgraded through upgradeToV3', () => {
    const v2 = {
      '@context': 'http://iiif.io/api/presentation/2/context.json',
      '@id': 'https://example.org/v2/manifest.json',
      '@type': 'sc:Manifest',
      viewingHint: 'paged',
      sequences: [
        {
          '@type': 'sc:Sequence',
          canvases: [1, 2].map((n) => ({
            '@id': `https://example.org/v2/canvas/${n}`,
            '@type': 'sc:Canvas',
            width: 2000,
            height: 3000,
            images: [
              {
                '@type': 'oa:Annotation',
                motivation: 'sc:painting',
                on: `https://example.org/v2/canvas/${n}`,
                resource: {
                  '@id': `https://example.org/v2/img${n}`,
                  '@type': 'dctypes:Image',
                  service: {
                    '@context': 'http://iiif.io/api/image/2/context.json',
                    '@id': `https://example.org/v2/img${n}`,
                    profile: 'http://iiif.io/api/image/2/level0.json',
                  },
                },
              },
            ],
          })),
        },
      ],
    };
    const raw = upgradeToV3(v2);
    const containers = containersOf(convertToV4(structuredClone(raw)));
    const paint = pagePaintOf(raw, containers[1]);
    expect(paint?.staged).toBe(true);
    expect(paint?.layers[0].layer.service?.id).toBe('https://example.org/v2/img2');
  });

  it('respects Choice selection, layer order and opacity from layer settings', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [
        {
          id: 'https://example.org/choice/canvas',
          type: 'Canvas',
          width: 1000,
          height: 1000,
          items: [
            {
              id: 'https://example.org/choice/page',
              type: 'AnnotationPage',
              items: [
                {
                  id: 'https://example.org/choice/paint-1',
                  type: 'Annotation',
                  motivation: 'painting',
                  body: {
                    type: 'Choice',
                    items: [
                      { id: 'https://example.org/choice/a.png', type: 'Image', width: 1000, height: 1000 },
                      { id: 'https://example.org/choice/b.png', type: 'Image', width: 1000, height: 1000 },
                    ],
                  },
                  target: 'https://example.org/choice/canvas',
                },
              ],
            },
          ],
        },
      ],
    };
    const containers = containersOf(convertToV4(structuredClone(raw)));
    const picked = pagePaintOf(raw, containers[0], {
      'https://example.org/choice/paint-1::0': { visible: false },
      'https://example.org/choice/paint-1::1': { visible: true, opacity: 0.6 },
    });
    expect(picked?.staged).toBe(true);
    expect(picked?.layers.map((l) => ({ url: l.layer.url, opacity: l.opacity }))).toEqual([
      { url: 'https://example.org/choice/b.png', opacity: 0.6 },
    ]);
  });

  it('stages a SpecificResource layer carrying ImageApiSelector rotation and region', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [
        {
          id: 'https://example.org/rot/canvas',
          type: 'Canvas',
          width: 800,
          height: 1200,
          items: [
            {
              id: 'https://example.org/rot/page',
              type: 'AnnotationPage',
              items: [
                {
                  id: 'https://example.org/rot/anno',
                  type: 'Annotation',
                  motivation: 'painting',
                  body: {
                    type: 'SpecificResource',
                    source: {
                      id: 'https://example.org/rot/scan.jpg',
                      type: 'Image',
                      width: 1600,
                      height: 1200,
                    },
                    selector: {
                      type: 'ImageApiSelector',
                      region: '0,0,800,1200',
                      rotation: '90',
                    },
                  },
                  target: 'https://example.org/rot/canvas',
                },
              ],
            },
          ],
        },
      ],
    };
    const placeholderContainer = {
      id: 'https://example.org/rot/canvas',
      kind: 'Canvas' as const,
      label: {},
      width: 800,
      height: 1200,
      painting: [],
      supplementing: [],
    };
    const paint = pagePaintOf(raw, placeholderContainer);
    expect(paint?.staged).toBe(true);
    expect(paint?.layers[0].layer.rotation).toBe(90);
    expect(paint?.layers[0].layer.regionSpec).toBe('0,0,800,1200');
  });
});

describe('level 0 thumbnails without sizes', () => {
  it('avoids bare body.id and unsupported /full/,H/ URLs on static level 0 services', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [serviceCanvas(1)],
    };
    const containers = containersOf(convertToV4(structuredClone(raw)));
    expect(manifestThumbnailOf(raw)).toBeUndefined();
    expect(pageThumbnailUrl(containers[0], raw.items[0])).toBeUndefined();
  });

  it('uses declared service sizes when available on a level 0 service', () => {
    const raw = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: ID,
      type: 'Manifest',
      items: [
        {
          ...serviceCanvas(1),
          items: [
            {
              id: 'https://example.org/book/1/page',
              type: 'AnnotationPage',
              items: [
                {
                  id: 'https://example.org/book/1/image',
                  type: 'Annotation',
                  motivation: 'painting',
                  body: {
                    id: 'https://example.org/book/1/page001',
                    type: 'Image',
                    service: [
                      {
                        id: 'https://example.org/book/1/page001',
                        type: 'ImageService2',
                        profile: 'level0',
                        sizes: [
                          { width: 150, height: 150 },
                          { width: 300, height: 300 },
                        ],
                      },
                    ],
                  },
                  target: 'https://example.org/book/1/canvas',
                },
              ],
            },
          ],
        },
      ],
    };
    const containers = containersOf(convertToV4(structuredClone(raw)));
    expect(manifestThumbnailOf(raw, 192)).toBe('https://example.org/book/1/page001/full/300,/0/default.jpg');
    expect(pageThumbnailUrl(containers[0], raw.items[0], 96)).toBe(
      'https://example.org/book/1/page001/full/150,/0/default.jpg',
    );
  });
});
