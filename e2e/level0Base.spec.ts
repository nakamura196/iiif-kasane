import { expect, test, type Page } from '@playwright/test';

// No broken-image icon while an image opens.
// 1. A static tile store (Image API level 0 with tiles but no `sizes`, as on projektemacher.org) has no small
//    image of the whole. The viewer asked for `full/3509,/…` and then `0,0,3509,2506/1024,/…`; both answered
//    404, and the failed base image showed the browser's broken-image icon until the tiles covered it.
// 2. Any service whose base image fails while its tiles come: the failed base image is hidden.
// The data is served by the test.

const BASE = 'https://example.org/level0-base';
const W = 3509;
const H = 2506;

// A 1×1 gray PNG (any image will do; it is drawn at the tile's size)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);
const cors = { 'access-control-allow-origin': '*' };

const manifestFor = (service: string, profile: string) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/${profile}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Postcard'] },
  items: [
    {
      id: `${BASE}/${profile}/canvas`,
      type: 'Canvas',
      width: W,
      height: H,
      items: [
        {
          id: `${BASE}/${profile}/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/${profile}/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: {
                id: `${service}/full/full/0/default.jpg`,
                type: 'Image',
                format: 'image/jpeg',
                width: W,
                height: H,
                service: [{ '@id': service, '@type': 'ImageService2', profile }],
              },
              target: `${BASE}/${profile}/canvas`,
            },
          ],
        },
      ],
    },
  ],
});

const infoFor = (service: string, profile: string) => ({
  '@context': 'http://iiif.io/api/image/2/context.json',
  '@id': service,
  protocol: 'http://iiif.io/api/image',
  profile: [`http://iiif.io/api/image/2/${profile}.json`],
  width: W,
  height: H,
  tiles: [{ width: 512, scaleFactors: [1, 2, 4] }],
});

// The files a static tile store has: the tiles at each scale factor, and the whole image (`full/full`).
const tilePaths = new Set<string>();
for (const f of [1, 2, 4]) {
  const span = 512 * f;
  for (let y = 0; y < H; y += span) {
    for (let x = 0; x < W; x += span) {
      const w = Math.min(span, W - x);
      const h = Math.min(span, H - y);
      tilePaths.add(`${x},${y},${w},${h}/${Math.ceil(w / f)},/0/default.jpg`);
    }
  }
}

// a tile of scale factor 4 (a span of 2048 px, or the clipped edge of one)
const isCoarsest = (path: string) => {
  const [x, y, w] = path.split('/')[0].split(',').map(Number);
  const size = Number(path.split('/')[1].replace(',', ''));
  return x % 2048 === 0 && y % 2048 === 0 && Math.ceil(w / 4) === size;
};

async function serve(page: Page, profile: 'level0' | 'level1', { coarsest = true } = {}) {
  const service = `${BASE}/${profile}/front`;
  const asked: string[] = [];
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/manifest.json')) return route.fulfill({ json: manifestFor(service, profile), headers: cors });
    if (url === `${service}/info.json`) return route.fulfill({ json: infoFor(service, profile), headers: cors });
    if (url.startsWith(`${service}/`)) {
      const path = url.slice(service.length + 1);
      asked.push(path);
      // level 0: only the stored files. level 1 here: any region comes (the viewer may merge tiles), but every
      // base image (the whole image, by keyword or as pixels) fails
      const served =
        profile === 'level0'
          ? (tilePaths.has(path) && (coarsest || !isCoarsest(path))) || path === 'full/full/0/default.jpg'
          : !path.startsWith('full/') && !path.startsWith(`0,0,${W},${H}/`);
      if (served) {
        return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
      }
    }
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<p>not found</p>', headers: cors });
  });
  return { service, asked };
}

// Watches every frame for an <img> that failed and is still on screen (the broken-image icon).
const watchBroken = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __broken: string[] }).__broken = seen;
    const look = () => {
      for (const img of document.querySelectorAll('img')) {
        if (!img.complete || img.naturalWidth > 0 || !img.getAttribute('src')) continue;
        const css = getComputedStyle(img);
        const box = img.getBoundingClientRect();
        if (css.visibility === 'hidden' || css.display === 'none' || box.width === 0 || box.height === 0) continue;
        if (!seen.includes(img.src)) seen.push(img.src);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });

const broken = (page: Page) => page.evaluate(() => (window as unknown as { __broken: string[] }).__broken);
const loadedTiles = (page: Page, service: string) =>
  page.locator(`img[src^="${service}/"]`).evaluateAll((imgs) =>
    imgs.filter((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0).length,
  );

test('a static tile store (level 0, no sizes): the coarsest tiles are the base image, and no broken image shows', async ({ page }) => {
  await watchBroken(page);
  const { service, asked } = await serve(page, 'level0');
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/level0/manifest.json`)}`);

  await expect.poll(() => loadedTiles(page, service)).toBeGreaterThan(0);
  // let the view tiles that follow the base image come too
  await page.waitForTimeout(1500);
  // no resize of the whole, which a static store does not have
  expect(asked.filter((p) => /^full\/\d+,/.test(p) || p.startsWith(`0,0,${W},${H}/`))).toEqual([]);
  // the coarsest tiles were asked for as the base image
  expect(asked).toContain('0,0,2048,2048/512,/0/default.jpg');
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(await broken(page)).toEqual([]);
});

test('a base image that fails while the tiles come is hidden, not shown as a broken image', async ({ page }) => {
  await watchBroken(page);
  const { service } = await serve(page, 'level1');
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/level1/manifest.json`)}`);

  await expect.poll(() => loadedTiles(page, service)).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await broken(page)).toEqual([]);
});

test('when the coarsest tiles of a store are missing, the finer ones still draw and no error stays', async ({ page }) => {
  await watchBroken(page);
  const { service } = await serve(page, 'level0', { coarsest: false });
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/level0/manifest.json`)}`);

  await expect.poll(() => loadedTiles(page, service)).toBeGreaterThan(0);
  // the failure of the base tiles is cleared by the tiles that came, and is not told again on later renders
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(await broken(page)).toEqual([]);
});
