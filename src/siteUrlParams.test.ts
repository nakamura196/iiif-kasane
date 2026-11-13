// URL parameters of the site's own pages. Kept outside packages/iiif-viewer because the publish workflow runs
// only that folder, and these files are not part of the package.
// They are read in several places, not through one table, so they cannot be listed at runtime. Each file must
// still contain a read of each name: `.get('x')`, `.getAll('x')` or `.has('x')` on a receiver whose name
// contains "params" (params, searchParams, new URLSearchParams(...)). Known limit: a name also read with
// `.has` elsewhere in the same file (puzzle, grid, b) is not caught if only its `.get` goes. A parameter
// moved to another file: update the file here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const repo = resolve(__dirname, '..');
const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(resolve(repo, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const walk = (node: ts.Node, fn: (n: ts.Node) => void) => {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
};

const PARAMS: Record<string, string[]> = {
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
        if (ts.isPropertyAccessExpression(f) && ['get', 'getAll', 'has'].includes(f.name.text) && /params/i.test(f.expression.getText())) {
          const v = ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : undefined;
          if (v) read.add(v);
        }
      });
      const missing = names.filter((n) => !read.has(n));
      expect(missing, `No longer read in ${file}: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
