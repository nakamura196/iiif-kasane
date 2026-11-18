import { test, expect, devices, type Locator, type Page } from '@playwright/test';

// The controls over the map and the image of /georef must not cover one another on a phone
// (they did: the place search sat on "Group nearby places", the image buttons broke onto two lines each,
// and the map credits covered "Overlay image").

const BASE = 'https://georef-layout.example.org';
// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const feature = (n: number, xy: [number, number], lnglat: [number, number]) => ({
  type: 'Feature',
  id: `p-${n}`,
  properties: { resourceCoords: xy, title: `Place ${n}` },
  geometry: { type: 'Point', coordinates: lnglat },
});

const manifest = {
  '@context': ['http://iiif.io/api/extension/georef/1/context.json', 'http://iiif.io/api/presentation/3/context.json'],
  id: `${BASE}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Map'] },
  items: [
    {
      id: `${BASE}/canvas/1`,
      type: 'Canvas',
      width: 1000,
      height: 800,
      items: [
        {
          id: `${BASE}/canvas/1/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/1/page/1`,
              type: 'Annotation',
              motivation: 'painting',
              body: { id: `${BASE}/image.png`, type: 'Image', format: 'image/png', width: 1000, height: 800 },
              target: `${BASE}/canvas/1`,
            },
          ],
        },
      ],
      annotations: [
        {
          id: `${BASE}/canvas/1/georef`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/1/georef/1`,
              type: 'Annotation',
              motivation: 'georeferencing',
              target: `${BASE}/canvas/1`,
              body: {
                type: 'FeatureCollection',
                transformation: { type: 'polynomial', options: { order: 1 } },
                features: [
                  feature(1, [100, 100], [135.0, 35.0]),
                  feature(2, [900, 100], [136.0, 35.0]),
                  feature(3, [500, 700], [135.5, 34.4]),
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

// A basemap with no tiles but a long credit line, in place of OpenFreeMap (an outside site)
const style = {
  version: 8,
  sources: {
    empty: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: 'Test basemap © Example contributors, a credit line long enough to cover the controls below',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#dde' } },
    // a layer that uses the source, so that its credit line is shown
    { id: 'empty', type: 'circle', source: 'empty' },
  ],
};

async function open(page: Page) {
  await page.route(`${BASE}/**`, (route) =>
    route.request().url().endsWith('.png')
      ? route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ json: manifest, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: style, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto(`/en/georef/?u=${encodeURIComponent(`${BASE}/manifest.json`)}`);
  await expect(page.getByRole('searchbox', { name: 'Search places' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rotation/ })).toBeVisible();
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b, 'element is laid out').not.toBeNull();
  return b!;
};

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });

test('on a phone the controls over the map and the image do not cover one another', async ({ page }) => {
  await open(page);

  // Map: "Group nearby places" is not covered by the place search or the basemap menu
  const cluster = await box(page.getByText('Group nearby places'));
  const search = await box(page.getByRole('search'));
  const basemap = await box(page.getByRole('combobox', { name: 'Base map' }));
  expect(overlaps(cluster, search), 'search covers "Group nearby places"').toBe(false);
  expect(overlaps(cluster, basemap), 'basemap menu covers "Group nearby places"').toBe(false);

  // Image: each button keeps its label on one line (one line of text is about 20px high)
  for (const [label, l] of [
    ['Open in the viewer', page.getByRole('link', { name: 'Open in the viewer' })],
    ['Marks on the image', page.getByText('Marks on the image')],
    ['Rotation', page.getByRole('button', { name: /Rotation/ })],
  ] as const) {
    expect((await box(l)).height, `"${label}" is broken onto several lines`).toBeLessThan(40);
  }

  // The map credits are folded into the "i" button, so they do not cover "Overlay image"
  const overlay = await box(page.getByText('Overlay image'));
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toHaveClass(/maplibregl-compact/);
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
  expect(overlaps(overlay, await box(attrib)), 'credits cover "Overlay image"').toBe(false);
});
