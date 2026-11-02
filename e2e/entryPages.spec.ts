import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test, expect } from '@playwright/test';

// 各ページを、マニフェストなど URL の引数を何も付けずに開いたときの画面（入口）を確かめる。
// ページの一覧は src/app/[locale]/ から拾うので、ページを足せば自動でここの対象になる。
// [id] のような動的なページは、開くのに id が要るので除く。
//
// 見ること（PR #180 で見つかった崩れ・書き出しの不備を、ページを足すたびに見落とさないため）:
//   1. 画面の JS がエラーを出さない
//   2. サイト内のファイル（画像・動画・JSON など）の読み込みが 404 などで失敗しない
//   3. 最初の見出しが画面の上にはみ出していない（中身を真ん中寄せにして上が切れる崩れ）
//   4. 横にスクロールしない（幅いっぱいに広がる崩れ）
// これらを、パソコンの幅とスマートフォンの幅の両方で、日英の両方について見る。

const APP = join(process.cwd(), 'src', 'app', '[locale]');

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

        await tab.goto(path);
        // 上部の帯（header）のサイト名は除き、ページの中身の最初の見出しを見る
        const heading = tab.locator('h1:not(header *), h2:not(header *)').first();
        await expect(heading).toBeVisible();
        // 動画などの遅れて始まる読み込みも拾う
        await tab.waitForLoadState('networkidle');

        const box = await heading.boundingBox();
        expect(box, '最初の見出しの位置').not.toBeNull();
        expect(box!.y, '最初の見出しが画面の上にはみ出している').toBeGreaterThanOrEqual(0);
        // 見出しの上に別のもの（フッターなど）が重なっていない。/viewer/ の入口は、スマホの幅で
        // 中身の欄が高さ 0 に押しつぶされ、見出しがフッターの下に隠れていた（toBeVisible では拾えない）
        const covered = await heading.evaluate((h) => {
          h.scrollIntoView({ block: 'center' });
          const r = h.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + Math.min(5, r.width / 2), r.y + r.height / 2);
          return !(hit && h.contains(hit));
        });
        expect(covered, '最初の見出しが別のものの下に隠れている').toBe(false);

        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, '横にスクロールする').toBeLessThanOrEqual(1);

        // 画面に入るまで読み込まない動画・画像（preload="none"、loading="lazy"）は上の監視では拾えないので、参照先を直接取りに行く
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
