import { expect, test, type Page } from '@playwright/test';

// An entry opened from a Collection draws its image with the entry's own manifest (Issue #334).
// Before, the image display used the URL first given to the viewer (the Collection), found no service,
// asked for the image id itself (here not an image) and showed "Could not load the image".
// Also checks that the image shows again after going back and reopening. The data is served by the test.

const BASE = 'https://example.org/collection-entry';
const SERVICE = `${BASE}/front`;

// A 1×1 gray PNG (any image will do; it is drawn at the Canvas size)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const collection = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/collection.json`,
  type: 'Collection',
  label: { en: ['Postcards'] },
  items: [{ id: `${BASE}/manifest.json`, type: 'Manifest', label: { en: ['Kameido'] } }],
};

// The image id is the same URL as the service and returns no image itself (as on the real site).
// The image is only reachable through the Image API service (level 0, info.json)
const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Kameido'] },
  items: [
    {
      id: `${BASE}/canvas/front`,
      type: 'Canvas',
      width: 2048,
      height: 1024,
      items: [
        {
          id: `${BASE}/canvas/front/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/front/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: {
                id: SERVICE,
                type: 'Image',
                format: 'image/jpeg',
                width: 2048,
                height: 1024,
                service: [{ id: SERVICE, type: 'ImageService2', profile: 'level0' }],
              },
              target: `${BASE}/canvas/front`,
            },
          ],
        },
      ],
    },
  ],
};

const info = {
  '@context': 'http://iiif.io/api/image/2/context.json',
  '@id': SERVICE,
  protocol: 'http://iiif.io/api/image',
  profile: ['http://iiif.io/api/image/2/level0.json'],
  width: 2048,
  height: 1024,
  tiles: [{ width: 512, scaleFactors: [1, 2, 4] }],
};

const cors = { 'access-control-allow-origin': '*' };


async function serve(page: Page) {
  const seen = { tiles: [] as string[], plain: [] as string[] };
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/collection.json')) return route.fulfill({ json: collection, headers: cors });
    if (url.endsWith('/manifest.json')) return route.fulfill({ json: manifest, headers: cors });
    if (url === `${SERVICE}/info.json`) {
      return route.fulfill({ json: info, headers: cors });
    }
    // only Image API requests ({id}/{region}/{size}/{rotation}/{quality}.{format}) get an image
    if (url.startsWith(`${SERVICE}/`) && /\.(jpg|png)$/.test(url)) {
      seen.tiles.push(url);
      return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    }
    // the body id itself is not an image: asking for it is the bug (#334)
    if (url === SERVICE) seen.plain.push(url);
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<p>not an image</p>', headers: cors });
  });
  return seen;
}

// number of the images that finished loading with a picture in them
const loadedCount = (imgs: Element[]) =>
  imgs.filter((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0).length;

test('an entry opened from a Collection draws its image through its own Image API service (#334)', async ({ page }) => {
  const seen = await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/collection.json`)}`);

  const entry = page.getByRole('button', { name: /Kameido/ });
  await entry.click();
  // a tile from the service arrives: the image is drawn through its Image API service
  await expect.poll(() => seen.tiles.length).toBeGreaterThan(0);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(seen.plain).toEqual([]);

  // back, and open it again: the image is drawn again from the service (a tile of the Image API that loaded),
  // the body id is never asked for, and no error shows. (The Collection's card may show a thumbnail from the
  // service, so only tiles, which name a region, count.)
  const fromService = page.locator(`img[src^="${SERVICE}/0,0,"]`);
  await expect.poll(() => fromService.evaluateAll(loadedCount)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^‹/ }).click();
  await expect(entry).toBeVisible();
  // the Collection is shown: no tile of the entry is left on the page
  await expect(fromService).toHaveCount(0);
  await entry.click();
  await expect(page.getByRole('button', { name: /^‹/ })).toBeVisible();
  await expect.poll(() => fromService.evaluateAll(loadedCount)).toBeGreaterThan(0);
  await expect(page.locator(`img[src="${SERVICE}"]`)).toHaveCount(0);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(seen.plain).toEqual([]);
});
