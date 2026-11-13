// Guards the public API of the npm package `iiif-kasane`.
// Project rule: the public API only grows. A removal or rename needs the maintainer's OK.
// Four things are pinned:
//   1. runtime export names of "." / "./core" / "./scene" (list in publicApi.exports.json)
//   2. keys of the exported types that host pages build on (checked by tsc, see below)
//   3. the <iiif-kasane> tag: observed attributes and both tag names
//   4. the URL parameters the site's viewer page reads
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as main from './react/index';
import * as core from './core/index';
import * as scene from './react/scene';
import type { DisplayProps, PanelContext, ViewerActionsState, ViewerProps, ViewerProviderProps, ViewerState, ViewerTarget } from './react/index';
import expected from './publicApi.exports.json';

const entries = { main, core, scene } as const;
const HOW_TO_ADD = 'To add a name on purpose, add it to packages/iiif-viewer/src/publicApi.exports.json (keep the list sorted).';

describe('runtime exports', () => {
  for (const [entry, mod] of Object.entries(entries)) {
    const want: string[] = expected[entry as keyof typeof expected];
    const have = Object.keys(mod).sort();

    it(`${entry}: nothing the package exported is gone`, () => {
      const removed = want.filter((n) => !have.includes(n));
      expect(removed, `Removed or renamed from the public API (needs the maintainer's OK): ${removed.join(', ')}`).toEqual([]);
    });

    it(`${entry}: new exports are added to the list on purpose`, () => {
      const added = have.filter((n) => !want.includes(n));
      expect(added, `New public exports not in the list: ${added.join(', ')}. ${HOW_TO_ADD}`).toEqual([]);
    });
  }
});

// Type shapes. These are checked by `tsc --noEmit` (CI runs it; vitest only runs the file):
// naming a key that no longer exists is a compile error. Types may gain keys, so only presence is pinned.
const hasKeys =
  <T>() =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  <K extends keyof T>(..._keys: K[]): void => {};

describe('exported type keys (compile-time)', () => {
  it('ViewerState, ViewerProps, ViewerProviderProps, ViewerActionsState, DisplayProps, PanelContext, ViewerTarget', () => {
    hasKeys<ViewerState>()('iiifContent', 'shownUrl', 'manifest', 'failed', 'containers', 'selectedIndex', 'container', 'select', 'resolvedTheme');
    hasKeys<ViewerProps>()(
      'iiifContent', 'locale', 'theme', 'tab', 'onTabChange', 'renderActions', 'panels', 'hidePanels',
      'target', 'onSelect', 'panelOpen', 'pager', 'environment', 'className',
    );
    hasKeys<ViewerProviderProps>()('iiifContent', 'locale', 'theme', 'target', 'onSelect', 'environment', 'className', 'children');
    hasKeys<ViewerActionsState>()('iiifContent', 'shownUrl', 'hasChoices', 'selectedIndex');
    hasKeys<DisplayProps>()('container', 'manifest', 'iiifContent', 'shownUrl', 'containers', 'selectedIndex', 'select', 'renderActions');
    hasKeys<PanelContext>()(
      'container', 'manifest', 'annotationCount', 'localAnnotationCount', 'shown', 'containerLocalAnnotationCount',
    );
    hasKeys<ViewerTarget>()('canvasId', 'xywh', 'highlight', 't', 'play');
  });
});

// The element module needs a browser (HTMLElement, customElements, a stylesheet import), which the unit
// tests do not have, so its source text is read instead.
describe('<iiif-kasane> tag', () => {
  const element = readFileSync(resolve(__dirname, 'element/index.ts'), 'utf8');

  it('observes the documented attributes', () => {
    const m = /static observedAttributes = \[([^\]]*)\]/.exec(element);
    expect(m, 'observedAttributes not found in element/index.ts').not.toBeNull();
    const observed = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const removed = ['iiif-content', 'locale', 'theme', 'options'].filter((a) => !observed.includes(a));
    expect(removed, `Attributes no longer observed: ${removed.join(', ')}`).toEqual([]);
    expect(observed.slice().sort(), 'A new attribute: add it here on purpose').toEqual(['iiif-content', 'locale', 'options', 'theme']);
  });

  it('defines both tag names (<iiif-viewer> is the pre-0.3.0 name and stays)', () => {
    for (const tag of ['iiif-kasane', 'iiif-viewer']) {
      expect(element, `<${tag}> is no longer defined`).toMatch(new RegExp(`customElements\\.define\\('${tag}'`));
    }
  });
});

// URL parameters of the site. They are read in several places (search state, core helpers, the viewer
// page), not through one table, so they cannot be listed at runtime. Instead each file below must still
// contain a read of each parameter (`.get('name')` / `.has('name')`). Removing the support makes the read
// disappear from the source and fails here. A parameter moved to another file: update the file here.
const PARAMS: Record<string, string[]> = {
  'packages/iiif-viewer/src/core/contentState.ts': ['iiif-content', 'manifest', 'curation'],
  'packages/iiif-viewer/src/react/ContainerList.tsx': ['canvas', 'pos'],
  'src/components/page/ViewerContent.tsx': ['tab', 'puzzle', 'grid'],
  'src/components/search/useSearchState.ts': ['u', 'collection', 'q'],
};

describe('site URL parameters', () => {
  for (const [file, names] of Object.entries(PARAMS)) {
    it(`${file} still reads ${names.join(', ')}`, () => {
      const source = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
      const missing = names.filter((n) => !new RegExp(`\\.(get|has)\\(\\s*'${n}'\\s*\\)`).test(source));
      expect(missing, `No longer read in ${file}: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
