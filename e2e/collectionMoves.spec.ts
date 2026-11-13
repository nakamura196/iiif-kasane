import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// State when moving inside a Collection (found in the review of PR #336). The data is served by the test.
// - the page open in one entry is not carried over to the next entry opened
// - of two entries clicked in a row, the later one is shown (even when the first answers later)
// - the compare link pairs the open entry's URL with the page index in it
// - changing the locale keeps the open entry and page

const BASE = 'https://example.org/collection-moves';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const image = (id: string) => ({ id, type: 'Image', format: 'image/png', width: 100, height: 100 });

const canvas = (m: string, n: number, body: unknown) => ({
  id: `${BASE}/${m}/canvas/${n}`,
  type: 'Canvas',
  width: 100,
  height: 100,
  items: [
    {
      id: `${BASE}/${m}/canvas/${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${BASE}/${m}/canvas/${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body,
          target: `${BASE}/${m}/canvas/${n}`,
        },
      ],
    },
  ],
});

const manifestOf = (m: string, label: string, canvases: unknown[]) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/${m}.json`,
  type: 'Manifest',
  label: { en: [label] },
  items: canvases,
});

// A: 3 pages. B: 4 pages; page 2 has two image candidates (a Choice), so it can go to the compare page
const manifests: Record<string, unknown> = {
  a: manifestOf('a', 'Alpha', [1, 2, 3].map((n) => canvas('a', n, image(`${BASE}/img/a${n}.png`)))),
  b: manifestOf(
    'b',
    'Beta',
    [1, 2, 3, 4].map((n) =>
      canvas(
        'b',
        n,
        n === 2
          ? { type: 'Choice', items: [image(`${BASE}/img/b2-x.png`), image(`${BASE}/img/b2-y.png`)] }
          : image(`${BASE}/img/b${n}.png`),
      ),
    ),
  ),
};

const collection = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/collection.json`,
  type: 'Collection',
  label: { en: ['Moves'] },
  items: [
    { id: `${BASE}/a.json`, type: 'Manifest', label: { en: ['Alpha'] } },
    { id: `${BASE}/b.json`, type: 'Manifest', label: { en: ['Beta'] } },
  ],
};

const cors = { 'access-control-allow-origin': '*' };

async function serve(page: Page, delays: Record<string, number> = {}) {
  await page.route(`${BASE}/**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith('/collection.json')) return route.fulfill({ json: collection, headers: cors });
    const m = /\/([ab])\.json$/.exec(url);
    if (m) {
      if (delays[m[1]]) await new Promise((r) => setTimeout(r, delays[m[1]]));
      return route.fulfill({ json: manifests[m[1]], headers: cors });
    }
    if (url.endsWith('.png')) return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    return route.fulfill({ status: 404, headers: cors });
  });
}

const open = (page: Page) => page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/collection.json`)}`);
const pager = (page: Page) => page.getByRole('group', { name: 'Page navigation' });
const back = (page: Page) => page.getByRole('button', { name: /^‹/ });

test('an entry opened after another starts at its first page', async ({ page }) => {
  await serve(page);
  await open(page);
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(pager(page)).toContainText('1 / 3');
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('3 / 3');

  await back(page).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(pager(page)).toContainText('/ 4');
  await expect(pager(page)).toContainText('1 / 4');
});

test('of two entries clicked quickly, the last one is shown even when the first answers later', async ({ page }) => {
  await serve(page, { a: 1500 });
  await open(page);
  const alpha = page.getByRole('button', { name: /Alpha/ });
  const beta = page.getByRole('button', { name: /Beta/ });
  await expect(beta).toBeVisible();
  await alpha.click();
  await beta.click();
  await expect(pager(page)).toContainText('1 / 4');
  // the late answer for Alpha has arrived by now; Beta must still be shown
  await page.waitForTimeout(2500);
  await expect(pager(page)).toContainText('1 / 4');
});

test('the links of the Other views tab open the entry, with the page number in it', async ({ page }) => {
  await serve(page);
  await open(page);
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(pager(page)).toContainText('1 / 4');
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('2 / 4');

  await page.getByRole('button', { name: 'Other views' }).click();
  const link = page.locator('a[href*="/compare"][href*="iiif-content="]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  const params = new URL(href, 'https://x.example').searchParams;
  expect(params.get('iiif-content') ?? params.get('manifest')).toBe(`${BASE}/b.json`);
  expect(params.get('canvas')).toBe('1');

  // the 3D browse and the gallery also open the entry (it has images and several pages), not the Collection
  const browse = page.locator('a[href*="/browse"]').first();
  await expect(browse).toBeVisible();
  expect(new URL((await browse.getAttribute('href')) ?? '', 'https://x.example').searchParams.get('iiif-content')).toBe(`${BASE}/b.json`);
  const gallery = page.locator('a[href*="/gallery"]').first();
  await expect(gallery).toBeVisible();
  expect(new URL((await gallery.getAttribute('href')) ?? '', 'https://x.example').searchParams.get('u')).toBe(`${BASE}/b.json`);
});

// A new locale keeps the open entry and page (no reload back to the top of the Collection).
// The site's pages are rebuilt on a language change, so this uses <iiif-kasane>, whose locale is an attribute.
// The element is read from packages/iiif-viewer/dist (`npm run build:element -w packages/iiif-viewer`); skipped without it
const DIST = path.resolve(__dirname, '../packages/iiif-viewer/dist');
const HOST = 'https://element-host.example';

test('changing the locale of <iiif-kasane> keeps the opened entry and its page', async ({ page }) => {
  test.skip(!fs.existsSync(path.join(DIST, 'iiif-kasane.js')), 'build the element first (npm run build:element)');
  await serve(page);
  await page.route(`${HOST}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      const src = `${BASE}/collection.json`;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body style="margin:0"><script type="module" src="/element/iiif-kasane.js"></script><iiif-kasane iiif-content="${src}" locale="en" style="display:block;height:600px"></iiif-kasane></body></html>`,
      });
    }
    const file = path.join(DIST, pathname.replace(/^\/element\//, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    return route.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  await page.goto(`${HOST}/`);
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(pager(page)).toContainText('1 / 4');
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('2 / 4');

  await page.locator('iiif-kasane').evaluate((el) => el.setAttribute('locale', 'ja'));
  // the Japanese label of the pager, from the viewer's messages
  const ja = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../packages/iiif-viewer/src/react/messages/features/structure.ja.json'), 'utf8'));
  const jaPager = page.getByRole('group', { name: ja.Structure.pager });
  await expect(jaPager).toBeVisible();
  // give a reload (the bug) time to come back to the top of the Collection
  await page.waitForTimeout(1500);
  await expect(jaPager).toContainText('2 / 4');
});
