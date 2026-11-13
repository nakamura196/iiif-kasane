# Adding features (rules for parallel work)

Add a feature as "one feature, one owner, one set of files". Do not edit the files of other features.

| What you add | Files to write (new) | What to touch in shared files |
| --- | --- | --- |
| A display (paging, composites, etc.) | `src/react/displays/<Name>Display.tsx` (types in `displays/types.ts`) | One line in `displays/registry.ts` (the order of matching matters) |
| A side panel tab | `src/react/panels/<Name>Panel.tsx` (types in `panels/types.ts`; position by `order`) | None |
| An overlay on the image | `src/react/overlays/<Name>Overlay.tsx` (types in `overlays/types.ts`; stacking by `order`) | None |
| Reading data (no React) | `src/core/features/<feature>.ts` and `<feature>.test.ts`, or a folder `<feature>/index.ts` | None |
| UI text | `src/react/messages/features/<feature>.{ja,en}.json` | None |
| An inference model (in-browser OCR, etc.) | `src/react/inference/models/<name>.ts` (types in `models/types.ts`; heavy work in `<name>.run.ts`, loaded by `load()`). Pre- and post-processing without React go in `src/core/features/inference/` | One line in `models/registry.ts` (steps in `docs/adding-inference-model.md`) |

For "None", putting the file in place adds it to the list. `scripts/gen-registries.mjs` writes the lists as `*.generated.ts` (not in git). The dev server, tests and build run it automatically, so you usually do not need to think about it. If your editor says `registry.generated` is missing, run `npm run gen`.

- Inside `core/features/`, helper files used only within one feature start with `_` (they are not added to the list).
- Tab `order` values are spaced by 10 (About 10 … Annotations 90). To place a tab in between, use 15 and so on. Without `order`, a tab goes last.
- The site's allowed `?tab=` values (`src/lib/viewerTabs.ts`) are also built from the tabs, so you do not need to edit them.

Feature areas already set up: `image` (images, deep zoom, overlays), `structure` (paging, table of contents), `temporal` (time ranges, multiple media), `about` (provenance, rights, links), `annotations` (annotations on a Canvas).

## Where to put controls

- **Put advanced controls in a side panel tab by default** (e.g. layer visibility, opacity and order; annotation filters; the table of contents). Do not shrink the image area. With `available`, the tab appears only for Canvases where it applies. The embed (`<iiif-viewer>`) has it in the same place.
- The strip above the image holds only the minimum needed to view that Canvas (choosing a Choice option, paging).
- When the strip and a tab control the same thing, both read and write the same state (`atoms.ts`) so they never disagree (e.g. a Choice option is kept as layer visibility).

## Rules

- Do not edit `core/containers.ts`, `Viewer.tsx`, `ViewerProvider.tsx`, `CanvasView.tsx`, `Info.tsx`, `messages/ja.json` or `messages/en.json`. If something is missing there, ask the maintainer (or fix it first in a separate PR).
- `core` does not depend on React, Next.js or the DOM. Keep tests next to the code.
- The playback position comes from `usePlayback()`; screen state lives in each Viewer's jotai store (`atoms.ts`). Do not create global variables.
- `ViewerProvider` owns loading the manifest, the shown Canvas and the store. `Viewer` is "`ViewerProvider` + the default layout". To read the shown Canvas from a part, use `useViewer()` (or `useOptionalViewer()` for parts that also work outside a Provider).
- Wrap parts rendered outside the viewer (in `document.body`, for example) in an element with `class="iiif-viewer"`. The distributed `style.css` applies the viewer's styles only inside it, so they do not clash with the host page (its `.hidden`, for example).
- Displays and panels take `ContainerInfo` (`core/services/containers.ts`) as input.
