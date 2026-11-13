// Guards the public contract of the npm package `iiif-kasane` (project rule: the public API only grows;
// removals and renames need the maintainer's OK).
// Pinned here: the tag's attributes and `options` keys, the package.json `exports` map, and the URL
// parameters of the site. The exported names and types are pinned by the baseline
// packages/iiif-viewer/api/public-api.txt (scripts/api-surface.mjs; `npm run typecheck` compares, `npm run
// api:update` rewrites it).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(repo, file), 'utf8');
// Drop // and /* */ comments so a commented-out line does not count. (A "//" right after ":" is kept: URLs.)
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const quoted = (s: string) => [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
const sorted = (a: string[]) => a.slice().sort();

// The element module needs a browser (HTMLElement, customElements, a CSS import), which the unit tests do
// not have, so its source text is read instead.
describe('<iiif-kasane> tag', () => {
  const element = code('packages/iiif-viewer/src/element/index.ts');

  it('observes the documented attributes', () => {
    const m = /observedAttributes\s*=\s*\[([^\]]*)\]/.exec(element);
    expect(m, 'observedAttributes not found in element/index.ts').not.toBeNull();
    expect(sorted(quoted(m![1])), 'Attributes changed. Removing one needs the maintainer; add a new one here on purpose').toEqual([
      'iiif-content',
      'locale',
      'options',
      'theme',
    ]);
  });

  it('reads these keys of the options attribute', () => {
    const m = /const\s*\{([^}]*)\}\s*=\s*json\s+as/.exec(element);
    expect(m, 'the destructuring of the parsed options JSON was not found in parseOptions').not.toBeNull();
    const keys = m![1].split(',').map((k) => k.trim().split(':')[0].trim()).filter(Boolean);
    expect(sorted(keys), 'Keys of the options attribute changed').toEqual(['environment', 'pager', 'panelOpen', 'tab']);
  });

  it('defines both tag names (<iiif-viewer> is the pre-0.3.0 name and stays)', () => {
    for (const tag of ['iiif-kasane', 'iiif-viewer']) {
      expect(element, `<${tag}> is no longer defined`).toMatch(new RegExp(`customElements\\s*\\.\\s*define\\(\\s*['"]${tag}['"]`));
    }
  });
});

describe('package.json exports', () => {
  it('keeps every subpath and its target', () => {
    const { exports } = JSON.parse(read('packages/iiif-viewer/package.json'));
    expect(exports, 'The exports map changed. Removing or retargeting a subpath needs the maintainer').toEqual({
      '.': { types: './dist/types/react/index.d.ts', default: './dist/lib/index.js' },
      './core': { types: './dist/types/core/index.d.ts', default: './dist/lib/core.js' },
      './scene': { types: './dist/types/react/scene.d.ts', default: './dist/lib/scene.js' },
      './element': './dist/iiif-kasane.js',
      './style.css': './dist/style.css',
      './package.json': './package.json',
    });
  });
});

// URL parameters of the site. They are read in several places, not through one table, so they cannot be
// listed at runtime. Each file below must still contain a read of each name: `.get('x')`, `.getAll('x')`,
// `.has('x')`, or num(params, 'x') in georefView. Known limit: a name that is also read with `.has`
// elsewhere in the same file (puzzle, grid, b) is not caught if only its `.get` goes. A parameter moved to
// another file: update the file here.
const PARAMS: Record<string, string[]> = {
  'packages/iiif-viewer/src/core/contentState.ts': ['iiif-content', 'manifest', 'curation'],
  'packages/iiif-viewer/src/react/ContainerList.tsx': ['canvas', 'pos'],
  'packages/iiif-viewer/src/core/georefView.ts': [
    'u', 'mapZoom', 'mapLat', 'mapLng', 'lat', 'lng', 'zoom', 'centerX', 'centerY', 'rotation',
    'autoRotateOnSelect', 'clustering', 'annotations', 'license', 'search', 'id', 'canvas',
  ],
  'src/components/page/ViewerContent.tsx': ['tab', 'puzzle', 'grid'],
  'src/lib/puzzleLink.ts': ['puzzle', 'grid'],
  'src/components/page/CompareContent.tsx': ['a', 'b', 'mode', 'opacity', 'blend', 'align', 'aligned', 'dir', 'canvas', 'zoom', 'src'],
  'src/lib/browse.ts': ['u', 'group', 'layout', 'limit', 'lock'],
  'src/components/search/useSearchState.ts': ['u', 'collection', 'curation', 'iiif-content', 'q', 'f'],
};

describe('site URL parameters', () => {
  for (const [file, names] of Object.entries(PARAMS)) {
    it(`${file} still reads ${names.join(', ')}`, () => {
      const source = code(file);
      const reads = (n: string) =>
        new RegExp(`\\.(get|getAll|has)\\(\\s*['"]${n}['"]\\s*\\)|\\bnum\\(\\s*params\\s*,\\s*['"]${n}['"]`).test(source);
      const missing = names.filter((n) => !reads(n));
      expect(missing, `No longer read in ${file}: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
