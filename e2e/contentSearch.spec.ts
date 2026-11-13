import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// 文字の検索（IIIF Content Search）。2.0 の窓口を持つ公開の資料が見つからなかったので（2026-10-15）、
// 2.0 はマニフェスト・画像・検索の応答をこのテストの中で返す。1.0 は MDZ の実物に問い合わせる。

const BASE = 'https://example.org/book1';
const fixture = (name: string) =>
  readFileSync(join(__dirname, '../packages/iiif-viewer/src/core/features/contentSearch/fixtures', name), 'utf8');

// 1×1 の灰色の PNG（画像そのものは何でもよい。Canvas の大きさで描かれる）
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
  // 2 ページ目（next の先）は空にする
  await page.route('https://example.org/service/book1/search?**', (r) =>
    r.fulfill(json(new URL(r.request().url()).searchParams.get('page') ? '{"type":"AnnotationPage","items":[]}' : fixture('search2-handmade.json'))),
  );
  await page.route('https://example.org/service/book1/autocomplete?**', (r) => r.fulfill(json(fixture('autocomplete2-handmade.json'))));
}

test('Content Search 2.0: 当たりの一覧・単位の絞り込み・候補語・押すとそのページへ', async ({ page }) => {
  await serveBook(page);
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&tab=contentSearch`);

  const box = page.getByPlaceholder('資料の中の文字を探す') // 候補語が出ると役割が combobox に変わるので、役割では探さない;
  await box.fill('bir');
  await expect(page.locator('datalist option')).toHaveCount(3);
  await box.fill('bird');
  await box.press('Enter');

  await expect(page.getByText('「bird」: 2 件（全 5 件）')).toBeVisible();
  await expect(page.getByText('IIIF Content Search 2.0')).toBeVisible();
  // 前後の文の中で、当たった語に印
  await expect(page.locator('mark', { hasText: 'blue bird' })).toBeVisible();

  // 単位（Text Granularity）で絞る
  const units = page.getByRole('group', { name: '単位' });
  await expect(units.getByRole('button')).toHaveText(['すべて', '行', '語']);
  await units.getByRole('button', { name: '語' }).click();
  await expect(page.locator('mark')).toHaveCount(1);
  await units.getByRole('button', { name: 'すべて' }).click();

  // 1 ページ目の画像に、行の当たりの印
  await expect(page.locator(`[data-overlay="annotations"] [data-annotation-id="${BASE}/annotation/line-1"]`)).toBeVisible();

  // 2 語にまたがる当たりを押すと 2 ページ目に移り、当たり全体（2 語）が画面に収まって印が 2 つ出る。
  // 寄せるアニメーションが終わってから確かめる（途中の画面では印が 2 つ見えて、時間に依存するため）。
  await page.locator('mark', { hasText: 'blue bird' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  const marks = page.locator(`[data-overlay="annotations"] [data-annotation-id^="${BASE}/annotation/word-12"]`);
  // the two marks stay put for 600 ms (the zoom has settled)
  let last = '';
  let still = 0;
  await expect
    .poll(async () => {
      const boxes = JSON.stringify(await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())));
      still = boxes === last ? still + 1 : 0;
      last = boxes;
      return still;
    }, { intervals: [100] })
    .toBeGreaterThanOrEqual(6);
  await expect(marks).toHaveCount(2);
  // both marks are fully inside the visible area (toBeInViewport honours the clipping of the stage)
  for (let i = 0; i < 2; i++) await expect(marks.nth(i)).toBeInViewport({ ratio: 0.99 });
});

test('Content Search 1.0（MDZ の実物）: ?q= で開くと探してある', async ({ page }) => {
  const m = 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest';
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(m)}&tab=contentSearch&q=der`);
  await expect(page.getByText(/「der」: \d+ 件（全 \d+ 件）/)).toBeVisible();
  await expect(page.getByText('IIIF Content Search 1.0')).toBeVisible();
  await expect(page.locator('[data-overlay="annotations"] [data-annotation-id*="/search/v1/bsb00026283/anno/"]').first()).toBeVisible();
});

test('見開きの両ページにも当たりの印を出す（MDZ の 2・3 コマ目）', async ({ page }) => {
  const m = 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest';
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(m)}&tab=contentSearch&q=der&canvas=2`);
  await expect(page.getByText('2・3 / 79')).toBeVisible();
  for (const n of [2, 3]) {
    const layer = page.locator(`[data-page-overlay$="/canvas/${n}"]`);
    await expect(layer.locator('[data-annotation-id]').first()).toBeVisible();
  }
});

// 手元の注釈を探す。窓口の無い資料（1 ページ目は注釈を書き込み、2 ページ目は参照だけのページ）と、
// 窓口のある資料で「探す先」を切り替える。
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

  // 窓口が無いので「探す先」は出ない
  await expect(page.getByRole('group', { name: '探す先' })).toHaveCount(0);
  const box = page.getByPlaceholder('資料の中の文字を探す');
  await box.fill('源氏');
  await box.press('Enter');
  await expect(page.getByText('「源氏」: 2 件（全 2 件）')).toBeVisible();
  // 2 ページ目（参照先から取った注釈）を押すと移る
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
