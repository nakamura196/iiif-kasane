#!/usr/bin/env node
/**
 * サンプル（/samples）とユースケース（/usecases、トップの入力欄の下）のサムネイルを撮る。
 * 各サンプルを Kasane のビューアで開き、その画面をヘッドレスの Chrome で撮って、
 * public/thumbnails/<samples|usecases>/<id>.webp に縮小して書き出す。
 * 資料の画像ではなくビューアの画面を撮るのは、「開くと何ができるか」（注釈・文字起こし・比較など）を見せたいため。
 *
 * 使い方:
 *   node scripts/capture-thumbnails.mjs                 # 全部撮る（本番 https://kasane.ldas.jp を開く）
 *   node scripts/capture-thumbnails.mjs --only 0021,shelley
 *   node scripts/capture-thumbnails.mjs --base http://localhost:3838   # 手元の開発サーバを開く
 *   node scripts/capture-thumbnails.mjs --missing       # まだ無いものだけ撮る（サンプルを足したとき）
 *   node scripts/capture-thumbnails.mjs --only curation --wait 40000   # 画像サーバが遅いとき、開いてから撮るまでを延ばす（ミリ秒）
 *
 * 前提: Google Chrome（別の場所なら CHROME=<実行ファイル> で指定）。Node 23.6 以降（TypeScript を直接読む）。
 * 開発サーバで撮ると、画面の隅に Next.js の印が写る。本番で撮るほうがきれい。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// src/ の TypeScript を読めるようにしてから、サンプルの一覧を読む
await import('./lib/ts-hooks.mjs');
const { SAMPLES, sampleHref } = await import('../src/lib/samples.ts');
const { USE_CASES, hrefOf } = await import('../src/lib/usecases.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const SITE = 'https://kasane.ldas.jp';
const base = (arg('base') ?? SITE).replace(/\/$/, '');
const only = arg('only')?.split(',');
const missingOnly = process.argv.includes('--missing');
const waitArg = arg('wait') ? Number(arg('wait')) : undefined;

// 撮る画面の大きさ。上端のサイトのヘッダー（HEADER px）は写さず、16:10 で残す
const WIDTH = 1280;
const HEIGHT = 800;
const HEADER = 41;
const OUT_WIDTH = 640;
// ユースケースを撮るときの画面の幅（右の欄を除くと中央がおよそ 1280 px 残る）
const STAGE_WIDTH = 1680;

// 右の欄（SidePanel）の左端。幅を変える取っ手（cursor-col-resize）の親が欄そのもの。無ければ null
const STAGE_RIGHT = `(() => {
  const h = document.querySelector('.cursor-col-resize');
  const r = h?.parentElement?.getBoundingClientRect();
  return r && r.width > 0 ? Math.round(r.left) : null;
})()`;

// 撮る前にページで行う操作（id ごと）。画面を開いただけでは見どころが写らないものに使う
const PREPARE = {
  // 地球儀のピンは裏側にあるので、アノテーションの 1 件目を押して、その場所へ視点を移す
  'globe-annotations': `[...document.querySelectorAll('.cursor-pointer')].find((e) => e.textContent.includes('北海'))?.click()`,
  // 開いた直後は巻物の全体なので、一覧の場面を 1 つ押して、そこへ寄った画面を撮る
  // 推論タブは上からモデルが並ぶので、「クリックで切り出す」の項目が見える位置までスクロールする
  'click-outline-edonohanami': `[...document.querySelectorAll('div')].filter((e) => e.children.length === 0 && /^(クリックで切り出す|Click to outline)$/.test(e.textContent.trim()))[0]?.scrollIntoView({ block: 'center' })`,
  // ストーリーは開いた直後だと 1 枚目の全体なので、「次へ」で最初の場面に寄った画面を撮る
  'ndl-emaki-story': `[...document.querySelectorAll('button')].find((e) => e.textContent.includes('次へ') || e.textContent.includes('Next'))?.click()`,
  'cma-fukutomi-story': `[...document.querySelectorAll('button')].find((e) => e.textContent.includes('次へ') || e.textContent.includes('Next'))?.click()`,
  // 開いた直後はコレクションの一覧なので、ページの言語の動画集を押して、1 本目の動画を開いた画面を撮る
  'youtube-tutorials': `[...document.querySelectorAll('button, a')].find((e) => e.textContent.includes(location.pathname.includes('/en/') ? '(English)' : '（日本語）'))?.click()`,
  // 3D 一覧は操作の案内が左上に出てカードに重なるので、閉じてから撮る
  'browse-edonohanami': `document.querySelector('button[aria-label="案内を閉じる"], button[aria-label="Dismiss"]')?.click()`,
};
// 操作のあと撮るまでの待ち時間（既定 3 秒）。深く寄ると、細かいタイルが届くまで時間がかかる
const PREPARE_WAIT = { 'ndl-emaki-story': 12000, 'cma-fukutomi-story': 12000, 'youtube-tutorials': 10000 };

const targets = [
  ...SAMPLES.map((s) => ({
    id: s.id,
    file: `public/thumbnails/samples/${s.id}.webp`,
    href: sampleHref(s),
    // 開いてから撮るまでの待ち時間。3D は読み込みに 15〜20 秒かかる
    wait: s.media === '3d' ? 30000 : 10000,
  })),
  // ユースケースはトップのカードに出すので、右の欄を除いたビューアの中央だけを、言語ごとに撮る
  // （英語のページに日本語の画面が写らないように）。右の欄の分だけ画面を広くして、中央を 16:10 に近づける
  ...USE_CASES.flatMap((u) =>
    ['ja', 'en'].map((locale) => ({
      id: u.id,
      locale,
      file: `public/thumbnails/usecases/${u.id}.${locale}.webp`,
      href: hrefOf(u.open),
      wait: 15000,
      width: STAGE_WIDTH,
      stage: true,
    })),
  ),
].filter((t) => (!only || only.includes(t.id)) && (!missingOnly || !existsSync(path.join(ROOT, t.file))));

// Chrome を 1 つ立ち上げ、DevTools Protocol（外からページを操作する窓口）で各ページを開いて撮る。
// 画面を撮るだけなら --screenshot で足りるが、動画は 0 秒目が黒いので、途中まで進めてから撮りたい
const profile = mkdtempSync(path.join(tmpdir(), 'kasane-thumbs-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
  '--enable-unsafe-swiftshader', // 3D（WebGL）をヘッドレスで描く
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT + HEADER}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', () => reject(new Error(`Chrome が起動しませんでした: ${buf}`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error.message));
  else p.resolve(msg.result);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ページに入っている動画を、長さの 1/4 の位置で止める（読み込めていない動画は放っておく）。
// SEEK_AT に秒があるものは、その位置で止める（見せたい場面が 1/4 の位置に無いとき）
const SEEK_AT = {
  // 人の枠は 5〜15 秒にだけある。5 秒すぎは、神面の前の男性とカメラを構える人の 2 つの枠が出る
  'video-objects': 5.3,
  // 音声は 0 秒目だと字幕の先頭しか光らないので、30 秒すぎ（「母音の前には…」のあたり）で止める
  'rekion-audio': 30,
};
const seekVideos = (at) => `Promise.all([...document.querySelectorAll('video, audio')].map((v) => new Promise((done) => {
  if (!(v.duration > 0)) return done();
  v.pause();
  v.addEventListener('seeked', () => done(), { once: true });
  v.currentTime = ${at ?? 'v.duration / 4'};
  setTimeout(done, 5000);
})))`;

// ヘッドレスの Chrome は User-Agent に「HeadlessChrome」と名乗る。国立公文書館の画像サーバは
// これを 403 で断る（manifest.json は通る）ので、ふつうの Chrome と同じ名乗りに替えて撮る
const { userAgent } = await send('Browser.getVersion');
const UA = userAgent.replace('HeadlessChrome', 'Chrome');

let failed = 0;
for (const t of targets) {
  // 手元のサーバで撮るときは、このサイトのマニフェストも手元から読む（本番にまだ無いものを撮れるように）
  const href = base === SITE ? t.href : t.href.replaceAll(encodeURIComponent(SITE), encodeURIComponent(base));
  const url = `${base}/${t.locale ?? 'ja'}${href}`;
  const width = t.width ?? WIDTH;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT + HEADER, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Emulation.setUserAgentOverride', { userAgent: UA }, sessionId);
    await send('Page.navigate', { url }, sessionId);
    await sleep(waitArg ?? t.wait);
    if (PREPARE[t.id]) {
      await send('Runtime.evaluate', { expression: PREPARE[t.id] }, sessionId);
      await sleep(PREPARE_WAIT[t.id] ?? 3000);
    }
    await send('Runtime.evaluate', { expression: seekVideos(SEEK_AT[t.id]), awaitPromise: true }, sessionId);
    await sleep(500);
    // 撮る範囲。stage のときは右の欄の手前まで、縦は 16:10 に収まるよう中央を残す
    let clip = { x: 0, y: HEADER, width, height: HEIGHT, scale: 1 };
    if (t.stage) {
      const { result } = await send('Runtime.evaluate', { expression: STAGE_RIGHT, returnByValue: true }, sessionId);
      const w = result.value ?? width;
      const h = Math.min(HEIGHT, Math.round(w / 1.6));
      clip = { x: 0, y: HEADER + Math.round((HEIGHT - h) / 2), width: w, height: h, scale: 1 };
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip }, sessionId);
    const out = path.join(ROOT, t.file);
    mkdirSync(path.dirname(out), { recursive: true });
    const info = await sharp(Buffer.from(data, 'base64'))
      .resize({ width: OUT_WIDTH })
      .webp({ quality: 72 })
      .toFile(out);
    console.log(`${t.file}  ${clip.width}x${clip.height}  ${Math.round(info.size / 1024)} KB  ← ${url}`);
  } catch (e) {
    failed++;
    console.error(`失敗: ${t.id} (${url}): ${e.message}`);
  } finally {
    await send('Target.closeTarget', { targetId });
  }
}

ws.close();
chrome.kill();
await new Promise((r) => chrome.once('exit', r));
rmSync(profile, { recursive: true, force: true });
console.log(`${targets.length - failed} / ${targets.length} 枚を書き出しました。目で見て、読み込み途中のものは --only で撮り直してください`);
process.exit(failed ? 1 : 0);
