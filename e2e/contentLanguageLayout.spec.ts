import { test, expect, type Locator, type Page } from '@playwright/test';

// The content language selector sits in its own row below the side panel tabs, and the tab row
// leaves room on the right for the panel's floating close button. Before, the selector sat at the
// right end of the tab row where the close button covered it, squeezed the tabs, and hid its label
// on phones.

const BASE = 'https://content-lang-layout.example.org';
// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${BASE}/manifest.json`,
  type: 'Manifest',
  label: {
    en: ['Multilingual Example'],
    fr: ['Exemple multilingue'],
    de: ['Mehrsprachiges Beispiel'],
  },
  metadata: [
    {
      label: { en: ['Creator'], fr: ['Auteur'], de: ['Urheber'] },
      value: { en: ['Author'], fr: ['Auteur'], de: ['Autor'] },
    },
  ],
  items: [
    {
      id: `${BASE}/canvas/1`,
      type: 'Canvas',
      width: 1000,
      height: 800,
      items: [
        {
          id: `${BASE}/canvas/1/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${BASE}/canvas/1/page/1`,
              type: 'Annotation',
              motivation: 'painting',
              body: { id: `${BASE}/image.png`, type: 'Image', format: 'image/png', width: 1000, height: 800 },
              target: `${BASE}/canvas/1`,
            },
          ],
        },
      ],
    },
  ],
};

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b, 'element is laid out').not.toBeNull();
  return b!;
};

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function openMultilingual(page: Page) {
  await page.route(`${BASE}/**`, (route) =>
    route.request().url().endsWith('.png')
      ? route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ json: manifest, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${BASE}/manifest.json`)}&content-lang=fr`);

  // On phone widths the side panel starts collapsed
  const panelToggle = page.getByRole('button', { name: /Show panel|Hide panel/ });
  await expect(panelToggle).toBeVisible();
  const openBtn = page.getByRole('button', { name: 'Show panel' });
  if ((await openBtn.count()) > 0) {
    await openBtn.click();
  }
  await expect(page.getByRole('combobox', { name: 'Content language' })).toBeVisible();
}

test('on a phone the content language selector shows its label and does not overlap the close button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openMultilingual(page);

  const select = page.getByRole('combobox', { name: 'Content language' });
  const labelText = page.getByText('Content language', { exact: true });
  const closeBtn = page.getByRole('button', { name: 'Hide panel' });
  const firstTab = page.getByRole('button', { name: 'About' });

  await expect(labelText).toBeVisible();

  const selectBox = await box(select);
  const closeBox = await box(closeBtn);
  const tabBox = await box(firstTab);

  expect(overlaps(selectBox, closeBox), 'content language select overlaps the side panel close button').toBe(false);
  expect(selectBox.y, 'content language select sits below the tab row').toBeGreaterThanOrEqual(
    tabBox.y + tabBox.height - 1,
  );
});

test('on a desktop screen the content language selector does not overlap the close button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMultilingual(page);

  const select = page.getByRole('combobox', { name: 'Content language' });
  const closeBtn = page.getByRole('button', { name: 'Hide panel' });

  const selectBox = await box(select);
  const closeBox = await box(closeBtn);

  expect(overlaps(selectBox, closeBox), 'content language select overlaps the side panel close button').toBe(false);
});
