import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Text search (IIIF Content Search). No public material with a 2.0 service was found (2026-10-15), so for 2.0
// the manifest, images and search responses are served inside the test. For 1.0 the real MDZ service is queried (@external).

const BASE = 'https://example.org/book1';
const fixture = (name: string) =>
  readFileSync(join(__dirname, '../packages/iiif-viewer/src/core/features/contentSearch/fixtures', name), 'utf8');

// A 1x1 grey PNG (any image will do; it is drawn at the size of the Canvas)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const canvas = (n: number) => ({
  id: `${BASE}/canvas/p${n}`,
  type: 'Canvas',
  label: { none: [`p. ${n}`] },
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
  label: { en: ['Content Search 2.0 test'] },
  behavior: ['individuals'],
  service: [
    {
      id: 'https://example.org/service/book1/search',
      type: 'SearchService2',
      service: [{ id: 'https://example.org/service/book1/autocomplete', type: 'AutoCompleteService2' }],
    },
  ],
  items: [canvas(1), canvas(2)],
};

async function serveBook(page: Page) {
  const json = (body: string) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  await page.route(`${BASE}/manifest`, (r) => r.fulfill(json(JSON.stringify(manifest))));
  await page.route(`${BASE}/*.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
  // The second page of results (behind next) is empty
  await page.route('https://example.org/service/book1/search?**', (r) =>
    r.fulfill(json(new URL(r.request().url()).searchParams.get('page') ? '{"type":"AnnotationPage","items":[]}' : fixture('search2-handmade.json'))),
  );
  await page.route('https://example.org/service/book1/autocomplete?**', (r) => r.fulfill(json(fixture('autocomplete2-handmade.json'))));
}

test('Content Search 2.0: 当たりの一覧・単位の絞り込み・候補語・押すとそのページへ', async ({ page }) => {
  await serveBook(page);
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&tab=contentSearch`);

  const box = page.getByPlaceholder('資料の中の文字を探す') // once suggestions appear the role changes to combobox, so do not look it up by role
  await box.fill('bir');
  await expect(page.locator('datalist option')).toHaveCount(3);
  await box.fill('bird');
  await box.press('Enter');

  await expect(page.getByText('「bird」: 2 件（全 5 件）')).toBeVisible();
  await expect(page.getByText('IIIF Content Search 2.0')).toBeVisible();
  // The matched word is marked inside the surrounding text
  await expect(page.locator('mark', { hasText: 'blue bird' })).toBeVisible();

  // Filter by unit (Text Granularity)
  const units = page.getByRole('group', { name: '単位' });
  await expect(units.getByRole('button')).toHaveText(['すべて', '行', '語']);
  await units.getByRole('button', { name: '語' }).click();
  await expect(page.locator('mark')).toHaveCount(1);
  await units.getByRole('button', { name: 'すべて' }).click();

  // The line hit is marked on the image of page 1
  await expect(page.locator(`[data-overlay="annotations"] [data-annotation-id="${BASE}/annotation/line-1"]`)).toBeVisible();

  // Selecting a hit that spans two words moves to the second page, fits the whole hit (2 words) on screen, and shows two markers.
  // Check after the zoom animation finishes (mid-animation both markers are visible, which is timing-dependent).
  await page.locator('mark', { hasText: 'blue bird' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  const marks = page.locator(`[data-overlay="annotations"] [data-annotation-id^="${BASE}/annotation/word-12"]`);
  // the two marks stay put for 600 ms (the zoom has settled)
  let last = '';
  let still = 0;
  await expect
    .poll(async () => {
      const rects = await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      const boxes = JSON.stringify(rects);
      // stable means: both marks are there and have not moved
      still = rects.length === 2 && boxes === last ? still + 1 : 0;
      last = boxes;
      return still;
    }, { intervals: [100] })
    .toBeGreaterThanOrEqual(6);
  await expect(marks).toHaveCount(2);
  // both marks are fully inside the visible area (toBeInViewport honours the clipping of the stage)
  for (let i = 0; i < 2; i++) await expect(marks.nth(i)).toBeInViewport({ ratio: 0.99 });
  // No frame around the union of the words: it would also cover the text between them (the marks show each word)
  await expect(page.getByTestId('region-highlight')).toHaveCount(0);

  // Pressing the second word of the hit (the hit is selected by now, so the first press clears it) ...
  const row = page.locator('button[aria-current]', { hasText: 'blue bird' });
  await expect(row).toHaveCount(1);
  await marks.nth(1).click();
  await expect(row).toHaveCount(0);
  // ... and pressing it again selects the whole hit: the row of the hit is the current one
  await marks.nth(1).click();
  await expect(row).toHaveCount(1);
});

test('Content Search 2.0: with the marks hidden, a multi-word hit is still framed', async ({ page }) => {
  await serveBook(page);
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&tab=contentSearch&q=bird`);
  await expect(page.getByText('「bird」: 2 件（全 5 件）')).toBeVisible();
  await page.getByLabel('画像に印を出す').uncheck();
  await page.locator('mark', { hasText: 'blue bird' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  // without marks the frame is the only sign of the hit
  await expect(page.getByTestId('region-highlight')).toBeVisible();
});

test('Content Search 1.0（MDZ の実物）: ?q= で開くと探してある', { tag: '@external' }, async ({ page }) => {
  const m = 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest';
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(m)}&tab=contentSearch&q=der`);
  await expect(page.getByText(/「der」: \d+ 件（全 \d+ 件）/)).toBeVisible();
  await expect(page.getByText('IIIF Content Search 1.0')).toBeVisible();
  await expect(page.locator('[data-overlay="annotations"] [data-annotation-id*="/search/v1/bsb00026283/anno/"]').first()).toBeVisible();
});

test('見開きの両ページにも当たりの印を出す（MDZ の 2・3 コマ目）', { tag: '@external' }, async ({ page }) => {
  const m = 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest';
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(m)}&tab=contentSearch&q=der&canvas=2`);
  await expect(page.getByText('2・3 / 79')).toBeVisible();
  for (const n of [2, 3]) {
    const layer = page.locator(`[data-page-overlay$="/canvas/${n}"]`);
    await expect(layer.locator('[data-annotation-id]').first()).toBeVisible();
  }
});

// Search the annotations at hand: a material without a search service (page 1 has annotations written in,
// page 2 only references them), and switching the "search target" in a material that has a service.
test('手元の注釈: 窓口が無くても、書かれた注釈と参照先の注釈を探せる', async ({ page }) => {
  await serveBook(page);
  const line = (n: number, id: string, value: string, xywh: string) => ({
    id: `${BASE}/local/${id}`,
    type: 'Annotation',
    motivation: 'supplementing',
    textGranularity: 'line',
    body: { type: 'TextualBody', value, format: 'text/plain' },
    target: `${BASE}/canvas/p${n}#xywh=${xywh}`,
  });
  const plain = {
    ...manifest,
    id: `${BASE}/plain`,
    service: undefined,
    items: [
      { ...canvas(1), annotations: [{ id: `${BASE}/p1/notes`, type: 'AnnotationPage', items: [line(1, 'a', '源氏物語 桐壺', '100,100,400,50')] }] },
      { ...canvas(2), annotations: [{ id: `${BASE}/p2/notes`, type: 'AnnotationPage' }] },
    ],
  };
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route(`${BASE}/plain`, (r) => r.fulfill(json(plain)));
  await page.route(`${BASE}/p2/notes`, (r) =>
    r.fulfill(json({ id: `${BASE}/p2/notes`, type: 'AnnotationPage', items: [line(2, 'b', '源氏物語 帚木', '50,300,500,60')] })),
  );
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/plain`)}&tab=contentSearch`);

  // There is no service, so no "search target" switch is shown
  await expect(page.getByRole('group', { name: '探す先' })).toHaveCount(0);
  const box = page.getByPlaceholder('資料の中の文字を探す');
  await box.fill('源氏');
  await box.press('Enter');
  await expect(page.getByText('「源氏」: 2 件（全 2 件）')).toBeVisible();
  // Clicking the hit on page 2 (an annotation fetched from the reference) moves there
  await page.getByRole('button', { name: /帚木/ }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.locator(`[data-overlay="annotations"] [data-annotation-id^="${BASE}/local/b#search"]`)).toBeVisible();
});

test('手元の注釈: 窓口のある資料では「探す先」で切り替える', async ({ page }) => {
  await serveBook(page);
  const withNotes = {
    ...manifest,
    id: `${BASE}/both`,
    items: [
      {
        ...canvas(1),
        annotations: [
          {
            id: `${BASE}/p1/notes`,
            type: 'AnnotationPage',
            items: [{ id: `${BASE}/note`, type: 'Annotation', motivation: 'commenting', body: { type: 'TextualBody', value: 'A Bird on the roof' }, target: `${BASE}/canvas/p1#xywh=1,1,10,10` }],
          },
        ],
      },
      canvas(2),
    ],
  };
  await page.route(`${BASE}/both`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(withNotes) }),
  );
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/both`)}&tab=contentSearch&q=bird`);
  await expect(page.getByText('「bird」: 2 件（全 5 件）')).toBeVisible();
  await page.getByRole('group', { name: '探す先' }).getByRole('button', { name: 'このビューアの注釈' }).click();
  await expect(page.getByText('「bird」: 1 件（全 1 件）')).toBeVisible();
  await expect(page.locator('mark', { hasText: 'Bird' })).toBeVisible();
});
