# iiif-kasane

The IIIF viewer of [Kasane](https://github.com/nakamura196/iiif-kasane) as a package:
React components, framework-free manifest reading, and the `<iiif-kasane>` tag.
It reads IIIF Presentation 3 (and 2, upgraded on load): images with deep zoom, layers and Choice,
paging and tables of contents, audio/video with time ranges, annotations, IIIF Auth 2.0, and 3D Scenes.

## Install

```sh
npm install iiif-kasane
npm install react react-dom jotai
# only for 3D Scenes (see below)
npm install three three-stdlib @react-three/fiber @react-three/drei gsap
```

Versions up to 0.1.6 were named `@nakamura196/iiif-viewer` and were attached to GitHub Releases
(tags `iiif-viewer-v<version>`) instead of the npm registry. From 0.2.0 the package is `iiif-kasane` on npm;
change your imports from `@nakamura196/iiif-viewer` to `iiif-kasane`. Nothing else changed.

### 3D Scenes

The 3D display is a separate entry, so that a site that shows only images or audio/video does not
install three.js and the other 3D packages. To show IIIF Scenes, install them and add one line:

```tsx
import 'iiif-kasane/scene';
```

The import registers the 3D display for `Viewer` and `CanvasView`. The browser still fetches
three.js only when a Scene is shown. Without the import, a Scene shows a short notice instead.
The `<iiif-kasane>` tag includes the 3D display.

Up to 0.3.0, the main entry needed the 3D packages, and `CanvasComponent`, `Scene` and
`SceneEnvironment` were exported from `iiif-kasane`. From 0.4.0 they are exported from
`iiif-kasane/scene`.

## Entries

| Import | What it is |
| --- | --- |
| `iiif-kasane` | React components (`Viewer`, `ImageCompareView`, `GeoImageView`, …) and their state (jotai atoms) |
| `iiif-kasane/scene` | The 3D display (`Scene`, `CanvasComponent`, `SceneEnvironment`). Importing it lets `Viewer` show 3D Scenes. Needs three.js and the other 3D packages |
| `iiif-kasane/core` | Manifest reading without React or the DOM (`fetchManifest`, `containersOf`, Content State, …). Works on the server |
| `iiif-kasane/style.css` | Styles of the components (Tailwind utilities, without a global reset) |
| `iiif-kasane/element` | The `<iiif-kasane>` tag, with React inside |

## React

```tsx
import { Viewer } from 'iiif-kasane';
import 'iiif-kasane/style.css';

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
import { Viewer, type ViewerTarget } from 'iiif-kasane';

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

For audio and video, `t` (seconds) moves the player to that time, and `play: true` starts it.
Without `canvasId`, the time applies to the Canvas that is shown, without turning the page:

```tsx
// e.g. a search hit that links to a time in the recording
<Viewer iiifContent={manifestUrl} target={{ t: 60, play: true }} className="h-full" />
```

### Deep links into a Collection

A manifest opened from a Collection can have its own address. Pass the Collections walked through to reach it
as `collection` (top first), and the viewer shows the manifest, with the Back button leading through them:

```tsx
<Viewer iiifContent={manifestUrl} collection={[topUrl, subUrl]} onShownChange={...} />
```

`onShownChange({ url, collections, origin })` is called each time a manifest (or Collection) is shown.
`collections` is the way taken, in the form `collection` takes (the Collections after the last Manifest on the way: a Manifest, e.g. one opened from the map panel, never appears in it); `origin` is `'content'` (the `iiifContent`
was read), `'move'` (the reader opened an entry) or `'back'`. To write the location into your own URL, do
so for `'move'` and `'back'` only, and give the new `iiifContent` + `collection` back to the viewer: when they
are what is shown already, the viewer reads nothing again and keeps the page the reader is on. A Collection
that cannot be read is left out of the trail.
On the tag, use `collection="<url> <url>"` (separated by spaces; or a JSON array of strings, `collection='["<url>","<url>"]'`, when a value has a space in it) and listen for the `kasane-shown` event
(`event.detail` is the same object). The Kasane site writes `?iiif-content=<manifest>&collection=<top>&collection=<sub>`.

### Starting with the side panel closed

The side panel (metadata, annotations, …) takes about a third of the width. Pass `panelOpen={false}`
to start with it closed, for example when the viewer is one pane among others. The reader can still
open it. Without `panelOpen`, the viewer uses the reader's last choice, or opens it on wide screens.
On the tag, use `options='{"panelOpen":false}'`.

### Hiding the page buttons

A host page that turns the pages itself (through `target`) can pass `pager={false}` to hide the
previous / next buttons above the image, so that the reader does not see two sets. The arrow keys
still turn the pages, and `onSelect` still reports them. On the tag, use `options='{"pager":false}'`.

### Lighting of the 3D view

The 3D view lights models with an environment map. By default (`"built-in"`) the viewer draws a
small studio-like one itself, so it makes **no network request** and works under a strict
Content-Security-Policy. Pass `environment` to change it (on the tag, `options='{"environment":"none"}'`):

| Value | Lighting | Network |
|---|---|---|
| `"built-in"` (default) | soft panels drawn inside the viewer | none |
| `"none"` | plain lights only | none |
| `"city"`, `"studio"`, ... (drei presets) | photographed environments | fetched from raw.githack.com |
| any other string, e.g. `"/assets/studio.hdr"` | your own `.hdr` / `.exr` file | that URL |

If a preset or file cannot be loaded (blocked by the CSP, 404), the view falls back to `"none"`
and keeps showing the model.

### Hiding a side panel tab

Pass `hidePanels` with tab ids (e.g. `hidePanels={['puzzle']}`) to leave out some of the viewer's
own tabs. A host page can then put the same controls in a tab of its own: `Puzzle` is the puzzle's
start controls, and `canPlayPuzzle` says whether the shown Canvas has an image for it.

### Your own layout: `ViewerProvider` and the parts

`Viewer` is `ViewerProvider` with a default layout. To lay the parts out yourself, use the provider
and put the parts inside it. They share one state: the loaded manifest, the shown Canvas, the
selected annotation.

```tsx
import { ViewerProvider, CanvasView, AnnotationList, Metadata, useViewer } from 'iiif-kasane';
import 'iiif-kasane/style.css';

<ViewerProvider iiifContent={manifestUrl} locale="en" className="my-layout" onSelect={(s) => console.log(s)}>
  <CanvasView className="my-view" />   {/* the page buttons and the image / 3D / A/V display */}
  <AnnotationList />
  <Metadata />                          {/* follows the shown Canvas */}
</ViewerProvider>
```

- The provider draws one `<div class="iiif-viewer">` around its children; `className` makes it the
  container of your layout. Write the layout with your own CSS: `style.css` holds only the classes
  the viewer's parts use.
- It takes the same `iiifContent`, `locale`, `theme`, `target`, `onSelect` and `environment` as `Viewer`.
- `useViewer()` gives your own components the state (`manifest`, `containers`, `container`,
  `selectedIndex`, `select(index)`, and `shownUrl`). It throws outside a provider; `useOptionalViewer()` returns null there.
- `shownUrl` is the URL of the manifest shown now. It is the same as `iiifContent` until the reader
  opens an entry of a Collection; then it is that entry's URL. Use it for links to what the reader sees.
  `iiifContent` keeps the URL you passed in. Custom displays get both as `DisplayProps.iiifContent`
  and `DisplayProps.shownUrl`.
- Each provider has its own state, so several on one page do not interfere.

### Styles and the host page

The viewer sits in the page's own DOM (no shadow root), so that the page can set the
`--iiif-viewer-*` variables. `style.css` is built so that the two sides interfere as little as possible:

- No global reset (Tailwind's preflight is left out).
- The viewer's classes (`.flex`, `.hidden`, `.border`, …) apply only inside the viewer: inside
  `<iiif-kasane>` or the provider's `.iiif-viewer` element. A page's own `.hidden` is not touched.
- The dark theme follows the viewer's `theme`, not a `.dark` class the page has on `<html>`.
- Everything is in CSS layers, so the page's own rules win when both set the same thing.

What remains: the page's rules for plain elements (for example Bootstrap's `h3 { font-size }` or
`button` styles) also reach the elements inside the viewer, as they would for any light-DOM component.

### Examples

- [`examples/astro/`](./examples/astro/): an Astro site with the tag, and with the React parts in a
  layout of its own (a React island).
- [`examples/vanilla.html`](./examples/vanilla.html): the tag with plain JavaScript (switching
  manifests, theme and colors, adding viewers).
- [`examples/element.html`](./examples/element.html): two tags on a plain page.

## The `<iiif-kasane>` tag

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/iiif-kasane@0.3.0/dist/iiif-kasane.js"></script>
<iiif-kasane iiif-content="https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json" locale="en"></iiif-kasane>
```

It loads `style.css` from the same directory. Give the tag a height with CSS or `--iiif-viewer-height`,
and change colors with the `--iiif-viewer-*` variables (see `dist/style.css`).
The same files are also on the Kasane site, one folder per version:
`https://kasane.ldas.jp/element/v<version>/iiif-kasane.js`. Each version stays there.

Before 0.3.0 the tag was `<iiif-viewer>` and the file was `iiif-viewer.js`. Both still work, so pages
that already embed the viewer need no change. New pages should use `<iiif-kasane>`: a tag name can be
defined only once on a page, and a generic name such as `iiif-viewer` may also be used by another library.

## Development

The sources are in `src/`; the Kasane site uses them directly. `npm run build` (in this folder)
writes `dist/`: the tag (`dist/iiif-kasane.js`, and `dist/iiif-viewer.js` under its old name), the npm entries (`dist/lib`) and their types (`dist/types`).
How to add a feature: [EXTENDING.md](./EXTENDING.md) (Japanese).

## License

MIT
