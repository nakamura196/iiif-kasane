import { expect, test, type Page } from '@playwright/test';

// 見開き（behavior: paged）のマニフェストで、範囲（#xywh=）を指して開いたとき、その範囲へ寄せて枠が範囲に重なること。
// 見開きのまま開いたときは、画像の上の層が、余白ではなく絵の上に載ること。
// 数値は国文研 200003803 の見開き（Canvas 5616×3744、範囲 2371,2100,117,532）に合わせた。マニフェストと画像はこのテストの中で返す。

const BASE = 'https://example.org/paged-region';
const W = 5616;
const H = 3744;
const XYWH = [2371, 2100, 117, 532];

// 3×2 の灰色の PNG（Canvas と同じ横長。object-contain で描いたときの余白が実際と同じになる）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAADklEQVR4nGNoaGhgAGIADAgDAcWhuYYAAAAASUVORK5CYII=', 'base64');

const canvas = (n: number) => ({
  id: `${BASE}/canvas/${n}`,
  type: 'Canvas',
  label: { none: [String(n)] },
  width: W,
  height: H,
  items: [
    {
      id: `${BASE}/canvas/${n}/page`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${BASE}/canvas/${n}/image`,
          type: 'Annotation',
          motivation: 'painting',
          body: { id: `${BASE}/p${n}.png`, type: 'Image', format: 'image/png', width: W, height: H },
          target: `${BASE}/canvas/${n}`,
        },
      ],
    },
  ],
  annotations: [
    {
      id: `${BASE}/canvas/${n}/annotations`,
      type: 'AnnotationPage',
      items: [
        {
          id: `${BASE}/canvas/${n}/note`,
          type: 'Annotation',
          motivation: 'commenting',
          target: `${BASE}/canvas/${n}#xywh=${XYWH.join(',')}`,
          body: { type: 'TextualBody', value: `note ${n}`, format: 'text/plain' },
        },
      ],
    },
  ],
});

const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest`,
  type: 'Manifest',
  label: { none: ['paged'] },
  behavior: ['paged'],
  items: [1, 2, 3].map(canvas),
};

async function serve(page: Page) {
  await page.route(`${BASE}/**`, (route) =>
    route.request().url().endsWith('.png')
      ? route.fulfill({ body: PNG, contentType: 'image/png' })
      : route.fulfill({ json: manifest, headers: { 'access-control-allow-origin': '*' } }),
  );
}

const open = (page: Page, canvasParam: string) =>
  page.goto(
    `/ja/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest`)}&canvas=${encodeURIComponent(canvasParam)}`,
  );

test('見開きでも、範囲を指して開くとそのページだけを出し、範囲へ寄せて枠を重ねる', async ({ page }) => {
  await serve(page);
  await open(page, `${BASE}/canvas/3#xywh=${XYWH.join(',')}`);

  // 見開きの 2 枚ではなく、拡大できる 1 枚の表示になる
  const stage = page.locator('[data-iiif-stage]');
  await expect(stage).toBeVisible();
  await expect(page.locator('img[data-canvas-id]')).toHaveCount(0);

  // 範囲へ寄せる: 範囲の高さが画面の大半を占める
  const highlight = page.getByTestId('region-highlight');
  await expect(highlight).toBeVisible();
  await expect.poll(async () => (await highlight.boundingBox())?.height ?? 0).toBeGreaterThan(300);

  // 枠は範囲の縦横比で、注釈の印（同じ範囲）と重なる
  const box = (await highlight.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(XYWH[2] / XYWH[3], 1);
  const note = (await page.locator(`[data-annotation-id="${BASE}/canvas/3/note"]`).first().boundingBox())!;
  expect(Math.abs(note.x - box.x)).toBeLessThan(3);
  expect(Math.abs(note.y - box.y)).toBeLessThan(3);
});

test('見開きのまま開いたとき、画像の上の層は余白ではなく絵の上に載る', async ({ page }) => {
  await serve(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, '3');

  const img = page.locator(`img[data-canvas-id="${BASE}/canvas/3"]`);
  await expect(page.locator('img[data-canvas-id]')).toHaveCount(2);
  const layer = page.locator(`[data-page-overlay="${BASE}/canvas/3"]`);
  await expect(layer).toBeVisible();

  const el = (await img.boundingBox())!;
  const b = (await layer.boundingBox())!;
  // 横長の Canvas が縦長の枠に収まるので、上下に余白がある。層は絵の縦横比で、縦の中央に置かれる
  expect(el.height).toBeGreaterThan(el.width * (H / W) + 10);
  expect(b.width / b.height).toBeCloseTo(W / H, 1);
  expect(Math.abs(b.y + b.height / 2 - (el.y + el.height / 2))).toBeLessThan(2);
});

test('枠の × か Esc で枠だけが消え、ページと寄せた位置はそのまま', async ({ page }) => {
  await serve(page);
  await open(page, `${BASE}/canvas/3#xywh=${XYWH.join(',')}`);

  const highlight = page.getByTestId('region-highlight');
  await expect(highlight).toBeVisible();
  await expect.poll(async () => (await highlight.boundingBox())?.height ?? 0).toBeGreaterThan(300);
  const note = page.locator(`[data-annotation-id="${BASE}/canvas/3/note"]`).first();
  // 寄せる動きが止まってから測る
  let last = '';
  await expect
    .poll(async () => {
      const b = await note.boundingBox();
      const now = b ? [b.x, b.y, b.width, b.height].map(Math.round).join(',') : '';
      const still = now !== '' && now === last;
      last = now;
      return still;
    })
    .toBe(true);
  const before = (await note.boundingBox())!;

  await page.getByTestId('region-highlight-clear').click();
  await expect(highlight).toHaveCount(0);
  // 拡大できる 1 枚の表示のまま、同じ所に寄せたまま
  await expect(page.locator('[data-iiif-stage]')).toBeVisible();
  const after = (await note.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(Math.abs(after.height - before.height)).toBeLessThan(3);

  // Esc でも消える
  await open(page, `${BASE}/canvas/3#xywh=${XYWH.join(',')}`);
  await expect(highlight).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(highlight).toHaveCount(0);
});

test('リンクから範囲を指して開いたときは、寄せる動きを付けずにその場所を出す', async ({ page }) => {
  await serve(page);
  await open(page, `${BASE}/canvas/3#xywh=${XYWH.join(',')}`);

  const highlight = page.getByTestId('region-highlight');
  await expect(highlight).toBeVisible();
  // 動き（CSS の transition）が付いていない
  const transition = await page.locator('[data-iiif-stage]').evaluate((el) => (el as HTMLElement).style.transition);
  expect(transition).toBe('');
  // 現れた時点で、もう範囲へ寄っている
  expect((await highlight.boundingBox())!.height).toBeGreaterThan(300);
});
