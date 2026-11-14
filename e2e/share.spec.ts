import { expect, test } from '@playwright/test';

// The "Share" tab: it builds an IIIF Content State for the shown page and visible area, offers a link back to this
// viewer and a draggable IIIF link, and a copied link opens the same page again. Data is served inside the test.

const BASE = 'https://example.org/share-test';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const canvas = (n: number) => ({
  id: `${BASE}/canvas/p${n}`,
  type: 'Canvas',
  label: { none: [`page ${n}`] },
  width: 1000,
  height: 800,
  items: [
    {
      id: `${BASE}/canvas/p${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${BASE}/canvas/p${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body: { id: `${BASE}/p${n}.png`, type: 'Image', format: 'image/png', width: 1000, height: 800 },
          target: `${BASE}/canvas/p${n}`,
        },
      ],
    },
  ],
});

const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest`,
  type: 'Manifest',
  label: { none: ['share test'] },
  items: [canvas(1), canvas(2)],
};

const serve = async (page: import('@playwright/test').Page) =>
  page.route(`${BASE}/**`, (route) =>
    route.request().url().endsWith('.png')
      ? route.fulfill({ body: PNG, contentType: 'image/png' })
      : route.fulfill({ json: manifest, headers: { 'access-control-allow-origin': '*' } }),
  );

test('builds a content state for the shown page and a link that opens it again', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&canvas=2&tab=share`);

  const json = page.getByLabel('Content State (JSON)');
  await expect(json).toHaveValue(new RegExp(`"id": "${BASE}/canvas/p2"`));
  await expect(json).toHaveValue(/"motivation": \[\s*"contentState"\s*\]/);
  await expect(json).toHaveValue(new RegExp(`"id": "${BASE}/manifest"`));

  // Without the page, the content state points at the manifest only
  await page.getByLabel('Include current page').uncheck();
  await expect(json).not.toHaveValue(/canvas\/p2/);
  await page.getByLabel('Include current page').check();

  // The visible area is read from the image
  await page.getByLabel('Include visible area').check();
  await expect(json).toHaveValue(/#xywh=\d+,\d+,\d+,\d+/);

  // The drag link follows the IIIF drag-and-drop convention
  const href = await page.getByTestId('share-drag').getAttribute('href');
  expect(href?.startsWith(`${BASE}/manifest?iiif-content=`)).toBe(true);

  // The copied viewer link opens the same page (page 2, although the link has no canvas= argument)
  await page.getByRole('button', { name: 'Copy the link to this viewer' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const u = new URL(link);
  expect(u.searchParams.get('canvas')).toBeNull();
  expect(u.searchParams.get('iiif-content')).toMatch(/^[A-Za-z0-9_-]+$/);
  await page.goto(link);
  await expect(page.getByLabel('Content State (JSON)')).toHaveValue(new RegExp(`"id": "${BASE}/canvas/p2"`));
});

test('has no viewer link when the page URL has no iiif-content', async ({ page }) => {
  await serve(page);
  await page.goto(`/en/viewer/?manifest=${encodeURIComponent(`${BASE}/manifest`)}&tab=share`);
  await expect(page.getByLabel('Content State (JSON)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy the link to this viewer' })).toHaveCount(0);
});
