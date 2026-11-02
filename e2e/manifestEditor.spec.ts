import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

// マニフェストエディタ（/manifest-editor）。手元の画像を選び、画像を置く場所の URL を入れて、
// ほかの場所でも使えるマニフェストをダウンロードする。画像はどこにも送らない。

async function pageImage(page: Page, n: number): Promise<Buffer> {
  await page.setViewportSize({ width: 300 + n, height: 400 });
  await page.setContent(`<body style="margin:0;background:#fff"><p style="font:120px sans-serif;margin:100px">${n}</p></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  return png;
}

type Any = Record<string, any>;

test('builds a manifest that points at the place the images will be', async ({ page, baseURL }) => {
  // 同じページで撮るので 1 枚ずつ（並べて撮ると、同じ画面が 2 回撮れることがある）
  const images = [];
  for (const n of [10, 2, 1]) images.push({ name: `p${n}.png`, mimeType: 'image/png', buffer: await pageImage(page, n) });
  const seen: { url: string; method: string }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method() }));

  await page.goto('/ja/manifest-editor/');
  // 置き場所が無いうちはダウンロードできない
  await page.getByTestId('editor-image-input').setInputFiles(images);
  await expect(page.getByTestId('editor-pages').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('editor-download')).toBeDisabled();
  await expect(page.getByTestId('editor-problems')).toContainText('画像を置く場所');

  // プレビューは手元の画像で表示する
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();

  await page.getByTestId('editor-image-base').fill('https://example.org/book');
  await expect(page.getByTestId('editor-download')).toBeEnabled();

  // 2 枚目を先頭へ
  await page.getByTestId('editor-pages').locator('li').nth(1).getByRole('button', { name: '前へ' }).click();

  const download = page.waitForEvent('download');
  await page.getByTestId('editor-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('manifest.json');
  const m = JSON.parse(await readFile((await file.path())!, 'utf8')) as Any;

  expect(m.id).toBe('https://example.org/book/manifest.json');
  // 名前順は p1, p2, p10。2 枚目（p2）を先頭に動かした
  expect(m.items.map((c: Any) => c.label.none[0])).toEqual(['p2', 'p1', 'p10']);
  const body = m.items[0].items[0].items[0].body;
  expect(body.id).toBe('https://example.org/book/p2.png');
  expect([body.width, body.height]).toEqual([302, 400]);
  expect(JSON.stringify(m)).not.toContain('blob:');

  // このサイトの外へは何も取りに行かず、何も送らない
  const origin = new URL(baseURL!).origin;
  expect(seen.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))).toEqual([]);
  expect(seen.filter((r) => !['GET', 'HEAD'].includes(r.method))).toEqual([]);
});

test('IIIF Image API: asks for the manifest URL and adds an image service', async ({ page }) => {
  const png = await pageImage(page, 1);
  await page.goto('/ja/manifest-editor/');
  await page.getByTestId('editor-image-input').setInputFiles({ name: 'a b.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel(/IIIF Image API 3\.0/).check();
  await page.getByTestId('editor-image-base').fill('https://iiif.example.org/iiif/3/');
  await expect(page.getByTestId('editor-problems')).toContainText('マニフェストを置く URL');
  await page.getByTestId('editor-manifest-id').fill('https://example.org/m/book.json');

  const download = page.waitForEvent('download');
  await page.getByTestId('editor-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('book.json');
  const m = JSON.parse(await readFile((await file.path())!, 'utf8')) as Any;
  const body = m.items[0].items[0].items[0].body;
  expect(body.id).toBe('https://iiif.example.org/iiif/3/a%20b.png/full/max/0/default.jpg');
  expect(body.service[0]).toEqual({ id: 'https://iiif.example.org/iiif/3/a%20b.png', type: 'ImageService3', profile: 'level1' });
  expect(m.items[0].id).toBe('https://example.org/m/book/canvas/p1');
});
