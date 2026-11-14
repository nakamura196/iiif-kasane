import { expect, test, type Page } from '@playwright/test';

// "Open in other viewers" in the "Other views" tab: the links follow the manifest shown now, are encoded once,
// and are left out for content the viewers cannot show. The data is served by the test (no outside site).
// The viewers' own pages are checked by hand and described in the PR; this test only checks the links.

const BASE = 'https://example.org/other-viewers';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const canvas = (id: string, body: object) => ({
  id: `${BASE}/${id}/canvas`,
  type: 'Canvas',
  width: 100,
  height: 100,
  items: [
    {
      id: `${BASE}/${id}/page`,
      type: 'AnnotationPage',
      items: [{ id: `${BASE}/${id}/anno`, type: 'Annotation', motivation: 'painting', body, target: `${BASE}/${id}/canvas` }],
    },
  ],
});
const manifest = (id: string, body: object) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/${id}.json?a=1&b=2`,
  type: 'Manifest',
  label: { en: [id] },
  items: [canvas(id, body)],
});

const image = manifest('image', { id: `${BASE}/p.png`, type: 'Image', format: 'image/png', width: 100, height: 100 });
const video = manifest('video', { id: `${BASE}/v.mp4`, type: 'Video', format: 'video/mp4', duration: 5, width: 100, height: 100 });
const collection = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/collection.json`,
  type: 'Collection',
  label: { en: ['Both'] },
  items: [
    { id: image.id, type: 'Manifest', label: { en: ['image'] } },
    { id: video.id, type: 'Manifest', label: { en: ['video'] } },
  ],
};

// Presentation 2 manifest: the viewer upgrades it to 3, but the links follow the version as served
const v2 = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  '@id': `${BASE}/v2.json`,
  '@type': 'sc:Manifest',
  label: 'v2',
  sequences: [
    {
      '@type': 'sc:Sequence',
      canvases: [
        {
          '@id': `${BASE}/v2/c1`,
          '@type': 'sc:Canvas',
          label: '1',
          width: 100,
          height: 100,
          images: [
            {
              '@type': 'oa:Annotation',
              motivation: 'sc:painting',
              on: `${BASE}/v2/c1`,
              resource: { '@id': `${BASE}/p.png`, '@type': 'dctypes:Image', format: 'image/png', width: 100, height: 100 },
            },
          ],
        },
      ],
    },
  ],
};
// an image's info.json: the viewer wraps it in a stand-in Manifest, which must not be offered to other viewers
const info = {
  '@context': 'http://iiif.io/api/image/3/context.json',
  id: `${BASE}/img`,
  type: 'ImageService3',
  protocol: 'http://iiif.io/api/image',
  profile: 'level0',
  width: 100,
  height: 100,
};

async function serve(page: Page) {
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    const json = (o: object) => route.fulfill({ json: o, headers: { 'access-control-allow-origin': '*' } });
    if (url.includes('collection.json')) return json(collection);
    if (url.includes('image.json')) return json(image);
    if (url.includes('video.json')) return json(video);
    if (url.includes('v2.json')) return json(v2);
    if (url.includes('/img/info.json')) return json(info);
    return route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
  });
}

const hrefs = (page: Page) => page.locator('[data-testid="open-in-viewers"] a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
const names = (page: Page) => page.locator('[data-testid="open-in-viewers"] a').allInnerTexts();

for (const locale of ['ja', 'en']) {
  test(`other viewers links for an image manifest (${locale})`, async ({ page }) => {
    await serve(page);
    await page.goto(`/${locale}/viewer/?iiif-content=${encodeURIComponent(image.id)}&tab=views`);
    const list = page.locator('[data-testid="open-in-viewers"]');
    await expect(list).toBeVisible();
    expect(await names(page)).toEqual(['Universal Viewer', 'Mirador', 'IIIF Curation Viewer', 'Clover', 'Theseus']);
    const links = await hrefs(page);
    // the manifest URL (with its own ? and &) is in each link, encoded once
    for (const h of links) expect(h).toContain(encodeURIComponent(image.id));
    await expect(list.locator('a').first()).toHaveAttribute('target', '_blank');
    await page.screenshot({ path: `${process.env.SHOTS ?? 'test-results'}/other-viewers-${locale}-desktop.png` });
  });
}

test('other viewers links at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(image.id)}&tab=views`);
  await page.getByRole('button', { name: 'Show panel' }).click();
  await expect(page.locator('[data-testid="open-in-viewers"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `${process.env.SHOTS ?? 'test-results'}/other-viewers-en-phone.png` });
});

test('video gets only the viewers that play it, and an entry of a Collection uses its own URL', async ({ page }) => {
  await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(video.id)}&tab=views`);
  await expect(page.locator('[data-testid="open-in-viewers"]')).toBeVisible();
  expect(await names(page)).toEqual(['Universal Viewer', 'Clover']);

  // opened from a Collection: the links point at the entry that was opened, and the Collection itself gets none
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(collection.id)}&tab=views`);
  await page.getByRole('button', { name: /^video/ }).click();
  await expect(page.locator('[data-testid="open-in-viewers"]')).toBeVisible();
  for (const h of await hrefs(page)) {
    expect(h).toContain(encodeURIComponent(video.id));
    expect(h).not.toContain(encodeURIComponent(collection.id));
  }
});

test('a local image (blob: URL) gets no links', async ({ page }) => {
  await serve(page);
  await page.goto('/en/viewer/');
  await page.getByTestId('local-image-input').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  // the viewer opened on the image (the inference tab is the one shown for a local image)
  await expect(page).toHaveURL(/tab=inference/);
  await expect(page.getByRole('button', { name: 'Inference' })).toBeVisible();
  // nothing else is on offer for a local image, so the tab is absent and so are the links
  await expect(page.getByRole('button', { name: 'Other views' })).toHaveCount(0);
  await expect(page.locator('[data-testid="open-in-viewers"]')).toHaveCount(0);
});

test('a Presentation 2 manifest gets only the viewers that read 2', async ({ page }) => {
  await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(v2['@id'])}&tab=views`);
  await expect(page.locator('[data-testid="open-in-viewers"]')).toBeVisible();
  expect(await names(page)).toEqual(['Universal Viewer', 'Mirador', 'IIIF Curation Viewer', 'Theseus']);
});

test('the info.json of an image gets no links (the viewer shows it as a stand-in Manifest)', async ({ page }) => {
  await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/img/info.json`)}&tab=views`);
  // the tab is there (the gallery can take the image); wait for it, then the links must be absent
  await expect(page.getByRole('heading', { name: 'View in 3D gallery' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="open-in-viewers"]')).toHaveCount(0);
});
