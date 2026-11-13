// Guards the public contract of the npm package `iiif-kasane` (project rule: the public API only grows;
// removals and renames need the maintainer's OK).
// Pinned here: the tag's attributes and `options` keys, the package.json `exports` map, and the URL
// parameters of the site. The exported names and types are pinned by the baseline
// packages/iiif-viewer/api/public-api.txt (scripts/api-surface.mjs; `npm run typecheck` compares, `npm run
// api:update` rewrites it).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const repo = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(repo, file), 'utf8');
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
// Walk the syntax tree (not the text): comments and string contents such as 'image/*' do not confuse it.
const walk = (node: ts.Node, fn: (n: ts.Node) => void) => {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
};
const str = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : undefined);
const sorted = (a: string[]) => a.slice().sort();

// The element module needs a browser (HTMLElement, customElements, a CSS import), which the unit tests do
// not have, so its syntax tree is read instead.
describe('<iiif-kasane> tag', () => {
  const element = parse('packages/iiif-viewer/src/element/index.ts');

  it('observes the documented attributes', () => {
    let observed: string[] | undefined;
    walk(element, (n) => {
      if (ts.isPropertyDeclaration(n) && n.name.getText() === 'observedAttributes' && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
        observed = n.initializer.elements.map((e) => str(e) ?? '?');
      }
    });
    expect(observed, 'observedAttributes not found in element/index.ts').toBeDefined();
    expect(sorted(observed!), 'Attributes changed. Removing one needs the maintainer; add a new one here on purpose').toEqual([
      'iiif-content',
      'locale',
      'options',
      'theme',
    ]);
  });

  it('reads these keys of the options attribute, and passes them to the viewer', () => {
    // keys parseOptions takes out of the JSON
    const parsedKeys: string[] = [];
    // keys the element uses from parseOptions(...) results (these are what reach <Viewer>)
    const usedKeys = new Set<string>();
    walk(element, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && ts.isAsExpression(n.initializer)) {
        n.name.elements.forEach((e) => parsedKeys.push(e.propertyName?.getText() ?? e.name.getText()));
      }
      if (ts.isPropertyAccessExpression(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText() === 'parseOptions') {
        usedKeys.add(n.name.text);
      }
    });
    const expected = ['environment', 'pager', 'panelOpen', 'tab'];
    expect(sorted(parsedKeys), 'Keys parsed from the options attribute changed').toEqual(expected);
    expect(sorted([...usedKeys]), 'Keys of the options attribute no longer all reach the viewer').toEqual(expected);
  });

  it('defines both tag names (<iiif-viewer> is the pre-0.3.0 name and stays)', () => {
    const defined: string[] = [];
    walk(element, (n) => {
      if (ts.isCallExpression(n) && n.expression.getText() === 'customElements.define') defined.push(str(n.arguments[0]) ?? '?');
    });
    for (const tag of ['iiif-kasane', 'iiif-viewer']) expect(defined, `<${tag}> is no longer defined`).toContain(tag);
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
      const read = new Set<string>();
      walk(parse(file), (n) => {
        if (!ts.isCallExpression(n)) return;
        const f = n.expression;
        if (ts.isPropertyAccessExpression(f) && ['get', 'getAll', 'has'].includes(f.name.text)) {
          const v = str(n.arguments[0]);
          if (v) read.add(v);
        } else if (ts.isIdentifier(f) && f.text === 'num') {
          const v = str(n.arguments[1]);
          if (v) read.add(v);
        }
      });
      const missing = names.filter((n) => !read.has(n));
      expect(missing, `No longer read in ${file}: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
