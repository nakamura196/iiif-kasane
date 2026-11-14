import { expect, test, type Page } from '@playwright/test';

// Spreads (behavior: paged) and strips (behavior: continuous) whose Canvases paint an Image API service
// rather than a standalone image file (for example, body.id is the bare service base URL and the server is
// a level 0 static tile store without `sizes`, as on projektemacher.org, issue #362).

const BASE = 'https://example.org/paged-service';
const W = 3509;
const H = 2506;
const XYWH = [2200, 900, 300, 500];

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);
const cors = { 'access-control-allow-origin': '*' };

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

const canvasFor = (n: number) => {
  const service = `${BASE}/page${n}`;
  return {
    id: `${BASE}/canvas/${n}`,
    type: 'Canvas',
    label: { none: [`page${n}`] },
    width: W,
    height: H,
    items: [
      {
        id: `${BASE}/canvas/${n}/page`,
        type: 'AnnotationPage',
        items: [
          {
            id: `${BASE}/canvas/${n}/image`,
            type: 'Annotation',
            motivation: 'painting',
            body: {
              // Bare service URL (not a JPEG file), as served by static IIIF generators.
              id: service,
              type: 'Image',
              format: 'image/jpeg',
              width: W,
              height: H,
              service: [{ id: service, type: 'ImageService2', profile: 'level0' }],
            },
            target: `${BASE}/canvas/${n}`,
          },
        ],
      },
    ],
    annotations: [
      {
        id: `${BASE}/canvas/${n}/annotations`,
        type: 'AnnotationPage',
        items: [
          {
            id: `${BASE}/canvas/${n}/note`,
            type: 'Annotation',
            motivation: 'commenting',
            target: `${BASE}/canvas/${n}#xywh=${XYWH.join(',')}`,
            body: { type: 'TextualBody', value: `note ${n}`, format: 'text/plain' },
          },
        ],
      },
    ],
  };
};

const manifestFor = (behavior: 'paged' | 'continuous') => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/${behavior}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Book'] },
  behavior: [behavior],
  viewingDirection: 'left-to-right',
  items: [1, 2, 3, 4].map(canvasFor),
});

const infoFor = (service: string) => ({
  '@context': 'http://iiif.io/api/image/2/context.json',
  '@id': service,
  protocol: 'http://iiif.io/api/image',
  profile: ['http://iiif.io/api/image/2/level0.json'],
  width: W,
  height: H,
  tiles: [{ width: 512, scaleFactors: [1, 2, 4] }],
});

async function serve(page: Page, behavior: 'paged' | 'continuous' = 'paged') {
  const bareAsked: string[] = [];
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/manifest.json')) {
      return route.fulfill({ json: manifestFor(behavior), headers: cors });
    }
    const infoMatch = new RegExp(`^${BASE}/page(\\d+)/info\\.json$`).exec(url);
    if (infoMatch) {
      return route.fulfill({ json: infoFor(`${BASE}/page${infoMatch[1]}`), headers: cors });
    }
    const tileMatch = new RegExp(`^${BASE}/page(\\d+)/(.+)$`).exec(url);
    if (tileMatch && tilePaths.has(tileMatch[2])) {
      return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    }
    if (new RegExp(`^${BASE}/page\\d+$`).test(url)) {
      bareAsked.push(url);
    }
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<p>not found</p>', headers: cors });
  });
  return { bareAsked };
}

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

test('a spread (behavior: paged) reads info.json and tiles for both pages when body.id is the service base URL', async ({ page }) => {
  await watchBroken(page);
  const { bareAsked } = await serve(page, 'paged');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(
    `/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/paged/manifest.json`)}&canvas=2`,
  );

  await expect.poll(() => loadedTiles(page, `${BASE}/page2`)).toBeGreaterThan(0);
  await expect.poll(() => loadedTiles(page, `${BASE}/page3`)).toBeGreaterThan(0);
  expect(bareAsked).toEqual([]);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(await broken(page)).toEqual([]);

  const overlay2 = page.locator(`[data-page-overlay="${BASE}/canvas/2"]`);
  const overlay3 = page.locator(`[data-page-overlay="${BASE}/canvas/3"]`);
  await expect(overlay2).toBeVisible();
  await expect(overlay3).toBeVisible();
  const b2 = (await overlay2.boundingBox())!;
  const b3 = (await overlay3.boundingBox())!;
  expect(b2.width / b2.height).toBeCloseTo(W / H, 1);
  expect(b3.width / b3.height).toBeCloseTo(W / H, 1);
  // The two facing pages meet at the spine in the middle of the spread.
  expect(Math.abs(b2.x + b2.width - b3.x)).toBeLessThan(3);

  // Opening the Pages tab does not request the bare service URLs as thumbnails either.
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: /page2/ })).toBeVisible();
  expect(bareAsked).toEqual([]);
  expect(await broken(page)).toEqual([]);
});

test('a continuous strip (behavior: continuous) reads info.json and tiles for visible pages', async ({ page }) => {
  await watchBroken(page);
  const { bareAsked } = await serve(page, 'continuous');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(
    `/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/continuous/manifest.json`)}`,
  );

  await expect.poll(() => loadedTiles(page, `${BASE}/page1`)).toBeGreaterThan(0);
  expect(bareAsked).toEqual([]);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(await broken(page)).toEqual([]);
});

test('opening a region (#xywh=) on a level 0 static tile store page aligns the highlight with the annotation', async ({ page }) => {
  await serve(page, 'paged');
  await page.goto(
    `/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/paged/manifest.json`)}&canvas=${encodeURIComponent(`${BASE}/canvas/3#xywh=${XYWH.join(',')}`)}`,
  );

  await expect.poll(() => loadedTiles(page, `${BASE}/page3`)).toBeGreaterThan(0);
  const highlight = page.getByTestId('region-highlight');
  await expect(highlight).toBeVisible();
  await expect.poll(async () => (await highlight.boundingBox())?.height ?? 0).toBeGreaterThan(300);

  const box = (await highlight.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(XYWH[2] / XYWH[3], 1);
  const note = (await page.locator(`[data-annotation-id="${BASE}/canvas/3/note"]`).first().boundingBox())!;
  expect(Math.abs(note.x - box.x)).toBeLessThan(3);
  expect(Math.abs(note.y - box.y)).toBeLessThan(3);
});
