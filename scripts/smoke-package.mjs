// Smoke test of the npm package iiif-kasane (packages/iiif-viewer) as users receive it.
//   node scripts/smoke-package.mjs [--no-browser] [--keep] [--pack-dir <dir>]
// With --pack-dir the tarball that was tested is left in <dir>, so that the publish job can publish exactly that file.
// It builds the package, packs it with `npm pack`, installs the tarball into a temporary
// consumer project (with the peer dependencies at the versions of this repository's lockfile),
// and checks what a user would get: the files named in "exports", the framework-free core
// entry in plain Node, the main entry not needing three.js, the types, and (unless
// --no-browser) the <iiif-kasane> tag bundle in a real browser. It needs no outside network
// beyond the npm registry for the install (which prefers the local npm cache).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync,  mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'iiif-viewer');
const argv = process.argv.slice(2);
const args = new Set(argv);
const packIdx = argv.indexOf('--pack-dir');
if (packIdx >= 0 && (!argv[packIdx + 1] || argv[packIdx + 1].startsWith('--'))) {
  console.error('--pack-dir needs a directory');
  process.exit(2);
}
const packDirArg = packIdx >= 0 ? resolve(argv[packIdx + 1]) : null;
const started = Date.now();
const failures = [];

const run = (cmd, argv, cwd, opts = {}) =>
  execFileSync(cmd, argv, { cwd, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, ...opts.env } });
const step = (msg) => console.log(`\n== ${msg}`);
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

// 1. Build and pack. The package is built explicitly and packed with --ignore-scripts, so the tarball is
// exactly the build output of this step. The publish workflow publishes this tarball file, so the lifecycle
// scripts of `npm publish` (prepack, prepublishOnly, ...) do not run on that path. Fail if the package
// defines any that would then be skipped.
step('Build the package');
const manifestPkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
for (const hook of ['prepack', 'prepublishOnly', 'prepare', 'prepublish', 'postpack']) {
  if (manifestPkg.scripts?.[hook] && hook !== 'prepack') {
    console.error(`package.json defines "${hook}", which does not run when a tarball is published: move that work into the build.`);
    process.exit(2);
  }
}
run('npm', ['run', 'build', '-w', 'iiif-kasane'], root);

const work = mkdtempSync(join(tmpdir(), 'kasane-smoke-'));
const packDir = packDirArg ?? work;
mkdirSync(packDir, { recursive: true });
if (packDirArg && readdirSync(packDir).length > 0) {
  console.error(`--pack-dir ${packDir} must be empty, so that only the tested tarball is in it`);
  process.exit(2);
}
try {
step(`Pack into ${packDir}`);
const packOut = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], pkgDir, { quiet: true });
const packed = JSON.parse(packOut)[0];
const tarball = join(packDir, packed.filename);
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
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const locked = (name) => lock.packages[`node_modules/${name}`].version;
const makeConsumer = (name, deps, devDeps, extraNpmArgs = []) => {
  const dir = join(work, name);
  mkdirSync(dir);
  const pin = (names) => Object.fromEntries(names.map((n) => [n, locked(n)]));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `kasane-smoke-${name}`,
      private: true,
      type: 'module',
      dependencies: { 'iiif-kasane': `file:${tarball}`, ...pin(deps) },
      devDependencies: pin(devDeps),
    }),
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', ...extraNpmArgs], dir);
  return dir;
};
// "consumer" has only the required peers. "consumer3d" also has the optional 3D peers that iiif-kasane/scene needs.
const consumer = makeConsumer('consumer', ['react', 'react-dom', 'jotai'], ['typescript', '@types/react', '@types/react-dom']);
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
// Static import/export specifiers, read with TypeScript's scanner so that comments, strings and minified
// syntax (`import{a}from"x"`, `export*from"x"`, `import"x"`) are handled. Dynamic imports (`import("x")`)
// and require() are lazy chunks and are left out on purpose.
const staticImports = (src) =>
  ts
    .preProcessFile(src, true, true)
    .importedFiles.filter((f) => !src.slice(0, f.pos).trimEnd().endsWith('('))
    .map((f) => f.fileName);
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
check(!core.bare.some((s) => THREE.test(s) || /^(react|react-dom|jotai)(\/|$)/.test(s)), `core entry needs no React, jotai or 3D packages (${core.bare.join(', ') || 'none'})`);
const tag = walk(join(installed, 'dist', 'iiif-kasane.js'));
check(tag.bare.length === 0, `tag bundle and its chunks (${tag.files} files) have no bare imports (self-contained) ${tag.bare.join(', ')}`);
check(readFileSync(join(installed, 'dist', 'iiif-viewer.js'), 'utf8').includes('iiif-kasane.js'), 'legacy iiif-viewer.js loads iiif-kasane.js');
check(readFileSync(join(installed, 'dist', 'style.css'), 'utf8').length > 1000, 'style.css is not empty');

// 6. Types resolve for a TypeScript consumer, with skipLibCheck off so that a broken .d.ts is reported.
// All entries are checked in a consumer that has the 3D peers and @types/three: dist/types/core/types/main.d.ts
// imports types from 'three', so a TypeScript consumer without three.js fails with skipLibCheck off (known gap).
step('Types resolve (tsc --noEmit, skipLibCheck off)');
const tsc = (dir, source) => {
  writeFileSync(join(dir, 'check.ts'), source.join('\n'));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ['check.ts'] }),
  );
  try {
    run('node', [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', dir], dir);
    return true;
  } catch {
    return false;
  }
};
const consumer3d = makeConsumer(
  'consumer3d',
  ['react', 'react-dom', 'jotai', 'three', '@react-three/fiber', '@react-three/drei', 'three-stdlib', 'gsap'],
  ['typescript', '@types/react', '@types/react-dom', '@types/three'],
  // The lockfile has three 0.187, which the package's peer range ("^0.178.0 || ^0.186.0") does not list, so npm would refuse.
  ['--legacy-peer-deps'],
);
check(
  tsc(consumer3d, [
    "import { Viewer, type ViewerState } from 'iiif-kasane';",
    "import { fetchManifest, containersOf } from 'iiif-kasane/core';",
    'export const v: typeof Viewer = Viewer;',
    'export const f: typeof fetchManifest = fetchManifest;',
    'export const c: typeof containersOf = containersOf;',
    'export type S = ViewerState;',
  ]),
  'main and core entries type-check against the installed package',
);
// The 3D entry is checked separately only to keep the failure message specific.
check(
  tsc(consumer3d, [
    "import { Scene, type PlacedModel } from 'iiif-kasane/scene';",
    'export const s: typeof Scene = Scene;',
    'export type P = PlacedModel;',
  ]),
  'the scene entry type-checks against the installed package (with the 3D peers)',
);

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

} finally {
  if (!args.has('--keep')) rmSync(work, { recursive: true, force: true });
  else console.log(`\nKept ${work}`);
}
console.log(`\n${failures.length ? `FAILED (${failures.length}):\n - ${failures.join('\n - ')}` : 'All package checks passed'} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failures.length ? 1 : 0);
