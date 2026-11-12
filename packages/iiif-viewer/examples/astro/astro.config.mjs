import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  vite: {
    // This example sits inside the iiif-kasane repository; do not pick up its postcss.config.mjs.
    css: { postcss: {} },
    // In this example the package is linked from ../.. (file:), so its imports could reach the
    // copies of React etc. in the repository's node_modules. Use this project's copies only.
    // Installed from npm, the package needs no such setting.
    resolve: {
      dedupe: ['react', 'react-dom', 'jotai', 'three', '@react-three/fiber', '@react-three/drei', 'three-stdlib', 'gsap'],
    },
  },
});
