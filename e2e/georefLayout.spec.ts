import { test, expect, devices, type Locator, type Page } from '@playwright/test';

// On a phone, /georef keeps only the main controls over the map and the image (the place search and
// the current location) and puts the rest in one menu per pane. Before, the controls covered one another
// and much of the map: the place search sat on "Group nearby places", the image buttons broke onto
// two lines each, and the map credits covered "Overlay image".

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
  await expect(page.getByRole('button', { name: 'Image settings' })).toBeVisible();
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b, 'element is laid out').not.toBeNull();
  return b!;
};

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });

test('on a phone the map and the image show only the main controls, the rest in a menu', async ({ page }) => {
  await open(page);

  // Map: the search and the current location stay; the zoom buttons, "Show all" and the rest do not
  await expect(page.getByRole('searchbox', { name: 'Search places' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find my location' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show all' })).toBeHidden();
  await expect(page.getByText('Group nearby places')).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Base map' })).toBeHidden();
  await expect(page.getByText('Overlay image')).toBeHidden();

  // ...and they are in the map menu
  await page.getByRole('button', { name: 'Map settings' }).click();
  const mapMenu = page.getByRole('group', { name: 'Map settings' });
  await expect(mapMenu.getByText('Group nearby places')).toBeVisible();
  await expect(mapMenu.getByRole('combobox', { name: 'Base map' })).toBeVisible();
  await expect(mapMenu.getByText('Overlay image')).toBeVisible();
  await expect(mapMenu.getByRole('button', { name: 'Show all' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mapMenu).toBeHidden();

  // Image: no row of buttons; they are in the image menu, and the rotation opens inside it
  await expect(page.getByRole('link', { name: 'Open in the viewer' })).toBeHidden();
  await page.getByRole('button', { name: 'Image settings' }).click();
  const imageMenu = page.getByRole('group', { name: 'Image settings' });
  await expect(imageMenu.getByRole('link', { name: 'Open in the viewer' })).toBeVisible();
  await expect(imageMenu.getByText('Marks on the image')).toBeVisible();
  await imageMenu.getByRole('button', { name: /Rotation/ }).click();
  await expect(imageMenu.getByRole('button', { name: 'North up' })).toBeVisible();
  const menuBox = await box(imageMenu);
  expect(menuBox.x + menuBox.width, 'image menu runs off the screen').toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(menuBox.y + menuBox.height, 'image menu runs off the bottom of the screen').toBeLessThanOrEqual(page.viewportSize()!.height);

  // The map credits are folded into the "i" button
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toHaveClass(/maplibregl-compact/);
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
});
