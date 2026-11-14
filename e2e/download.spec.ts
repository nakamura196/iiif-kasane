import { expect, test, type Page } from '@playwright/test';

// The Download tab. The data is served by the test (no outside site).
// 1. A level 2 service without `sizes`: computed sizes, the whole image or the area on screen, saved under a readable name.
// 2. A static tile store (level 0, no sizes): only the whole image by keyword, no area, no `full/<w>,` (it answers 404).
// 3. A file that cannot be fetched: no window is opened; the message tells a network/CORS failure from an HTTP error
//    and carries a link to click.

const BASE = 'https://example.org/download';
const W = 4000;
const H = 3000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);
const cors = { 'access-control-allow-origin': '*' };

const manifestFor = (name: string) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/${name}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Postcard'] },
  requiredStatement: { label: { en: ['Attribution'] }, value: { en: ['Provided by Example Library'] } },
  rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
  items: [
    {
      id: `${BASE}/${name}/canvas`,
      type: 'Canvas',
      width: 1000,
      height: 750,
      items: [
        {
          id: `${BASE}/${name}/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/${name}/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: {
                id: `${BASE}/${name}/svc/full/max/0/default.jpg`,
                type: 'Image',
                format: 'image/jpeg',
                width: W,
                height: H,
                service: [{ id: `${BASE}/${name}/svc`, type: 'ImageService3', profile: name === 'level0' ? 'level0' : 'level2' }],
              },
              target: `${BASE}/${name}/canvas`,
            },
          ],
        },
      ],
    },
  ],
});

const infoFor = (name: string) => ({
  '@context': 'http://iiif.io/api/image/3/context.json',
  id: `${BASE}/${name}/svc`,
  type: 'ImageService3',
  protocol: 'http://iiif.io/api/image',
  profile: name === 'level0' ? 'level0' : 'level2',
  width: W,
  height: H,
  ...(name === 'level0' ? { tiles: [{ width: 512, scaleFactors: [1, 2, 4] }] } : {}),
});

async function serve(page: Page, name: 'level2' | 'level0', { imageFails = false, imageStatus = 200 } = {}) {
  const asked: string[] = [];
  const infoRequests: string[] = [];
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/manifest.json')) return route.fulfill({ json: manifestFor(name), headers: cors });
    if (url.endsWith('/info.json')) {
      infoRequests.push(url);
      return route.fulfill({ json: infoFor(name), headers: cors });
    }
    asked.push(url.slice(`${BASE}/${name}/svc/`.length));
    // a failed request is what the page sees when the server does not allow reading from another origin
    if (imageFails) return route.abort();
    if (imageStatus !== 200) return route.fulfill({ status: imageStatus, body: 'x', headers: cors });
    return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
  });
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/${name}/manifest.json`)}&tab=download`);
  return { asked, infoRequests };
}

const url = (page: Page) => page.getByTestId('download-url').first().inputValue();

test('a level 2 service: sizes for the whole image and the area on screen, saved under a readable name', async ({ page }) => {
  const { infoRequests } = await serve(page, 'level2');
  await expect(page.getByRole('radio', { name: '256 × 192 px' })).toBeVisible();
  for (const size of ['512 × 384 px', '1024 × 768 px', '2048 × 1536 px', '4000 × 3000 px']) {
    await expect(page.getByRole('radio', { name: new RegExp(size) })).toBeVisible();
  }
  // the image information is read once, by the loader the display uses (its cache is shared)
  expect(infoRequests).toHaveLength(1);
  // the largest is chosen first; v3 asks for it with the max keyword
  expect(await url(page)).toBe(`${BASE}/level2/svc/full/max/0/default.jpg`);
  await page.getByRole('radio', { name: '1024 × 768 px' }).check();
  expect(await url(page)).toBe(`${BASE}/level2/svc/full/1024,/0/default.jpg`);
  // what the manifest says about use is shown with the button
  await expect(page.getByText('Provided by Example Library')).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://creativecommons.org/publicdomain/zero/1.0/' })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-save').click()]);
  expect(download.suggestedFilename()).toBe('Postcard_full_1024x768.jpg');
  await expect(page.getByText('Saved as Postcard_full_1024x768.jpg.')).toBeVisible();

  // the area on screen, read when it is chosen: zoom in first, so that it is part of the image
  await page.mouse.move(640, 360);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(800);
  await page.getByRole('radio', { name: 'Visible area' }).check();
  const region = /\/(\d+),(\d+),(\d+),(\d+)\/max\/0\/default\.jpg$/.exec(await url(page));
  expect(region).not.toBeNull();
  const [, x, y, w, h] = region!.map(Number);
  expect(w).toBeLessThan(W);
  expect(h).toBeLessThan(H);
  expect(x + w).toBeLessThanOrEqual(W);
  expect(y + h).toBeLessThanOrEqual(H);
  await expect(page.getByText(`${w} × ${h} px of the image`)).toBeVisible();
  await page.getByRole('radio', { name: 'Whole image' }).check();
  expect(await url(page)).toBe(`${BASE}/level2/svc/full/max/0/default.jpg`);
});

test('a static tile store (level 0, no sizes): only the whole image, no area, no resize', async ({ page }) => {
  await serve(page, 'level0');
  await expect(page.getByRole('radio', { name: /4000 × 3000 px/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /× .* px/ })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Visible area' })).toBeDisabled();
  await expect(page.getByText('cannot cut out an area')).toBeVisible();
  expect(await url(page)).toBe(`${BASE}/level0/svc/full/max/0/default.jpg`);
});

test('a file the browser may not read: nothing is opened, the reader is told why and gets a link to click', async ({ page, context }) => {
  await serve(page, 'level2', { imageFails: true });
  const opened: string[] = [];
  context.on('page', (p) => opened.push(p.url()));
  await page.getByTestId('download-save').click();
  const failed = page.getByTestId('download-failed');
  await expect(failed).toContainText('could not read the file here');
  await expect(failed.getByRole('link', { name: 'Open the file in the browser' })).toHaveAttribute('href', `${BASE}/level2/svc/full/max/0/default.jpg`);
  expect(opened).toEqual([]);
});

test('an HTTP error is told apart from a network failure', async ({ page }) => {
  await serve(page, 'level2', { imageStatus: 404 });
  await page.getByTestId('download-save').click();
  await expect(page.getByTestId('download-failed')).toContainText('answered with an error (404)');
});

test('a refusal (403) says a login or permission may be needed', async ({ page }) => {
  await serve(page, 'level2', { imageStatus: 403 });
  await page.getByTestId('download-save').click();
  await expect(page.getByTestId('download-failed')).toContainText('refused (403)');
});
