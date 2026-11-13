import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';

// Check the screen each page shows when opened without any URL argument such as a manifest (the entry screen).
// The page list is read from src/app/[locale]/, so adding a page puts it under test automatically.
// Dynamic pages such as [id] are left out because they need an id to open.
// Requests to outside hosts (images, YouTube, map tiles) get stand-ins so that CI does not depend on them.
//
// What it checks (so that the breakage and export mistakes found in PR #180 are not missed when pages are added):
//   1. the page's JS raises no error
//   2. files of this site (images, videos, JSON, ...) load without 404 and the like
//   3. the first heading does not run off the top of the screen (content centred so that the top is cut off)
//   4. the page does not scroll sideways (something spreading wider than the screen)
// Each is checked at desktop and phone widths, for both Japanese and English.

// A 1600x1000 placeholder for outside images (a large image still shows up in the overflow and heading checks)
const PLACEHOLDER = placeholderPng(1600, 1000);

const APP = join(process.cwd(), 'src', 'app', '[locale]');

// A single-colour PNG of the given size, built by hand to avoid a dependency
function placeholderPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), data.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit grey
  const rows = Buffer.alloc((width + 1) * height, 0xcc); // grey pixels; the first byte of each row is the filter type, set to 0 (none) below
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function staticPages(dir: string): string[] {
  const pages: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!name.includes('[')) pages.push(...staticPages(p));
    } else if (name === 'page.tsx') {
      pages.push(relative(APP, dir).split(sep).join('/'));
    }
  }
  return pages.sort();
}

const PAGES = staticPages(APP);
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

test('ページの一覧を拾えている', () => {
  expect(PAGES).toContain('');
  expect(PAGES).toContain('viewer');
});

for (const locale of ['ja', 'en'] as const) {
  for (const page of PAGES) {
    for (const vp of VIEWPORTS) {
      const path = `/${locale}/${page ? `${page}/` : ''}`;
      test(`入口 ${path} (${vp.name})`, async ({ page: tab, baseURL }) => {
        await tab.setViewportSize({ width: vp.width, height: vp.height });
        const errors: string[] = [];
        tab.on('pageerror', (e) => errors.push(`JS のエラー: ${e.message}`));
        const origin = new URL(baseURL!).origin;
        tab.on('response', (r) => {
          if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`読み込みに失敗 (${r.status()}): ${r.url()}`);
        });

        // Do not depend on outside sites: answer them with stand-ins that keep the layout real
        await tab.route((url) => url.origin !== origin, (route) => {
          const type = route.request().resourceType();
          if (type === 'image') return route.fulfill({ contentType: 'image/png', body: PLACEHOLDER });
          if (type === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title></title>' });
          return route.fulfill({ status: 200, body: '' });
        });

        await tab.goto(path);
        // Skip the site name in the header bar and look at the first heading of the page content
        const heading = tab.locator('h1:not(header *), h2:not(header *)').first();
        await expect(heading).toBeVisible();
        // Also catch loads that start late, such as videos (outside hosts are aborted above, so this settles)
        await tab.waitForLoadState('networkidle');

        const box = await heading.boundingBox();
        expect(box, '最初の見出しの位置').not.toBeNull();
        expect(box!.y, '最初の見出しが画面の上にはみ出している').toBeGreaterThanOrEqual(0);
        // Nothing else (such as the footer) covers the heading. The /viewer/ entry screen once had its content
        // column squashed to height 0 at phone width, hiding the heading under the footer (toBeVisible cannot catch this)
        const covered = await heading.evaluate((h) => {
          h.scrollIntoView({ block: 'center' });
          const r = h.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + Math.min(5, r.width / 2), r.y + r.height / 2);
          return !(hit && h.contains(hit));
        });
        expect(covered, '最初の見出しが別のものの下に隠れている').toBe(false);

        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, '横にスクロールする').toBeLessThanOrEqual(1);

        // Videos and images that load only when they come into view (preload="none", loading="lazy") escape the monitoring above, so fetch their targets directly
        const media = await tab.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('img[src], video[src], video[poster], source[src]')].flatMap((e) =>
            ['src', 'poster'].map((a) => e.getAttribute(a)).filter((v): v is string => !!v).map((v) => new URL(v, location.href).href),
          ),
        );
        for (const url of new Set(media.filter((u) => u.startsWith(origin)))) {
          const r = await tab.request.get(url);
          if (!r.ok()) errors.push(`参照先が無い (${r.status()}): ${url}`);
        }

        expect(errors).toEqual([]);
      });
    }
  }
}
