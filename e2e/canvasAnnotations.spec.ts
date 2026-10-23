import { expect, test } from '@playwright/test';

// 右パネルの「注釈」タブ: 注釈が数千件あっても見えている行だけを描くこと、検索欄で一覧と画像の上の印が絞られること、
// 「選んだ注釈へ画像を寄せる」で画像が動くこと。マニフェストと画像はこのテストの中で返す。

const BASE = 'https://example.org/many-annotations';
const N = 5000;

// 1×1 の灰色の PNG（画像そのものは何でもよい。Canvas の大きさで描かれる）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest`,
  type: 'Manifest',
  label: { none: ['many annotations'] },
  items: [
    {
      id: `${BASE}/canvas/p1`,
      type: 'Canvas',
      width: 10000,
      height: 8000,
      items: [
        {
          id: `${BASE}/canvas/p1/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/p1/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: { id: `${BASE}/p1.png`, type: 'Image', format: 'image/png', width: 10000, height: 8000 },
              target: `${BASE}/canvas/p1`,
            },
          ],
        },
      ],
      annotations: [
        {
          id: `${BASE}/canvas/p1/annotations`,
          type: 'AnnotationPage',
          items: Array.from({ length: N }, (_, i) => ({
            id: `${BASE}/annotation/${i}`,
            type: 'Annotation',
            motivation: 'commenting',
            // 100 列 × 50 行に並べる
            target: `${BASE}/canvas/p1#xywh=${(i % 100) * 100},${Math.floor(i / 100) * 100},80,40`,
            body: { type: 'TextualBody', value: i === 4321 ? '雅屯河' : `地名 ${i}`, format: 'text/plain' },
          })),
        },
      ],
    },
  ],
};

test('注釈が 5000 件でも見えている行だけを描き、検索欄で一覧と印を絞る', async ({ page }) => {
  await page.route(`${BASE}/**`, (route) =>
    route.request().url().endsWith('.png')
      ? route.fulfill({ body: PNG, contentType: 'image/png' })
      : route.fulfill({ json: manifest, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&tab=canvasAnnotations`);

  const list = page.locator('[data-annotation-list]');
  await expect(page.getByText(`${N} 件`, { exact: true })).toBeVisible();
  await expect(list.getByText('地名 0', { exact: true })).toBeVisible();
  // 描いている行は、見えている分とその前後だけ
  expect(await list.locator('[data-key]').count()).toBeLessThan(100);
  // 印が見えている範囲に 500 個を超えるので、1 枚の canvas にまとめて描く（押せる印は作らない）
  await expect(page.locator('[data-overlay="annotations"] [data-annotation-canvas]')).toBeVisible();
  await expect(page.locator('[data-overlay="annotations"] [data-annotation-id]')).toHaveCount(0);

  // 一番下までスクロールすると、最後の注釈が描かれる
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(list.getByText(`地名 ${N - 1}`, { exact: true })).toBeVisible();

  // 検索欄: 一覧と画像の上の印が、当たった注釈だけになる（全角・半角は区別しない）
  await page.getByRole('searchbox', { name: '注釈の中を検索' }).fill('雅屯');
  await expect(page.getByText(`1 件 / 全 ${N} 件`)).toBeVisible();
  await expect(list.getByText('雅屯河')).toBeVisible();
  await expect(page.locator('[data-overlay="annotations"] [data-annotation-id]')).toHaveCount(1);

  // 選んだ注釈へ画像を寄せる: 押すと画像が拡大される（寄せないときは動かない）
  const stage = page.locator('[data-overlay="annotations"]');
  const before = await stage.boundingBox();
  await list.getByText('雅屯河').click();
  await expect(page.locator(`[data-overlay="annotations"] [data-annotation-id="${BASE}/annotation/4321"]`)).toBeVisible();
  expect((await stage.boundingBox())?.width).toBeCloseTo(before!.width, 0);
  await list.getByText('雅屯河').click(); // 選択を外す
  await page.getByRole('checkbox', { name: '選んだ注釈へ画像を寄せる' }).check();
  await list.getByText('雅屯河').click();
  await expect.poll(async () => (await stage.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width * 5);

  // 検索を消すと全部に戻る
  await page.getByRole('searchbox', { name: '注釈の中を検索' }).fill('');
  await expect(page.getByText(`${N} 件`, { exact: true })).toBeVisible();
});
