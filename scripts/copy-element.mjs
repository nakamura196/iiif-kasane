#!/usr/bin/env node
/**
 * <iiif-viewer> のビルド成果物 (packages/iiif-viewer/dist) を、静的書き出しの
 * out/element/v<版>/ に置く。版は packages/iiif-viewer/package.json の version。
 *
 * 使い方: npm run build の中で next build のあとに呼ばれる (単独実行も可)。
 * 先に dist/ がなければ npm run build:element を実行する。
 *
 * 前の版も out/element/v<前の版>/ に残す。埋め込みのコード（共有のページが出す）は版付きの URL を指すので、
 * 版を上げたときに消えると、よそのページの埋め込みが壊れるため。前の版のファイルは、
 * GitHub Release に添付した tgz から取り出す。版を上げたら、上げる前の版を PREVIOUS に足す。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREVIOUS = ['0.1.0'];
const releaseTgz = (v) =>
  `https://github.com/nakamura196/iiif-kasane/releases/download/iiif-viewer-v${v}/nakamura196-iiif-viewer-${v}.tgz`;

const root = new URL('../', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'packages/iiif-viewer/package.json'), 'utf8'));
const dist = join(root, 'packages/iiif-viewer/dist');
const out = join(root, 'out');

if (!existsSync(join(dist, 'iiif-viewer.js'))) {
  console.error('packages/iiif-viewer/dist/iiif-viewer.js がありません。先に npm run build:element を実行してください。');
  process.exit(1);
}
if (!existsSync(out)) {
  console.error('out/ がありません。先に next build を実行してください。');
  process.exit(1);
}

const dest = join(out, 'element', `v${pkg.version}`);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// dist/lib と dist/types は npm 向け（npm run build -w @nakamura196/iiif-viewer）。配信には要らない
const npmOnly = new Set([join(dist, 'lib'), join(dist, 'types')]);
cpSync(dist, dest, { recursive: true, filter: (p) => !npmOnly.has(p) });
console.log(`out/element/v${pkg.version}/: ${readdirSync(dest).join(', ')}`);

for (const v of PREVIOUS.filter((x) => x !== pkg.version)) {
  const res = await fetch(releaseTgz(v));
  if (!res.ok) {
    console.error(`v${v} の tgz を取れません (${res.status}): ${releaseTgz(v)}`);
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'iiif-viewer-'));
  writeFileSync(join(tmp, 'p.tgz'), Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', join(tmp, 'p.tgz'), '-C', tmp]);
  const old = join(tmp, 'package', 'dist');
  const oldDest = join(out, 'element', `v${v}`);
  rmSync(oldDest, { recursive: true, force: true });
  mkdirSync(oldDest, { recursive: true });
  const oldNpmOnly = new Set([join(old, 'lib'), join(old, 'types')]);
  cpSync(old, oldDest, { recursive: true, filter: (p) => !oldNpmOnly.has(p) });
  rmSync(tmp, { recursive: true, force: true });
  console.log(`out/element/v${v}/: ${readdirSync(oldDest).length} files (from the GitHub Release)`);
}
