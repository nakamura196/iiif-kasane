#!/usr/bin/env node
/**
 * <iiif-viewer> のビルド成果物 (packages/iiif-viewer/dist) を、静的書き出しの
 * out/element/v<版>/ に置く。版は packages/iiif-viewer/package.json の version。
 *
 * 使い方: npm run build の中で next build のあとに呼ばれる (単独実行も可)。
 * 先に dist/ がなければ npm run build:element を実行する。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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
