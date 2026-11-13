import { test, expect, type Page } from '@playwright/test';

// Checks the viewer with real Cookbook data: what unit tests cannot see, such as captions actually
// loading into a video and a 3D model being drawn.
// All tests read outside sites (iiif.io), so they are tagged @external and skipped in CI.

const v4 = (recipe: string) => `https://iiif.io/api/cookbook/recipe/${recipe}/v4/manifest.json`;
const v3 = (recipe: string) => `https://iiif.io/api/cookbook/recipe/${recipe}/manifest.json`;

// Cookbook v4 recipes that are not on iiif.io yet (IIIF/cookbook-recipes #621 and #622 are unmerged).
// preview.iiif.io sends no CORS header, so add it to the response the browser receives.
// Once merged, switch to v4() URLs and drop allowCors.
const PREVIEW = 'https://preview.iiif.io/cookbook';
const v4Preview0074 = `${PREVIEW}/v4-0074-update-with-provides/recipe/0074-multiple-language-captions/v4/manifest.json`;
const v4Preview0079 = `${PREVIEW}/v4-0079-using-annotations-for-captions/recipe/0079-annotations-for-captions/v4/manifest.json`;

async function allowCors(page: Page, origin: string) {
  await page.route(`${origin}/**`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
}

const open = (page: Page, manifest: string) =>
  page.goto(`/ja/viewer/?iiif-content=${encodeURIComponent(manifest)}`);

interface TrackInfo {
  kind: string;
  language: string;
  cues: number;
}

// Load every caption track of the <video> (setting the mode to hidden starts loading) and return kind, language and cue count.
async function loadedTracks(page: Page, expected: number): Promise<TrackInfo[]> {
  // the entry screen also shows muted example clips: pick the viewer's player (it has controls)
  const video = page.locator('video[controls]');
  await expect(video).toBeAttached();
  await expect(video.locator('track')).toHaveCount(expected);
  await video.evaluate((v: HTMLVideoElement) => {
    for (const t of Array.from(v.textTracks)) if (t.mode === 'disabled') t.mode = 'hidden';
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => Array.from(v.textTracks).every((t) => (t.cues?.length ?? 0) > 0)))
    .toBe(true);
  return video.evaluate((v: HTMLVideoElement) =>
    Array.from(v.textTracks).map((t) => ({ kind: t.kind, language: t.language, cues: t.cues?.length ?? 0 })),
  );
}

const byLanguage = (a: TrackInfo, b: TrackInfo) => a.language.localeCompare(b.language);

test('3D モデルを描く（0608 v4）', { tag: '@external' }, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, v4('0608-mvm-3d'));
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('字幕ファイルを読む（0219 v4）', { tag: '@external' }, async ({ page }) => {
  await open(page, v4('0219-using-caption-file'));
  const tracks = await loadedTracks(page, 1);
  expect(tracks[0].kind).toBe('captions');
});

test('複数言語の字幕を読む（0074 v3）', { tag: '@external' }, async ({ page }) => {
  await open(page, v3('0074-multiple-language-captions'));
  const tracks = await loadedTracks(page, 2);
  expect(tracks.map((t) => t.language).sort()).toEqual(['en', 'it']);
});

test('provides で字幕の種類を見分ける（0074 v4、preview）', { tag: '@external' }, async ({ page }) => {
  await allowCors(page, PREVIEW);
  await open(page, v4Preview0074);
  const tracks = (await loadedTracks(page, 2)).sort(byLanguage);
  expect(tracks.map((t) => t.language)).toEqual(['en', 'it']);
  // 0074 v4 uses provides: English is subtitles (a translation), Italian is closedCaptions (the original language)
  expect(tracks.map((t) => t.kind)).toEqual(['subtitles', 'captions']);
});

test('注釈で書かれた字幕を読む（0079 v4、preview）', { tag: '@external' }, async ({ page }) => {
  await allowCors(page, PREVIEW);
  await open(page, v4Preview0079);
  const tracks = await loadedTracks(page, 1);
  expect(tracks[0].cues).toBeGreaterThan(1);
});

test('Collection を navDate の年代順に並べる（0230）', { tag: '@external' }, async ({ page }) => {
  await open(page, 'https://iiif.io/api/cookbook/recipe/0230-navdate/navdate-collection.json');
  await page.getByRole('button', { name: '年代順' }).click();
  const timeline = page.getByRole('list', { name: '年表' });
  await expect(timeline.getByRole('heading', { level: 3 })).toHaveText(['1986', '1987']);
  // the items carry no thumbnail: the picture comes from the image service of each Manifest
  await expect(timeline.locator('img[src*="/full/,192/0/default.jpg"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'コレクションの順' }).click();
  await expect(timeline).toHaveCount(0);
});
