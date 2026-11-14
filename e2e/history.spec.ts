import { expect, test, type Page } from '@playwright/test';

// Recently opened items and bookmarks (kept in the browser's localStorage). The manifests are served by the test.

const BASE = 'https://example.org/history';
const cors = { 'access-control-allow-origin': '*' };

const manifest = (n: number) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/m${n}.json`,
  type: 'Manifest',
  label: { en: [`Postcard ${n}`], ja: [`絵葉書 ${n}`] },
  items: [
    {
      id: `${BASE}/m${n}/canvas/1`,
      type: 'Canvas',
      width: 100,
      height: 100,
      items: [
        {
          id: `${BASE}/m${n}/canvas/1/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/m${n}/canvas/1/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: { id: `${BASE}/m${n}/image.png`, type: 'Image', format: 'image/png', width: 100, height: 100 },
              target: `${BASE}/m${n}/canvas/1`,
            },
          ],
        },
      ],
    },
  ],
});

// A 1x1 gray PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

async function serve(page: Page) {
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    const m = url.match(/\/m(\d)\.json$/);
    if (m) return route.fulfill({ json: manifest(Number(m[1])), headers: cors });
    if (/\.png$/.test(url)) return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    return route.fulfill({ status: 404, headers: cors });
  });
}

const viewerUrl = (locale: string, n: number) =>
  `/${locale}/viewer/?iiif-content=${encodeURIComponent(`${BASE}/m${n}.json`)}`;

test('an opened item shows in Recently opened, can be bookmarked and removed', async ({ page }) => {
  await serve(page);
  await page.goto('/en/viewer/');
  // nothing yet: no lists at all
  await expect(page.getByTestId('history-lists')).toHaveCount(0);

  // open two items; the second one is bookmarked
  await page.goto(viewerUrl('en', 1));
  await expect(page.getByTestId('bookmark-toggle')).toBeVisible();
  await page.waitForFunction(() => (localStorage.getItem('kasane:history:v1') ?? '').includes('Postcard 1'));
  await page.goto(viewerUrl('en', 2));
  await page.waitForFunction(() => (localStorage.getItem('kasane:history:v1') ?? '').includes('Postcard 2'));
  const star = page.getByTestId('bookmark-toggle');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  // the entry screen: newest first, the bookmark in its own list
  await page.goto('/en/viewer/');
  const recent = page.getByTestId('recent-list').getByRole('listitem');
  await expect(recent).toHaveCount(2);
  await expect(recent.nth(0)).toContainText('Postcard 2');
  await expect(recent.nth(1)).toContainText('Postcard 1');
  await expect(recent.nth(0)).toContainText('example.org');
  const bookmarks = page.getByTestId('bookmark-list').getByRole('listitem');
  await expect(bookmarks).toHaveCount(1);
  await expect(bookmarks.first()).toContainText('Postcard 2');

  // an item opens the viewer
  await recent.nth(1).getByRole('link').click();
  await expect(page).toHaveURL(/viewer\/?\?iiif-content=/);
  await expect(page.getByTestId('bookmark-toggle')).toHaveAttribute('aria-pressed', 'false');

  // remove: one recent, then the bookmark; with both lists empty nothing is shown
  await page.goto('/en/viewer/');
  await page.getByRole('button', { name: /Remove from recently opened: Postcard 1/ }).click();
  await expect(recent).toHaveCount(1);
  await page.getByRole('button', { name: /Remove bookmark: Postcard 2/ }).click();
  await expect(bookmarks).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.getByTestId('history-lists')).toHaveCount(0);
});

test('the lists are in the page language and survive storage that holds junk', async ({ page }) => {
  await serve(page);
  await page.goto('/ja/viewer/');
  await page.evaluate(() => localStorage.setItem('kasane:history:v1', '{"recent": 5}'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.getByTestId('history-lists')).toHaveCount(0);
  await page.goto(viewerUrl('ja', 1));
  await page.waitForFunction(() => (localStorage.getItem('kasane:history:v1') ?? '').includes('Postcard 1'));
  await page.goto('/ja/viewer/');
  await expect(page.getByTestId('recent-list')).toContainText('絵葉書 1');
});

test('a local image is not recorded', async ({ page }) => {
  await page.goto('/en/viewer/');
  await page.evaluate(() => localStorage.setItem('kasane:history:v1', JSON.stringify({ recent: [{ url: 'blob:http://x/1', label: 'x', kind: 'manifest', at: 1 }], bookmarks: [] })));
  await page.reload();
  await expect(page.getByTestId('history-lists')).toHaveCount(0);
});

test('long labels do not make the phone-width page scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/viewer/');
  await page.evaluate(() => {
    const long = 'A very long postcard title that goes on and on without any break ' + 'x'.repeat(80);
    localStorage.setItem('kasane:history:v1', JSON.stringify({ recent: [{ url: 'https://example.org/m1.json', label: long, kind: 'manifest', at: 1 }], bookmarks: [] }));
  });
  await page.reload();
  await expect(page.getByTestId('recent-list')).toBeVisible();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
