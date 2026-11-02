import { mkdir, writeFile } from 'node:fs/promises';
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

// 1 ページずつ数字の入った画像を作る（名前順と数字順が違うように、p1・p2・p10 にする）
async function pageImage(page: Page, n: number): Promise<Buffer> {
  await page.setViewportSize({ width: 300 + n, height: 400 });
  await page.setContent(`<body style="margin:0;background:#fff"><p style="font:120px sans-serif;margin:100px">${n}</p></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  return png;
}

test('opens several images as one book, in number order', async ({ page, baseURL }) => {
  // 幅をページごとに変えておき、並び順を幅で確かめる
  // 同じページで描くので 1 枚ずつ
  const pages: { n: number; png: Buffer }[] = [];
  for (const n of [10, 2, 1]) pages.push({ n, png: await pageImage(page, n) });
  const seen = recordRequests(page);
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-image-input').setInputFiles([
    ...pages.map(({ n, png }) => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: png })),
    { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  const banner = page.getByRole('status').filter({ hasText: '3 枚' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('1 件は開いていません');

  // 画像の幅をページごとに変えてある（p1 = 301、p2 = 302、p10 = 310）。最初に出るのは p1
  const first = page.locator('img[src^="blob:"]').first();
  await expect(first).toBeVisible();
  await expect.poll(() => first.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(301);
  // 次へ送ると p2、p10 の順に出る
  for (const width of [302, 310]) {
    await page.getByRole('button', { name: '次へ' }).click();
    await expect.poll(() => page.locator('img[src^="blob:"]').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(width);
  }
  const url = new URL(page.url());
  expect(url.search).not.toContain('blob');
  expectNothingSent(seen, new URL(baseURL!).origin);
});

test('opens a folder, named after the folder', async ({ page }, testInfo) => {
  const dir = testInfo.outputPath('銘尽');
  await mkdir(dir, { recursive: true });
  for (const n of [2, 1]) await writeFile(`${dir}/${n}.png`, await pageImage(page, n));
  // フォルダを開くと混ざる隠しファイル
  await writeFile(`${dir}/.DS_Store`, 'x');
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-folder-input').setInputFiles(dir);
  const banner = page.getByRole('status').filter({ hasText: '「銘尽」（2 枚）' });
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText('開いていません');
  await expect.poll(() => page.locator('img[src^="blob:"]').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(301);
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
