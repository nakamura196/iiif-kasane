#!/usr/bin/env node
/**
 * トップの OGP 画像（SNS でリンクを貼ったときに出る絵）を作る。
 * ユースケースの 1 つ（既定は上野駅周辺の 3D 都市モデルの見比べ）を Kasane で開いて画面を撮り、
 * 下にサイト名と説明を重ねて src/app/opengraph-image.png と twitter-image.png（同じ絵）に書き出す。
 *
 * 使い方:
 *   node scripts/capture-ogp.mjs                       # 本番 https://kasane.ldas.jp を開いて撮る
 *   node scripts/capture-ogp.mjs --usecase iiif-geo    # 別のユースケースの画面にする
 *   node scripts/capture-ogp.mjs --wait 30000          # 画像サーバが遅いとき、開いてから撮るまでを延ばす（ミリ秒）
 *   node scripts/capture-ogp.mjs --base http://localhost:3871 --manifest http://localhost:8765/ueno.json
 *                                                      # 公開前のマニフェストを、手元の開発サーバで開いて撮る
 *
 * 公開中の ueno.json は模型が同意画面（IIIF Auth 2.0）の後ろにあり、そのままでは撮れない。
 * 同意画面を入れる前の版（hongo-campus-iiif の 7bf85df~1）を手元で CORS 付きで配り、--manifest で渡す。
 * 本番のページからは手元（localhost）のファイルを読めない（ブラウザが止める）ので、--base も手元の開発サーバにする。
 *
 * 前提: Google Chrome（Playwright の channel: 'chrome' で使う）。Node 23.6 以降（TypeScript を直接読む）。
 */
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

await import('./lib/ts-hooks.mjs');
const { USE_CASES, hrefOf } = await import('../src/lib/usecases.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const SITE = 'https://kasane.ldas.jp';
const base = (arg('base') ?? SITE).replace(/\/$/, '');
const id = arg('usecase') ?? 'ueno';
const wait = Number(arg('wait') ?? 30000);
// 比較画面の見せ方。スワイプ（境目の左右で別の模型）がいちばん「重ねる」が伝わる
const mode = arg('mode') ?? 'swipe';
const manifest = arg('manifest');
// 撮る前に開いておく注釈（マニフェストの中の順番、1 から）。名前は印を押したときにしか出ないため。
// 既定では開かない。印を押すとカメラが建物に寄りすぎ、街並みが写らなくなる（上野は 2 番目が「上野駅」）
const openNth = Number(arg('open') ?? 0);

// OGP の推奨は 1200x630。画面は 4/3 倍の大きさで撮って縮め、文字がつぶれないようにする
const OUT_W = 1200;
const OUT_H = 630;
const SHOT_W = 1600;
const SHOT_H = 840;
const HEADER = 41; // サイトのヘッダー。写さない

const u = USE_CASES.find((x) => x.id === id);
if (!u) throw new Error(`ユースケースがありません: ${id}`);
const open = { ...u.open, ...(u.open.page === 'compare' ? { mode } : {}), ...(manifest ? { manifest } : {}) };
const url = `${base}/en${hrefOf(open)}`;

// 3D（WebGL）をヘッドレスで描くために swiftshader を許す
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
// 国立公文書館の画像サーバは HeadlessChrome を名乗ると 403 を返すので、ふつうの Chrome の名乗りにする
const ua = (await browser.newPage().then((p) => p.evaluate(() => navigator.userAgent))).replace('HeadlessChrome', 'Chrome');
// 右の欄（資料の説明）は写さない。欄の幅だけ画面を広げて開き、欄の手前まで撮る
const PANEL = 480;
const page = await browser.newPage({ viewport: { width: SHOT_W + PANEL, height: SHOT_H + HEADER }, userAgent: ua });
await page.goto(url);
await page.waitForTimeout(wait);
if (openNth) {
  // 注釈の印（AnnotationMarker の輪）。比較画面では左右の模型ごとに同じ並びで出る
  await page.evaluate((n) => {
    const rings = [...document.querySelectorAll('div.rounded-full.cursor-pointer.border-2')];
    rings[n - 1]?.click();
  }, openNth);
  await page.waitForTimeout(6000); // カメラがその視点へ移り終わるまで
}
// 右の欄の左端。幅を変える取っ手（cursor-col-resize）の親が欄そのもの（capture-thumbnails.mjs と同じ）
const right = await page.evaluate(() => {
  const r = document.querySelector('.cursor-col-resize')?.parentElement?.getBoundingClientRect();
  return r && r.width > 0 ? Math.round(r.left) : null;
});
// 3D の比較画面は、ヘッダーの下にもう一段（見せ方の切り替え）がある。描画面の上端から撮る
const top = await page.evaluate(
  (min) => Math.max(min, Math.round(document.querySelector('canvas')?.getBoundingClientRect().top ?? min)),
  HEADER,
);
// 開発サーバの左下の印（Next.js の dev indicator）は写さない
await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()));
const w = Math.min(right ?? SHOT_W, SHOT_W + PANEL);
const h = Math.min(SHOT_H + HEADER - top, Math.round((w * OUT_H) / OUT_W));
const shot = await page.screenshot({ clip: { x: 0, y: top + Math.round((SHOT_H + HEADER - top - h) / 2), width: w, height: h } });
await browser.close();

// 下の帯: 画面を暗くするグラデーションの上に、サイト名と一行の説明
const overlay = Buffer.from(`<svg width="${OUT_W}" height="${OUT_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#0f172a" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${OUT_H - 250}" width="${OUT_W}" height="250" fill="url(#g)"/>
  <text x="56" y="${OUT_H - 86}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff">IIIF Kasane</text>
  <text x="58" y="${OUT_H - 40}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="29" fill="#e2e8f0">Layer 3D models, images, audio, video and annotations in one view</text>
</svg>`);

const out = path.join(ROOT, 'src/app/opengraph-image.png');
const info = await sharp(shot)
  .resize(OUT_W, OUT_H)
  .composite([{ input: overlay }])
  .png({ compressionLevel: 9, palette: true, quality: 90 }) // 減色して 300 KB 前後に収める
  .toFile(out);
copyFileSync(out, path.join(ROOT, 'src/app/twitter-image.png'));
console.log(`src/app/opengraph-image.png, twitter-image.png  ${OUT_W}x${OUT_H}  ${Math.round(info.size / 1024)} KB  ← ${url}`);
