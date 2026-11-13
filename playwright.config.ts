import { defineConfig, devices } from '@playwright/test';

// ブラウザで実際に画面を開いて確かめるテスト。
//   npm run test:e2e                                   … next dev を立ち上げて試す（外のサイトを読むものも含む）
//   E2E_BASE_URL=https://kasane.ldas.jp npm run test:e2e … 本番を試す
// 外のサイト（iiif.io・Hugging Face など）を読むテストは、題に { tag: '@external' } を付ける。
// GitHub Actions（.github/workflows/e2e.yml）は書き出した out/ を相手に、@external を除いて走らせる:
//   npm run build && npm run serve:export &  →  E2E_BASE_URL=http://localhost:3862 npm run test:e2e:ci
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
    // IIIF Authorization Flow 2.0 のモックサーバ（e2e/auth.spec.ts が使う）
    { command: 'node scripts/auth-mock-server.mjs 3839', url: 'http://localhost:3839/manifest.json', reuseExistingServer: true },
    ...(process.env.E2E_BASE_URL
      ? []
      : [{ command: 'npm run dev', url: 'http://localhost:3838/ja/', reuseExistingServer: true, timeout: 180_000 }]),
  ],
});
