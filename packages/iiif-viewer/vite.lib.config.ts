import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { generateRegistries } from '../../scripts/gen-registries.mjs';
import pkg from './package.json' with { type: 'json' };

generateRegistries();

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Dependencies stay as imports (the app that installs the package provides them),
// including subpaths such as 'react/jsx-runtime' or 'three/examples/...'.
const deps = [...Object.keys(pkg.peerDependencies), ...Object.keys(pkg.dependencies)];
const external = (id: string) => deps.some((d) => id === d || id.startsWith(`${d}/`));

// Build of the npm entries ('.' and './core'): one file per source module, so that an app
// only loads what it uses (three.js is fetched only when a 3D Scene is shown).
// Types come from tsc (tsconfig.build.json). The <iiif-viewer> tag is vite.config.ts.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // The worker URL is made relative to the importing file (new URL(..., import.meta.url)).
  base: './',
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js' } },
  },
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    target: 'es2020',
    minify: false,
    lib: {
      entry: {
        index: src('react/index.ts'),
        core: src('core/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external,
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        defaultHandler(warning);
      },
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
        // The React parts use hooks; mark them for React Server Components (Next.js App Router).
        // core stays usable on the server.
        banner: (chunk) => (chunk.facadeModuleId?.includes('/src/react/') ? "'use client';" : ''),
      },
    },
  },
});
