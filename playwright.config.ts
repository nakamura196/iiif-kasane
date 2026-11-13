import { defineConfig, devices } from '@playwright/test';

// Browser tests that open the real pages.
//   npm run test:e2e                                      starts next dev and runs everything (including @external)
//   E2E_BASE_URL=https://kasane.ldas.jp npm run test:e2e   runs against another server (none is started)
// A test that reads an outside site (iiif.io, Hugging Face, ...) gets { tag: '@external' } in its title.
// GitHub Actions (.github/workflows/e2e.yml) runs everything else against the static export out/:
//   npm run build
//   npm run serve:export &
//   E2E_BASE_URL=http://localhost:3862 npm run test:e2e:ci
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3838';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  retries: 1,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // Mock server for the IIIF Authorization Flow 2.0 (used by e2e/auth.spec.ts). It is started even when E2E_BASE_URL is set.
    { command: 'node scripts/auth-mock-server.mjs 3839', url: 'http://localhost:3839/manifest.json', reuseExistingServer: true },
    ...(process.env.E2E_BASE_URL
      ? []
      : [{ command: 'npm run dev', url: 'http://localhost:3838/ja/', reuseExistingServer: true, timeout: 180_000 }]),
  ],
});
