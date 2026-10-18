#!/usr/bin/env node
// お知らせ（content/news/<id>.md）を読んで、src/lib/news.generated.json（git に入れない）を書く。
// npm の predev・prebuild・pretest・prelint から呼ばれる。手で流すときは  node scripts/build-news.mjs
// 1 件 1 ファイルにしたのは、並行する PR が 1 本の一覧の先頭を取り合って毎回ぶつかっていたから。
// ファイルの形は content/news/README.md。並びは日付の新しい順、同じ日は order の大きい順（無ければ 0）、その次はファイル名の順。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'content/news');
const OUT = resolve(ROOT, 'src/lib/news.generated.json');

/** 1 ファイルを読む。front matter は「key: value」の行だけ（key の . で入れ子にする）。本文は「## ja」「## en」の節 */
export function parseNewsFile(id, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`news/${id}.md: 先頭の --- で囲んだ項目がありません`);
  const item = { id };
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(': ');
    if (at < 0) throw new Error(`news/${id}.md: 「key: value」になっていない行: ${line}`);
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 2).trim();
    if (key === 'note') continue; // 書き手向けの覚え書き。サイトには出さない
    if (key === 'usecases') value = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (value === 'true') value = true;
    else if (key === 'order') value = Number(value);
    const path = key.split('.');
    let o = item;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path.at(-1)] = value;
  }
  const body = {};
  for (const sec of m[2].split(/^## /m).slice(1)) {
    const nl = sec.indexOf('\n');
    body[sec.slice(0, nl).trim()] = sec.slice(nl + 1).trim();
  }
  item.body = body;
  return item;
}

export function readNews(dir = DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => parseNewsFile(f.slice(0, -3), readFileSync(resolve(dir, f), 'utf8')))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.order ?? 0) - (a.order ?? 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // order は並べ替えにだけ使う（サイトには要らない）
  const items = readNews().map((n) => { delete n.order; return n; });
  writeFileSync(OUT, JSON.stringify(items, null, 1) + '\n', 'utf8');
  console.log(`news: ${items.length} 件 → ${OUT.slice(ROOT.length + 1)}`);
}
