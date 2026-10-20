import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { generateRegistries } from './scripts/gen-registries.mjs';

generateRegistries();

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'packages/*/src/**/*.test.ts',
    ],
  },
  resolve: {
    // The site reads the viewer package from its sources (same as tsconfig.json paths),
    // not from the built dist/ that npm users get.
    alias: [
      { find: /^@nakamura196\/iiif-viewer$/, replacement: path.resolve(__dirname, './packages/iiif-viewer/src/react/index.ts') },
      { find: /^@nakamura196\/iiif-viewer\/core$/, replacement: path.resolve(__dirname, './packages/iiif-viewer/src/core/index.ts') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
