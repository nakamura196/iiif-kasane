import { test, expect, type Page } from '@playwright/test';

// 手元の画像を開く（/viewer の入口のボタン）。画像はサーバに送らず、ブラウザの中で表示・読み取りする。
// 送っていないことは、ページが出したリクエストを全部記録して確かめる:
// 行き先はこのサイト自身と、推論のモデル・実行の仕組みの配布元だけで、本文を持つ送信（POST など）は 1 つも無いこと。

// 読み取らせる画像。ファイルを置かずに、文字を書いたページを撮って作る
async function textImage(page: Page): Promise<Buffer> {
  await page.setViewportSize({ width: 900, height: 300 });
  await page.setContent(
    `<body style="margin:0;background:#fff">
      <p style="font:56px/1.6 'Hiragino Mincho ProN','Yu Mincho',serif;margin:40px 48px">吾輩は猫である。<br>名前はまだ無い。</p>
    </body>`,
  );
  const png = await page.screenshot({ type: 'png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  return png;
}

function recordRequests(page: Page) {
  const seen: { url: string; method: string; hasBody: boolean }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), hasBody: !!r.postDataBuffer()?.length }));
  return seen;
}

function expectNothingSent(seen: { url: string; method: string; hasBody: boolean }[], origin: string) {
  // モデルの配布元（Hugging Face）と、推論を動かす onnxruntime-web の配布元（jsDelivr）は取りに行ってよい
  const allowed = /^https:\/\/((huggingface\.co|[\w.-]+\.(hf\.co|huggingface\.co))\/|cdn\.jsdelivr\.net\/npm\/onnxruntime-web@)/;
  const outside = seen.filter(
    (r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:') && !allowed.test(r.url),
  );
  expect(outside, 'requests to other hosts').toEqual([]);
  expect(seen.filter((r) => r.hasBody || !['GET', 'HEAD'].includes(r.method)), 'requests that send data').toEqual([]);
}

async function openLocal(page: Page, png: Buffer) {
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-image-input').setInputFiles({ name: '猫.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('status').filter({ hasText: '猫.png' })).toBeVisible();
}

test('opens a local image without putting it in the address', async ({ page, baseURL }) => {
  const png = await textImage(page);
  const seen = recordRequests(page);
  await openLocal(page, png);

  // 画像は blob: の URL のまま表示される
  const img = page.locator('img[src^="blob:"]');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(900);

  // アドレス欄には画像も blob: も入らず、読み取りのタブで開く
  const url = new URL(page.url());
  expect(url.searchParams.get('tab')).toBe('inference');
  expect(url.search).not.toContain('blob');
  expect(url.searchParams.has('iiif-content')).toBe(false);

  // URL で他のページに渡す「ほかの表示」と、マニフェストのダウンロードは出さない
  await expect(page.getByRole('tab', { name: /ほかの表示/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /マニフェスト/ })).toHaveCount(0);

  expectNothingSent(seen, new URL(baseURL!).origin);
});

test('refuses a file that is not an image', async ({ page }) => {
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-image-input').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert').filter({ hasText: '画像ファイルではありません' })).toBeVisible();
});

// モデル（約 150 MB）をダウンロードするので時間がかかる
test('reads the text of a local image in the browser', async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  const png = await textImage(page);
  const seen = recordRequests(page);
  await openLocal(page, png);

  const card = page.locator('li').filter({ has: page.getByRole('heading', { name: 'NDLOCR-Lite', exact: true }) });
  const download = card.getByRole('button', { name: /ダウンロード（/ });
  const run = card.getByRole('button', { name: /この画像で実行|もう一度実行/ });
  // 前の実行でダウンロード済みなら、すぐ「実行」が出る
  await expect(download.or(run).first()).toBeVisible();
  if (await download.isVisible()) await download.click();
  await card.getByRole('button', { name: /この画像で実行|もう一度実行/ }).click({ timeout: 540_000 });
  await expect(card.getByText(/件（/)).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText('猫');

  expectNothingSent(seen, new URL(baseURL!).origin);
});
