# @nakamura196/iiif-viewer

The IIIF viewer of [Kasane](https://github.com/nakamura196/iiif-kasane) as a package:
React components, framework-free manifest reading, and the `<iiif-viewer>` tag.
It reads IIIF Presentation 3 (and 2, upgraded on load): images with deep zoom, layers and Choice,
paging and tables of contents, audio/video with time ranges, annotations, IIIF Auth 2.0, and 3D Scenes.

## Install

```sh
npm install https://github.com/nakamura196/iiif-kasane/releases/download/iiif-viewer-v0.1.0/nakamura196-iiif-viewer-0.1.0.tgz
npm install react react-dom jotai three three-stdlib @react-three/fiber @react-three/drei gsap
```

The package is not on the npm registry yet; each version is attached to a GitHub Release
(tags `iiif-viewer-v<version>`). The lockfile keeps the tarball's integrity hash.

three.js and react-three-fiber are for 3D Scenes. They have to be installed even if you only show images,
because your bundler resolves them, but the browser fetches them only when a Scene is shown.

## Entries

| Import | What it is |
| --- | --- |
| `@nakamura196/iiif-viewer` | React components (`Viewer`, `ImageCompareView`, `GeoImageView`, the 3D `Scene`, …) and their state (jotai atoms) |
| `@nakamura196/iiif-viewer/core` | Manifest reading without React or the DOM (`fetchManifest`, `containersOf`, Content State, …). Works on the server |
| `@nakamura196/iiif-viewer/style.css` | Styles of the components (Tailwind utilities, without a global reset) |
| `@nakamura196/iiif-viewer/element` | The `<iiif-viewer>` tag, with React inside |

## React

```tsx
import { Viewer } from '@nakamura196/iiif-viewer';
import '@nakamura196/iiif-viewer/style.css';

export default function Page() {
  return (
    <div style={{ height: '36rem' }}>
      <Viewer iiifContent="https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json" locale="en" className="h-full" />
    </div>
  );
}
```

The viewer fills its parent: give the parent a height and pass `className="h-full"`.
`iiifContent` is a Manifest URL or a IIIF Content State. `locale` is `ja` (default) or `en`,
`theme` is `light`, `dark` or `auto`. The React files are marked `'use client'`, so they can be
imported from Next.js server components.

## The `<iiif-viewer>` tag

```html
<script type="module" src="https://kasane.ldas.jp/element/v0.1.0/iiif-viewer.js"></script>
<iiif-viewer iiif-content="https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json" locale="en"></iiif-viewer>
```

It loads `style.css` from the same directory. Give the tag a height with CSS or `--iiif-viewer-height`,
and change colors with the `--iiif-viewer-*` variables (see `dist/style.css`).
Each version stays at `https://kasane.ldas.jp/element/v<version>/`.

## Development

The sources are in `src/`; the Kasane site uses them directly. `npm run build` (in this folder)
writes `dist/`: the tag (`dist/iiif-viewer.js`), the npm entries (`dist/lib`) and their types (`dist/types`).
How to add a feature: [EXTENDING.md](./EXTENDING.md) (Japanese).

## License

MIT
