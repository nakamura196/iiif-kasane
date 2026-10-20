# @nakamura196/iiif-viewer

The IIIF viewer of [Kasane](https://github.com/nakamura196/iiif-kasane) as a package:
React components, framework-free manifest reading, and the `<iiif-viewer>` tag.
It reads IIIF Presentation 3 (and 2, upgraded on load): images with deep zoom, layers and Choice,
paging and tables of contents, audio/video with time ranges, annotations, IIIF Auth 2.0, and 3D Scenes.

## Install

```sh
npm install https://github.com/nakamura196/iiif-kasane/releases/download/iiif-viewer-v0.1.1/nakamura196-iiif-viewer-0.1.1.tgz
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

### Following the host page

`target` tells the viewer which Canvas (and region) to show, and `onSelect` reports the shown Canvas.
Use them to keep the viewer in step with something else on the page, such as a transcription
whose page breaks point to Canvases.

```tsx
import { Viewer, type ViewerTarget } from '@nakamura196/iiif-viewer';

const [target, setTarget] = useState<ViewerTarget>({ canvasId: 'https://example.org/canvas/p2' });

<Viewer
  iiifContent={manifestUrl}
  className="h-full"
  // xywh: x, y, width, height in Canvas pixels. highlight: false zooms without drawing a box
  target={{ ...target, xywh: [400, 600, 1200, 800] }}
  onSelect={({ canvasId, index }) => console.log('shown', index, canvasId)}
/>
```

The viewer moves to `target` when the manifest is loaded and whenever `target` points somewhere else
(a new object with the same values does nothing). The reader can still turn the pages in between.
`onSelect` is called for the first Canvas, for each page turn, and after moving to `target`;
while the viewer is on its way to `target`, the Canvas it opens first is not reported.
An unknown `canvasId` is ignored.

## The `<iiif-viewer>` tag

```html
<script type="module" src="https://kasane.ldas.jp/element/v0.1.1/iiif-viewer.js"></script>
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
