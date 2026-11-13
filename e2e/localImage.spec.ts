import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

// Open a local image (the buttons on the viewer's entry screen). The image is never sent to a server: it is shown and read in the browser.
// We check that by recording every request the page makes: they go only to this site and to the hosts that
// serve the inference models and runtime, and none of them sends data (POST and so on).

// The image to read: take a screenshot of a page with text on it instead of keeping a file
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

interface Seen {
  url: string;
  method: string;
  hasBody: boolean;
}

// The production site adds page-view analytics (Google Analytics; they need NEXT_PUBLIC_GA_ID, so a local build has none).
// Block them here so that the check below can stay strict for every other request.
const ANALYTICS =
  /^https:\/\/([\w-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|stats\.g\.doubleclick\.net|google\.[a-z.]+\/(ads|ccm)\/)/;

async function recordRequests(page: Page) {
  const seen: Seen[] = [];
  await page.route((url) => ANALYTICS.test(url.href), (route) => route.abort());
  page.on('request', (r) => {
    if (!ANALYTICS.test(r.url())) seen.push({ url: r.url(), method: r.method(), hasBody: !!r.postDataBuffer()?.length });
  });
  return seen;
}

function expectNothingSent(seen: Seen[], origin: string) {
  // The model host (Hugging Face) and the host of the onnxruntime-web runtime (jsDelivr) may be fetched
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
  const seen = await recordRequests(page);
  await openLocal(page, png);

  // The image is shown from a blob: URL
  const img = page.locator('img[src^="blob:"]');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(900);

  // Neither the image nor blob: goes into the address; it opens on the inference tab.
  // The address is updated just after the banner appears, so poll for it.
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('inference');
  const url = new URL(page.url());
  expect(url.search).not.toContain('blob');
  expect(url.searchParams.has('iiif-content')).toBe(false);

  // No "other views" tab (it hands a URL to other pages) and no manifest download
  await expect(page.getByRole('tab', { name: /ほかの表示/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /マニフェスト/ })).toHaveCount(0);

  expectNothingSent(seen, new URL(baseURL!).origin);
});

test('refuses a file that is not an image', async ({ page }) => {
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-image-input').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert').filter({ hasText: '画像ファイルではありません' })).toBeVisible();
});

// One image per page with its number on it (p1, p2, p10, so that name order and number order differ)
async function pageImage(page: Page, n: number): Promise<Buffer> {
  await page.setViewportSize({ width: 300 + n, height: 400 });
  await page.setContent(`<body style="margin:0;background:#fff"><p style="font:120px sans-serif;margin:100px">${n}</p></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  return png;
}

test('opens several images as one book, in number order', async ({ page, baseURL }) => {
  // Give each page a different width and check the order by width.
  // They are drawn on the same page, so one at a time.
  const pages: { n: number; png: Buffer }[] = [];
  for (const n of [10, 2, 1]) pages.push({ n, png: await pageImage(page, n) });
  const seen = await recordRequests(page);
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-image-input').setInputFiles([
    ...pages.map(({ n, png }) => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: png })),
    { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  const banner = page.getByRole('status').filter({ hasText: '3 枚' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('1 件は開いていません');

  // The widths differ per page (p1 = 301, p2 = 302, p10 = 310). p1 comes first.
  const first = page.locator('img[src^="blob:"]').first();
  await expect(first).toBeVisible();
  await expect.poll(() => first.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(301);
  // Going forward shows p2, then p10
  for (const width of [302, 310]) {
    await page.getByRole('button', { name: '次へ' }).click();
    await expect.poll(() => page.locator('img[src^="blob:"]').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(width);
  }
  const url = new URL(page.url());
  expect(url.search).not.toContain('blob');
  expectNothingSent(seen, new URL(baseURL!).origin);
});

test('opens a folder, named after the folder', async ({ page, baseURL }, testInfo) => {
  const dir = testInfo.outputPath('銘尽');
  await mkdir(dir, { recursive: true });
  for (const n of [2, 1]) await writeFile(`${dir}/${n}.png`, await pageImage(page, n));
  // A hidden file that gets mixed in when a folder is opened
  await writeFile(`${dir}/.DS_Store`, 'x');
  const seen = await recordRequests(page);
  await page.goto('/ja/viewer/');
  await page.getByTestId('local-folder-input').setInputFiles(dir);
  const banner = page.getByRole('status').filter({ hasText: '「銘尽」（2 枚）' });
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText('開いていません');
  await expect.poll(() => page.locator('img[src^="blob:"]').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(301);
  expectNothingSent(seen, new URL(baseURL!).origin);
});

// Downloads the model (about 150 MB) from Hugging Face, so it takes a while (@external)
test('reads the text of a local image in the browser', { tag: '@external' }, async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  const png = await textImage(page);
  const seen = await recordRequests(page);
  await openLocal(page, png);

  const card = page.locator('li').filter({ has: page.getByRole('heading', { name: 'NDLOCR-Lite', exact: true }) });
  const download = card.getByRole('button', { name: /ダウンロード（/ });
  const run = card.getByRole('button', { name: /この画像で実行|もう一度実行/ });
  // If a previous run already downloaded the model, "run" shows up at once
  await expect(download.or(run).first()).toBeVisible();
  if (await download.isVisible()) await download.click();
  await card.getByRole('button', { name: /この画像で実行|もう一度実行/ }).click({ timeout: 540_000 });
  await expect(card.getByText(/件（/)).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText('猫');

  expectNothingSent(seen, new URL(baseURL!).origin);
});
