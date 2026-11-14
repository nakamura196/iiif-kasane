import { expect, test, type Page } from '@playwright/test';

// Deep links into a Collection (Issue #335): ?iiif-content=<manifest>&collection=<top>&collection=<sub>.
// Opening an entry writes its location into the address bar; opening that address shows the manifest and
// Back returns through the Collections. The data is served by the test (no outside site).

const BASE = 'https://example.org/collection-deep';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);
const TOP = `${BASE}/top.json`;
const SUB = `${BASE}/sub.json`;
const ALPHA = `${BASE}/alpha.json`;

const canvas = (n: number) => ({
  id: `${BASE}/alpha/canvas/${n}`,
  type: 'Canvas',
  width: 100,
  height: 100,
  items: [
    {
      id: `${BASE}/alpha/canvas/${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${BASE}/alpha/canvas/${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body: { id: `${BASE}/img/${n}.png`, type: 'Image', format: 'image/png', width: 100, height: 100 },
          target: `${BASE}/alpha/canvas/${n}`,
        },
      ],
    },
  ],
});
const ctx = 'http://iiif.io/api/presentation/3/context.json';
const data: Record<string, unknown> = {
  [TOP]: {
    '@context': ctx,
    id: TOP,
    type: 'Collection',
    label: { en: ['Top shelf'] },
    items: [
      { id: SUB, type: 'Collection', label: { en: ['Sub shelf'] } },
      { id: ALPHA, type: 'Manifest', label: { en: ['Alpha'] } },
    ],
  },
  [SUB]: {
    '@context': ctx,
    id: SUB,
    type: 'Collection',
    label: { en: ['Sub shelf'] },
    items: [{ id: ALPHA, type: 'Manifest', label: { en: ['Alpha'] } }],
  },
  [ALPHA]: { '@context': ctx, id: ALPHA, type: 'Manifest', label: { en: ['Alpha'] }, items: [1, 2, 3].map(canvas) },
};
const cors = { 'access-control-allow-origin': '*' };

async function serve(page: Page) {
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url in data) return route.fulfill({ json: data[url], headers: cors });
    if (url.endsWith('.png')) return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    return route.fulfill({ status: 404, headers: cors });
  });
}

const enc = encodeURIComponent;
const viewer = (qs: string) => `/en/viewer/?${qs}`;
const pager = (page: Page) => page.getByRole('group', { name: 'Page navigation' });
const back = (page: Page) => page.getByRole('button', { name: /^‹/ });
const card = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
const params = (page: Page) => new URL(page.url()).searchParams;

test('opening an entry writes iiif-content and collection into the address bar', async ({ page }) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Alpha/).click();
  await expect(pager(page)).toContainText('1 / 3');
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  expect(params(page).getAll('collection')).toEqual([TOP]);
});

test('that address opens the manifest, and Back returns to the Collection', async ({ page }) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(ALPHA)}&collection=${enc(TOP)}`));
  await expect(pager(page)).toContainText('1 / 3');
  await back(page).click();
  await expect(card(page, /Sub shelf/)).toBeVisible();
  // going back is written too
  await expect.poll(() => params(page).get('iiif-content')).toBe(TOP);
  expect(params(page).getAll('collection')).toEqual([]);
});

test('nested Collections: all steps are written, and Back goes through them one by one', async ({ page }) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Sub shelf/).click();
  await card(page, /Alpha/).click();
  await expect(pager(page)).toContainText('1 / 3');
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  expect(params(page).getAll('collection')).toEqual([TOP, SUB]);

  await page.goto(viewer(`iiif-content=${enc(ALPHA)}&collection=${enc(TOP)}&collection=${enc(SUB)}`));
  await expect(pager(page)).toContainText('1 / 3');
  await back(page).click();
  // sub shelf: lists Alpha only
  await expect(card(page, /Alpha/)).toBeVisible();
  await expect(card(page, /Sub shelf/)).toHaveCount(0);
  await back(page).click();
  await expect(card(page, /Sub shelf/)).toBeVisible();
});

test('canvas= applies to the manifest of a deep link', async ({ page }) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(ALPHA)}&collection=${enc(TOP)}&canvas=2`));
  await expect(pager(page)).toContainText('2 / 3');
});

test('the page the reader is on is kept when the address is written (no reload)', async ({ page }) => {
  await serve(page);
  let alphaReads = 0;
  page.on('request', (r) => {
    if (r.url() === ALPHA) alphaReads += 1;
  });
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Alpha/).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('2 / 3');
  expect(alphaReads).toBe(1);
});

test("the browser's Back after opening an entry returns to the Collection", async ({ page }) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Alpha/).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  await page.goBack();
  await expect(card(page, /Sub shelf/)).toBeVisible();
  expect(params(page).get('iiif-content')).toBe(TOP);
  await page.goForward();
  await expect(pager(page)).toContainText('1 / 3');
});

test("the viewer's own Back uses the history: one browser Back then lands on the place before, not on a copy", async ({
  page,
}) => {
  await serve(page);
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Sub shelf/).click();
  await card(page, /Alpha/).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  await back(page).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(SUB);
  expect(params(page).getAll('collection')).toEqual([TOP]);
  // one browser Back: the Collection above (not another entry of the same place)
  await page.goBack();
  await expect.poll(() => params(page).get('iiif-content')).toBe(TOP);
  await expect(card(page, /Sub shelf/)).toBeVisible();
});

test("the browser's Back to the Collection reads nothing again", async ({ page }) => {
  await serve(page);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.url() === TOP) reads.push(r.url());
  });
  await page.goto(viewer(`iiif-content=${enc(TOP)}`));
  await card(page, /Alpha/).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  await page.goBack();
  await expect(card(page, /Sub shelf/)).toBeVisible();
  expect(params(page).get('iiif-content')).toBe(TOP);
  expect(reads).toHaveLength(1);
});

test('a ?collection= value that is not an address is dropped; the manifest still opens', async ({ page }) => {
  await serve(page);
  const outside: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'evil.example') outside.push(r.url());
  });
  await page.goto(viewer(`iiif-content=${enc(ALPHA)}&collection=${enc('//evil.example/c.json')}&collection=${enc(TOP)}`));
  await expect(pager(page)).toContainText('1 / 3');
  await back(page).click();
  await expect(card(page, /Sub shelf/)).toBeVisible();
  expect(outside).toEqual([]);
});

test('a move before the deep link Collections arrive still writes them into the address', async ({ page }) => {
  await serve(page);
  // the Collection above is slow: it answers only when released
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(TOP, async (route) => {
    await held;
    return route.fulfill({ json: data[TOP], headers: cors });
  });
  await page.goto(viewer(`iiif-content=${enc(SUB)}&collection=${enc(TOP)}`));
  await card(page, /Alpha/).click();
  await expect(pager(page)).toContainText('1 / 3');
  await expect.poll(() => params(page).get('iiif-content')).toBe(ALPHA);
  expect(params(page).getAll('collection')).toEqual([TOP, SUB]);
  release();
  // Back then goes through both
  await back(page).click();
  await expect.poll(() => params(page).get('iiif-content')).toBe(SUB);
  expect(params(page).getAll('collection')).toEqual([TOP]);
});
