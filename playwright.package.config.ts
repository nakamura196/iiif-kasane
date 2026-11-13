import { defineConfig, devices } from '@playwright/test';

// Browser check of the packed npm package (used by scripts/smoke-package.mjs, which sets SMOKE_PKG_DIR
// to the installed package). The spec starts its own static server on a free port; no outside network is used.
export default defineConfig({
  testDir: './e2e-package',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
