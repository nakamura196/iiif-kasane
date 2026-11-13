import { expect, test, type Page } from '@playwright/test';

// Collection の項目を開いたとき、画像の表示が「いま開いている manifest」を読み直すこと（Issue #334）。
// 以前は最初に渡された Collection の URL を読み直していたため、画像の service が見つからず、
// 画像の id（ここでは画像ではない URL）をそのまま読みに行って「画像を読み込めませんでした」になった。
// 戻ったあとにもう一度開いても同じように出ることも見る。データはこのテストの中で返す。

const BASE = 'https://example.org/collection-entry';
const SERVICE = `${BASE}/front`;

// 1×1 の灰色の PNG（画像そのものは何でもよい。Canvas の大きさで描かれる）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
);

const collection = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/collection.json`,
  type: 'Collection',
  label: { en: ['Postcards'] },
  items: [{ id: `${BASE}/manifest.json`, type: 'Manifest', label: { en: ['Kameido'] } }],
};

// 画像の id は service と同じ URL で、そこ自体は画像を返さない（実在のサイトの形）。
// 画像は Image API の service（level 0、info.json）からしか取れない
const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Kameido'] },
  items: [
    {
      id: `${BASE}/canvas/front`,
      type: 'Canvas',
      width: 2048,
      height: 1024,
      items: [
        {
          id: `${BASE}/canvas/front/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/front/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: {
                id: SERVICE,
                type: 'Image',
                format: 'image/jpeg',
                width: 2048,
                height: 1024,
                service: [{ id: SERVICE, type: 'ImageService2', profile: 'level0' }],
              },
              target: `${BASE}/canvas/front`,
            },
          ],
        },
      ],
    },
  ],
};

const info = {
  '@context': 'http://iiif.io/api/image/2/context.json',
  '@id': SERVICE,
  protocol: 'http://iiif.io/api/image',
  profile: ['http://iiif.io/api/image/2/level0.json'],
  width: 2048,
  height: 1024,
  tiles: [{ width: 512, scaleFactors: [1, 2, 4] }],
};

const cors = { 'access-control-allow-origin': '*' };


async function serve(page: Page) {
  const seen = { tiles: [] as string[], plain: [] as string[] };
  await page.route(`${BASE}/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/collection.json')) return route.fulfill({ json: collection, headers: cors });
    if (url.endsWith('/manifest.json')) return route.fulfill({ json: manifest, headers: cors });
    if (url === `${SERVICE}/info.json`) {
      return route.fulfill({ json: info, headers: cors });
    }
    // Image API の要求（{id}/{region}/{size}/{rotation}/{quality}.{format}）にだけ画像を返す
    if (url.startsWith(`${SERVICE}/`) && /\.(jpg|png)$/.test(url)) {
      seen.tiles.push(url);
      return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    }
    // the body id itself is not an image: asking for it is the bug (#334)
    if (url === SERVICE) seen.plain.push(url);
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<p>not an image</p>', headers: cors });
  });
  return seen;
}

// number of the images that finished loading with a picture in them
const loadedCount = (imgs: Element[]) =>
  imgs.filter((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0).length;

test('Collection から開いた manifest の画像を、その manifest の Image API service で出す（#334）', async ({ page }) => {
  const seen = await serve(page);
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/collection.json`)}`);

  const entry = page.getByRole('button', { name: /Kameido/ });
  await entry.click();
  // a tile from the service arrives: the image is drawn through its Image API service
  await expect.poll(() => seen.tiles.length).toBeGreaterThan(0);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(seen.plain).toEqual([]);

  // back, and open it again: the image is drawn again from the service (a tile of the Image API that loaded),
  // the body id is never asked for, and no error shows. (The Collection's card may show a thumbnail from the
  // service, so only tiles, which name a region, count.)
  const fromService = page.locator(`img[src^="${SERVICE}/0,0,"]`);
  await expect.poll(() => fromService.evaluateAll(loadedCount)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^‹/ }).click();
  await expect(entry).toBeVisible();
  // the Collection is shown: no tile of the entry is left on the page
  await expect(fromService).toHaveCount(0);
  await entry.click();
  await expect(page.getByRole('button', { name: /^‹/ })).toBeVisible();
  await expect.poll(() => fromService.evaluateAll(loadedCount)).toBeGreaterThan(0);
  await expect(page.locator(`img[src="${SERVICE}"]`)).toHaveCount(0);
  await expect(page.getByText('Could not load the image')).toHaveCount(0);
  expect(seen.plain).toEqual([]);
});
