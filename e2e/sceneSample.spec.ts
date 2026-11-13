import { expect, test } from '@playwright/test';

// The Triceratops sample (SpecificResource-wrapped model, notes) draws its model.
test('the si-triceratops sample requests its model', async ({ page, baseURL }) => {
  const requested: string[] = [];
  await page.route('**/*.glb', (route) => {
    requested.push(route.request().url());
    return route.abort();
  });
  await page.goto(`/en/viewer/?iiif-content=${encodeURIComponent(`${baseURL}/manifests/si-triceratops.json`)}`);
  await expect.poll(() => requested.length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(requested[0]).toContain('Triceratops');
});
