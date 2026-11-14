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
  // one fixed name; only the pressed state changes
  const star = page.getByRole('button', { name: 'Bookmark this item', pressed: false });
  await star.click();
  await expect(page.getByRole('button', { name: 'Bookmark this item', pressed: true })).toBeVisible();

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

test('a local image is not recorded and cannot be bookmarked', async ({ page }) => {
  await page.goto('/en/viewer/');
  await page.getByTestId('local-image-input').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').filter({ hasText: 'cat.png' })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toBeVisible();
  await expect(page.getByTestId('bookmark-toggle')).toHaveCount(0);
  // the app has finished opening it (it moves to the text reading tab), then nothing must have been kept
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('inference');
  expect(await page.evaluate(() => localStorage.getItem('kasane:history:v1'))).toBeNull();
});

test('a stored blob: entry is ignored', async ({ page }) => {
  await page.goto('/en/viewer/');
  await page.evaluate(() => localStorage.setItem('kasane:history:v1', JSON.stringify({ recent: [{ url: 'blob:http://x/1', label: 'x', kind: 'manifest', at: 1 }], bookmarks: [] })));
  await page.reload();
  await expect(page.getByTestId('history-lists')).toHaveCount(0);
});

test('bookmarks are capped on the screen like recent ones, and the note shows for either list', async ({ page }) => {
  await page.goto('/en/viewer/');
  await page.evaluate(() => {
    const bookmarks = Array.from({ length: 8 }, (_, i) => ({ url: `https://example.org/b${i}.json`, label: `Bookmark ${i}`, kind: 'manifest', at: 100 - i }));
    localStorage.setItem('kasane:history:v1', JSON.stringify({ recent: [], bookmarks }));
  });
  await page.reload();
  const items = page.getByTestId('bookmark-list').getByRole('listitem');
  await expect(items).toHaveCount(6);
  await expect(page.getByText('Kept only in this browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all (8)' }).click();
  await expect(items).toHaveCount(8);
});

test('an item that cannot be read is not recorded', async ({ page }) => {
  await page.route(`${BASE}/**`, (route) => route.fulfill({ status: 404, headers: cors }));
  const requested = page.waitForResponse(`${BASE}/m1.json`);
  await page.goto(viewerUrl('en', 1));
  await requested;
  await page.waitForTimeout(1000);
  // not recorded, and a dead URL cannot be bookmarked
  expect(await page.evaluate(() => localStorage.getItem('kasane:history:v1'))).toBeNull();
  await expect(page.getByTestId('bookmark-toggle')).toHaveCount(0);
});

test('a slow manifest is still recorded after the user left the viewer', async ({ page }) => {
  await page.route(`${BASE}/**`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: manifest(1), headers: cors });
  });
  const requested = page.waitForRequest(`${BASE}/m1.json`);
  await page.goto(viewerUrl('en', 1));
  await requested;
  // the star waits for the manifest
  await expect(page.getByTestId('bookmark-toggle')).toHaveCount(0);
  // leave inside the app (the page stays alive) before the manifest arrives
  await page.getByRole('link', { name: 'IIIF Kasane' }).first().click();
  await page.waitForFunction(() => (localStorage.getItem('kasane:history:v1') ?? '').includes('Postcard 1'));
});

test('Clear history can be undone', async ({ page }) => {
  await page.goto('/en/viewer/');
  await page.evaluate(() => {
    const recent = [1, 2].map((i) => ({ url: `https://example.org/m${i}.json`, label: `Postcard ${i}`, kind: 'manifest', at: 10 - i }));
    const bookmarks = [{ url: 'https://example.org/b.json', label: 'Kept bookmark', kind: 'manifest', at: 1 }];
    localStorage.setItem('kasane:history:v1', JSON.stringify({ recent, bookmarks }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.getByTestId('recent-list')).toHaveCount(0);
  // the bookmark stays, and Undo is still offered
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('recent-list').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('bookmark-list').getByRole('listitem')).toHaveCount(1);
});

test('a full storage shows a message instead of failing silently', async ({ page }) => {
  await serve(page);
  await page.goto(viewerUrl('en', 1));
  await page.waitForFunction(() => (localStorage.getItem('kasane:history:v1') ?? '').includes('Postcard 1'));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.getByTestId('bookmark-toggle').click();
  const notice = page.getByRole('alert').filter({ hasText: 'Could not save' });
  await expect(notice).toBeVisible();
  // it can be closed, and goes away by itself
  await notice.getByRole('button', { name: 'Close' }).click();
  await expect(notice).toHaveCount(0);
  await page.getByTestId('bookmark-toggle').click();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
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
