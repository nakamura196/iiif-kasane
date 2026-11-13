// Smoke test of the npm package iiif-kasane (packages/iiif-viewer) as users receive it.
//   node scripts/smoke-package.mjs [--no-browser] [--keep]
// It builds the package, packs it with `npm pack`, installs the tarball into a temporary
// consumer project (with the peer dependencies at the versions of this repository's lockfile),
// and checks what a user would get: the files named in "exports", the framework-free core
// entry in plain Node, the main entry not needing three.js, the types, and (unless
// --no-browser) the <iiif-kasane> tag bundle in a real browser. It needs no outside network
// beyond the npm registry for the install (which prefers the local npm cache).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'iiif-viewer');
const args = new Set(process.argv.slice(2));
const started = Date.now();
const failures = [];

const run = (cmd, argv, cwd, opts = {}) =>
  execFileSync(cmd, argv, { cwd, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, ...opts.env } });
const step = (msg) => console.log(`\n== ${msg}`);
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

// 1. Build and pack. `npm pack` runs "prepack", which builds, so build once explicitly to show errors early.
step('Build the package');
run('npm', ['run', 'build', '-w', 'iiif-kasane'], root);

const work = mkdtempSync(join(tmpdir(), 'kasane-smoke-'));
step(`Pack into ${work}`);
const packOut = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], pkgDir, { quiet: true });
const packed = JSON.parse(packOut)[0];
const tarball = join(work, packed.filename);
const tarFiles = new Set(packed.files.map((f) => f.path));
console.log(`  ${packed.filename}: ${packed.files.length} files, ${(packed.size / 1024).toFixed(0)} kB`);

// 2. Every path in "exports" (and the legacy entry) must be in the tarball.
step('Check the tarball against package.json');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const exported = new Set();
const collect = (v) => (typeof v === 'string' ? exported.add(v.replace(/^\.\//, '')) : Object.values(v).forEach(collect));
collect(pkg.exports);
for (const extra of ['dist/iiif-kasane.js', 'dist/iiif-viewer.js', 'dist/style.css', 'README.md', 'LICENSE']) exported.add(extra);
for (const p of [...exported].sort()) check(tarFiles.has(p), `tarball contains ${p}`);
check(![...tarFiles].some((p) => p.startsWith('src/') || p.endsWith('.map')), 'tarball has no src/ or source maps');

// 3. Install the tarball into a consumer project.
step('Install into a consumer project');
const consumer = join(work, 'consumer');
mkdirSync(consumer);
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const locked = (name) => lock.packages[`node_modules/${name}`].version;
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify({
    name: 'kasane-smoke-consumer',
    private: true,
    type: 'module',
    dependencies: { 'iiif-kasane': `file:${tarball}`, react: locked('react'), 'react-dom': locked('react-dom'), jotai: locked('jotai') },
    devDependencies: { typescript: locked('typescript'), '@types/react': locked('@types/react') },
  }),
);
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], consumer);
const installed = join(consumer, 'node_modules', 'iiif-kasane');
check(!existsSync(join(consumer, 'node_modules', 'three')), 'three.js is not installed (optional peer)');

// 4. The core entry in plain Node (no DOM).
step('Core entry in plain Node');
const coreOut = run(
  'node',
  ['--input-type=module', '-e', "const m = await import('iiif-kasane/core'); console.log(typeof m.fetchManifest, typeof window)"],
  consumer,
  { quiet: true },
).trim();
check(coreOut === 'function undefined', `iiif-kasane/core imports without a DOM and exports fetchManifest (${coreOut})`);

// 5. The main entry must not pull three.js, even through its own chunks (static imports only; the 3D part is a lazy import).
step('Main entry does not need 3D packages');
const THREE = /^(three|three-stdlib|gsap|@react-three\/.+)(\/|$)/;
const staticImports = (src) =>
  [...src.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?["']([^"']+)["']/g)].map((m) => m[1]);
const walk = (entryAbs) => {
  const seen = new Set();
  const bare = new Set();
  const todo = [entryAbs];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of staticImports(readFileSync(f, 'utf8'))) {
      if (spec.startsWith('.')) todo.push(resolve(dirname(f), spec));
      else bare.add(spec);
    }
  }
  return { files: seen.size, bare: [...bare].sort() };
};
const main = walk(join(installed, pkg.exports['.'].default));
console.log(`  main entry: ${main.files} files, bare imports: ${main.bare.join(', ')}`);
check(!main.bare.some((s) => THREE.test(s)), 'main entry does not statically import three.js, @react-three/*, gsap');
check(main.bare.includes('react') && main.bare.includes('jotai'), 'react and jotai stay external (peers, not bundled)');
const core = walk(join(installed, pkg.exports['./core'].default));
check(!core.bare.some((s) => /^(react|react-dom|jotai|three)/.test(s)), `core entry needs no React/jotai/three (${core.bare.join(', ') || 'none'})`);
const tagSrc = readFileSync(join(installed, 'dist', 'iiif-kasane.js'), 'utf8');
check(!staticImports(tagSrc).some((s) => !s.startsWith('.')), 'tag bundle iiif-kasane.js has no bare imports (self-contained)');
check(readFileSync(join(installed, 'dist', 'iiif-viewer.js'), 'utf8').includes('iiif-kasane.js'), 'legacy iiif-viewer.js loads iiif-kasane.js');
check(readFileSync(join(installed, 'dist', 'style.css'), 'utf8').length > 1000, 'style.css is not empty');

// 6. Types resolve for a TypeScript consumer.
step('Types resolve (tsc --noEmit)');
writeFileSync(
  join(consumer, 'check.ts'),
  [
    "import { Viewer, type ViewerState } from 'iiif-kasane';",
    "import { fetchManifest } from 'iiif-kasane/core';",
    "import 'iiif-kasane/scene';",
    'export const v: typeof Viewer = Viewer;',
    'export const f: typeof fetchManifest = fetchManifest;',
    'export type S = ViewerState;',
  ].join('\n'),
);
writeFileSync(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: [] }, files: ['check.ts'] }),
);
try {
  run('node', [join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumer], consumer);
  check(true, 'a TypeScript consumer type-checks against the installed package');
} catch {
  check(false, 'a TypeScript consumer type-checks against the installed package');
}

// 7. The tag bundle in a real browser.
if (!args.has('--no-browser') && failures.length === 0) {
  step('<iiif-kasane> tag in Chromium');
  try {
    run('npx', ['playwright', 'test', '-c', 'playwright.package.config.ts'], root, { env: { SMOKE_PKG_DIR: installed } });
    check(true, 'the tag bundle renders a manifest');
  } catch {
    check(false, 'the tag bundle renders a manifest');
  }
}

if (!args.has('--keep')) rmSync(work, { recursive: true, force: true });
else console.log(`\nKept ${work}`);
console.log(`\n${failures.length ? `FAILED (${failures.length}):\n - ${failures.join('\n - ')}` : 'All package checks passed'} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failures.length ? 1 : 0);
