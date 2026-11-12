# iiif-kasane in Astro

Two pages:

- `/tag`: the `<iiif-viewer>` tag. No framework: a plain script and an HTML element, changed from a few
  lines of JavaScript.
- `/parts`: `ViewerProvider` with `CanvasView`, `AnnotationList` and `Metadata` in a CSS grid of the
  page, as a React island (`client:only="react"`). See `src/components/FreeLayout.tsx`.

## Run

```sh
(cd ../.. && npm run build)   # builds the package into packages/iiif-viewer/dist
npm ci
npm run dev                   # http://localhost:4330
```

This example uses the package from this repository (`"file:../.."` in `package.json`), so it also
needs two settings in `astro.config.mjs` that a site installing the package from npm does not:
`resolve.dedupe` and `css.postcss`.

In your own site:

- Install `iiif-kasane` and its peer dependencies (`react`, `react-dom`, `jotai`, `three`,
  `@react-three/fiber`, `@react-three/drei`, `three-stdlib`, `gsap`) for the React parts, with `@astrojs/react`.
- For the tag alone, nothing needs installing: load
  `https://kasane.ldas.jp/element/v<version>/iiif-viewer.js` with `<script is:inline type="module">`.
  Do not bundle the tag's module: it loads `style.css` from its own directory.
