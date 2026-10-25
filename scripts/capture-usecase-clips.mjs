#!/usr/bin/env node
/**
 * トップのカードに出す、ユースケースの短い動画（音なし・数秒・くり返し再生）を撮る。
 * 各ユースケースを Kasane で開き、見どころの操作（注釈を順に押す、境目を動かす、など）を自動で行って録画し、
 * 右の欄を除いたビューアの中央だけを切り出して public/clips/usecases/<id>.<ja|en>.mp4 に書き出す。
 * GIF ではなく動画にするのは、同じ長さで 1/10 ほどの大きさで済むため。
 *
 * 使い方:
 *   node scripts/capture-usecase-clips.mjs                       # 全部撮る（本番 https://kasane.ldas.jp を開く）
 *   node scripts/capture-usecase-clips.mjs --only shelley,ueno --locale en
 *   node scripts/capture-usecase-clips.mjs --base http://localhost:3842
 *
 * 前提: Playwright の Chromium（npx playwright install chromium）と ffmpeg（libx264 入り）。Node 23.6 以降。
 * 録画は Playwright の画面録画。操作の前後の読み込み中の部分は ffmpeg で切り落とす。
 * 3D はヘッドレスの描画が遅く、操作に実時間で数分かかることがある。そこで、どの動画も seconds の長さに縮める。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

await import('./lib/ts-hooks.mjs');
const { USE_CASES, hrefOf } = await import('../src/lib/usecases.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const base = (arg('base') ?? 'https://kasane.ldas.jp').replace(/\/$/, '');
const only = arg('only')?.split(',');
const locales = arg('locale')?.split(',') ?? ['ja', 'en'];

// 書き出す動画の幅と、1 秒あたりのコマ数
const OUT_WIDTH = 640;
const FPS = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 右の欄（SidePanel）の手前まで。幅を変える取っ手（cursor-col-resize）の親が欄そのもの
const stageRect = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.cursor-col-resize')?.parentElement?.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect();
    const top = Math.round(panel?.top ?? header?.bottom ?? 0);
    return { x: 0, y: top, width: Math.round(panel?.left ?? innerWidth), height: innerHeight - top };
  });

// 範囲の中央を 16:10 に切る
const fit = (r) => {
  const w = Math.min(r.width, Math.round(r.height * 1.6));
  const h = Math.min(r.height, Math.round(w / 1.6));
  const even = (n) => n - (n % 2);
  return {
    x: even(r.x + Math.round((r.width - w) / 2)),
    y: even(r.y + Math.round((r.height - h) / 2)),
    width: even(w),
    height: even(h),
  };
};

// 範囲（type="range"）を、キー操作で少しずつ動かす。React の入力欄にも効く
async function slide(page, locator, from, to, steps, ms) {
  await locator.focus();
  await page.keyboard.press(from === 'min' ? 'Home' : 'End');
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(to === 'max' ? 'ArrowRight' : 'ArrowLeft');
    await sleep(ms);
  }
}

// 境目（スワイプ）を、マウスで左右に動かす
async function swipe(page, rect) {
  const y = rect.y + rect.height / 2;
  const at = (f) => rect.x + rect.width * f;
  await page.mouse.move(at(0.5), y);
  await page.mouse.down();
  for (const [from, to] of [[0.5, 0.2], [0.2, 0.8], [0.8, 0.5]]) {
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(at(from + ((to - from) * i) / 30), y);
      await sleep(40);
    }
    await sleep(400);
  }
  await page.mouse.up();
}

// 目次の項目（名前と、同じ名前の何番目か）。表紙ではなく、領域に枠が出るものを選ぶ
const CURATION_ITEMS = [['Page 12', 0], ['Page 24', 1], ['p.9', 0], ['p.11', 1]];

// ユースケースごとの撮り方。wait: 開いてから操作を始めるまで（3D は読み込みが長い）。act: 見どころの操作。
// seconds: 書き出す動画の長さ（操作にかかった時間をこの長さに縮める）
const CLIPS = {
  'globe-annotations': {
    wait: 30000,
    seconds: 6,
    // 注釈の一覧の地名を順に押すと、視点がその地名へ移る
    act: async (page) => {
      for (const name of ['北海', 'イギリス', 'フランス']) {
        await page.locator('.cursor-pointer').filter({ hasText: name }).first().click();
        await sleep(3000);
      }
    },
  },
  'iiif-geo': {
    wait: 15000,
    seconds: 7,
    // 右の欄を閉じて地図と図を広げ、図の透明度を 0 から上げて、古地図を現在の地図に重ねる
    prepare: async (page) => {
      await page.getByRole('button', { name: /Hide panel|パネルを閉じる|閉じる/ }).first().click();
      await sleep(1500);
    },
    rect: (page) =>
      page.evaluate(() => {
        const header = document.querySelector('header').getBoundingClientRect();
        return { x: 0, y: Math.round(header.bottom), width: innerWidth - 40, height: innerHeight - Math.round(header.bottom) };
      }),
    act: async (page) => {
      const range = page.locator('input[type=range]').first();
      await slide(page, range, 'min', 'max', 20, 120);
      await sleep(1500);
      await slide(page, range, 'max', 'min', 20, 60);
      await sleep(600);
    },
  },
  shelley: {
    wait: 12000,
    seconds: 6,
    prepare: async (page) => {
      await page.getByRole('radio').nth(1).click(); // スワイプ
      await sleep(1500);
    },
    act: async (page, rect) => swipe(page, rect),
  },
  ueno: {
    wait: 30000,
    seconds: 7,
    prepare: async (page) => {
      await page.getByRole('radio').nth(1).click(); // スワイプ
      await sleep(2000);
    },
    act: async (page, rect) => swipe(page, rect),
  },
  curation: {
    // CODH の画像サーバは応答が遅い。録画の前に目次の項目を一度ずつ開いて、画像を読み込ませておく
    wait: 40000,
    seconds: 8,
    prepare: async (page) => {
      for (const [name, nth] of CURATION_ITEMS) {
        await page.getByText(name, { exact: true }).nth(nth).click({ timeout: 60000 });
        await sleep(12000);
      }
    },
    // 目次の項目を順に押すと、その頁が開き、選んだ領域に枠が出る
    act: async (page) => {
      for (const [name, nth] of CURATION_ITEMS) {
        await page.getByText(name, { exact: true }).nth(nth).click({ timeout: 60000 });
        await sleep(2500);
      }
    },
  },
  kaishi: {
    wait: 15000,
    seconds: 8,
    // 上の紙片から 1 枚ずつ隠して台紙だけにし、最後に「すべて表示」で戻す
    act: async (page) => {
      const hide = page.getByRole('button', { name: /^(Hide ".*"|「.*」を隠す)$/ });
      const n = await hide.count();
      for (let i = 0; i < n - 1; i++) {
        await hide.first().click();
        await sleep(450);
      }
      await sleep(1500);
      await page.getByRole('button', { name: /^(Show all|すべて表示)$/ }).click();
      await sleep(1500);
    },
  },
  'browse-edonohanami': {
    wait: 30000,
    seconds: 9,
    // 操作の案内を閉じ、グループ表示で落ち着いたところから、並び方（テーブル・球・らせん・グループ）を順に切り替える。
    // 並び方の切り替えボタンは言語で名前が変わるので、radiogroup の順番（table, sphere, helix, grid）で選ぶ
    prepare: async (page) => {
      await page.getByRole('button', { name: /^(Dismiss|案内を閉じる)$/ }).first().click({ timeout: 3000 }).catch(() => {});
      await sleep(2500);
    },
    // 3D の部分だけ（上の操作バーは含めない）
    rect: (page) =>
      page.evaluate(() => {
        const r = document.querySelector('.bw-stage').getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      }),
    act: async (page) => {
      const radios = page.getByRole('radiogroup').first().getByRole('radio');
      await sleep(1500);
      for (const i of [0, 1, 2, 3]) {
        await radios.nth(i).click();
        await sleep(3500);
      }
    },
  },
};

const work = mkdtempSync(path.join(tmpdir(), 'kasane-clips-'));
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--mute-audio'] });
let failed = 0;
for (const u of USE_CASES) {
  const clip = CLIPS[u.id];
  if (!clip || (only && !only.includes(u.id))) continue;
  for (const locale of locales) {
    const url = `${base}/${locale}${hrefOf(u.open)}`;
    const viewport = { width: 1680, height: 841 };
    const dir = path.join(work, `${u.id}.${locale}`);
    const context = await browser.newContext({ viewport, recordVideo: { dir, size: viewport } });
    const t0 = Date.now();
    const page = await context.newPage();
    try {
      await page.goto(url);
      await sleep(clip.wait);
      if (clip.prepare) await clip.prepare(page);
      const rect = fit(await (clip.rect ?? stageRect)(page));
      const start = (Date.now() - t0) / 1000;
      await clip.act(page, rect);
      const end = (Date.now() - t0) / 1000;
      await context.close();
      const raw = path.join(dir, readdirSync(dir)[0]);
      const out = path.join(ROOT, `public/clips/usecases/${u.id}.${locale}.mp4`);
      mkdirSync(path.dirname(out), { recursive: true });
      // prettier-ignore
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-ss', start.toFixed(2), '-i', raw, '-t', (end - start).toFixed(2),
        '-vf', `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},scale=${OUT_WIDTH}:-2,setpts=PTS*${(clip.seconds / (end - start)).toFixed(4)},fps=${FPS}`,
        '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
      ]);
      console.log(`${path.relative(ROOT, out)}  ${(end - start).toFixed(1)} 秒 → ${clip.seconds} 秒  ${Math.round(statSync(out).size / 1024)} KB  ← ${url}`);
    } catch (e) {
      failed++;
      console.error(`失敗: ${u.id} ${locale} (${url}): ${e.message}`);
      await context.close().catch(() => {});
    }
  }
}
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log('目で見て、読み込み途中のものは --only で撮り直してください');
process.exit(failed ? 1 : 0);
