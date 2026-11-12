import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import type { AtRule, Node, Plugin, Rule } from 'postcss';
import { generateRegistries } from '../../scripts/gen-registries.mjs';

generateRegistries();

// The viewer's utilities have Tailwind's plain names (.flex, .hidden, .border, ...). A host page may
// use the same names for its own elements, so limit every utility to the inside of the viewer
// (the <iiif-kasane> or <iiif-viewer> tag, or the element with class "iiif-viewer" that ViewerProvider draws).
// :where() adds no specificity, so the utilities keep their weight.
const SCOPE = ':where(.iiif-viewer, .iiif-viewer *, iiif-kasane *, iiif-viewer *)';
const inUtilities = (rule: Rule): boolean => {
  for (let node = rule.parent as Node | undefined; node; node = node.parent as Node | undefined) {
    if (node.type !== 'atrule') continue;
    const at = node as AtRule;
    if (/keyframes$/.test(at.name)) return false;
    if (at.name === 'layer' && at.params === 'utilities') return true;
  }
  return false;
};
const scopeUtilities = (): Plugin => ({
  postcssPlugin: 'iiif-viewer-scope-utilities',
  OnceExit(root) {
    root.walkRules((rule) => {
      if (!inUtilities(rule)) return;
      rule.selectors = rule.selectors.map((s) => (/^[>+~]/.test(s.trim()) ? s : `${SCOPE}${s.trim()}`));
    });
  },
});

// Build of the <iiif-kasane> tag: one ES module (iiif-kasane.js) with React and the
// viewer inside, plus style.css. The 3D part (three.js, react-three-fiber) is a lazy
// import in Viewer.tsx, so it ends up in separate chunks next to iiif-kasane.js and is
// only fetched when a Scene is shown.
// iiif-viewer.js is the file name before 0.3.0. It is kept as a one-line module that loads
// iiif-kasane.js, so that pages that load it by that name keep working.
const legacyEntry = (): import('vite').Plugin => ({
  name: 'iiif-viewer-legacy-entry',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'iiif-viewer.js', source: "import './iiif-kasane.js';\n" });
  },
});
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  define: {
    // Library mode does not replace this; React reads it.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  css: {
    postcss: { plugins: [tailwindcss(), scopeUtilities()] },
  },
  plugins: [legacyEntry()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/element/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'iiif-kasane.js',
      cssFileName: 'style',
    },
    rollupOptions: {
      // 'use client' in the React sources means nothing in a plain browser bundle.
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        defaultHandler(warning);
      },
      output: {
        chunkFileNames: 'iiif-viewer-[name]-[hash].js',
      },
    },
  },
});
