// Public API baseline of the npm package iiif-kasane.
//
//   node scripts/api-surface.mjs           compare the current API with packages/iiif-viewer/api/public-api.txt
//   node scripts/api-surface.mjs --update  rewrite the baseline (npm run api:update)
//
// The API is read from the sources with the TypeScript compiler (same entries and options as the
// declaration build, packages/iiif-viewer/tsconfig.build.json). For every name exported by an entry
// ("." / "./core" / "./scene") the baseline holds its kind and its declaration: interfaces, type aliases and
// enums as written (comments dropped, printed in a fixed format), functions and constants as their
// resolved type. Types the declarations mention are listed under "referenced" (Panel -> PanelContext ...),
// so a change to a contract type shows up even when that type is not exported by name.
// Comments and formatting of the sources do not matter; anything else does: removed names, optional ->
// required, narrowed unions, changed callback signatures. Additions change the baseline too, on purpose.
// Union members are printed sorted (the checker orders them by creation, which is not stable).
// Known limit: classes are listed by member names and types only (the package exports none today).
// Run through npm (`typecheck`, `typecheck:package`, `api:update`): their pre-hooks generate the *.generated.ts
// registries the sources import. Run alone without them, the script stops with the type errors that causes.
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'packages/iiif-viewer');
const baselinePath = path.join(pkg, 'api/public-api.txt');
// Entries come from the "exports" map of package.json: each "types" path (./dist/types/<x>.d.ts) is the
// declaration of src/<x>.ts. A new subpath with "types" is pinned without touching this file.
const exportsMap = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).exports;
const typesPaths = (v) => (typeof v === 'string' ? [] : Object.entries(v).flatMap(([k, x]) => (k === 'types' && typeof x === 'string' ? [x] : typesPaths(x))));
const ENTRIES = Object.entries(exportsMap).flatMap(([sub, v]) =>
  typesPaths(v).map((t) => {
    const m = /^\.\/dist\/types\/(.+)\.d\.ts$/.exec(t);
    const file = m && `src/${m[1]}.ts`;
    if (!file || !fs.existsSync(path.join(pkg, file))) {
      console.error(`exports["${sub}"] has types "${t}", but its source (src/<path>.ts) was not found. Update scripts/api-surface.mjs.`);
      process.exit(1);
    }
    return [sub, file];
  }),
);

const cfg = ts.readConfigFile(path.join(pkg, 'tsconfig.build.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, pkg);
const program = ts.createProgram({
  rootNames: ENTRIES.map(([, f]) => path.join(pkg, f)),
  options: { ...parsed.options, noEmit: true, declaration: false, emitDeclarationOnly: false },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  console.error(
    'The package does not type-check, so its API cannot be read reliably. Fix the errors first.\n' +
      'If *.generated.ts files are missing, run this through npm (`npm run typecheck:package` / `npm run api:update`), which generates them first.',
  );
  process.exit(1);
}
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true });
const rel = (f) => path.relative(root, f);
const isProject = (sf) => sf && !sf.isDeclarationFile && !sf.fileName.includes('node_modules');
const clean = (s) => s.replace(/import\("[^"]*"\)\./g, '');
const scratch = ts.createSourceFile('type.ts', '', ts.ScriptTarget.Latest);
const sortUnions = (ctx) => {
  const visit = (n) => {
    const v = ts.visitEachChild(n, visit, ctx);
    if (!ts.isUnionTypeNode(v)) return v;
    const sorted = [...v.types].sort((x, y) => {
      const a = printer.printNode(ts.EmitHint.Unspecified, x, scratch);
      const b = printer.printNode(ts.EmitHint.Unspecified, y, scratch);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return ctx.factory.updateUnionTypeNode(v, ctx.factory.createNodeArray(sorted));
  };
  return (n) => ts.visitNode(n, visit);
};
// A type as text, with union members sorted so that the text does not depend on the checker's internal order.
const typeStr = (t) => {
  const node = checker.typeToTypeNode(t, undefined, ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope);
  if (!node) return clean(checker.typeToString(t));
  const result = ts.transform(node, [sortUnions]);
  const text = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], scratch);
  result.dispose();
  return clean(text);
};
const resolve = (s) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
const TYPE_DECL = (d) =>
  ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isEnumDeclaration(d);

// Types reachable from the exported declarations, keyed by symbol (merged declarations are printed together).
const referenced = new Map(); // symbol -> declarations
const printedSymbols = new Set(); // exported by name: already printed in the entries
const seenTypes = new Map(); // type -> shallowest depth it was walked at
const projectTypeDecls = (sym) =>
  ((sym && resolve(sym).declarations) || []).filter((d) => isProject(d.getSourceFile()) && TYPE_DECL(d));

function addRefSymbol(sym) {
  if (!sym) return;
  const r = resolve(sym);
  const decls = projectTypeDecls(r);
  if (decls.length === 0 || printedSymbols.has(r) || referenced.has(r)) return;
  referenced.set(r, decls);
  decls.forEach(collectRefs);
}
// Syntactic: names written inside a declaration.
function collectRefs(node) {
  const visit = (n) => {
    if (ts.isIdentifier(n)) addRefSymbol(checker.getSymbolAtLocation(n));
    ts.forEachChild(n, visit);
  };
  visit(node);
}
// Semantic: the types a value's type is made of (parameters, results, members), so that
// `export const f = (p: T) => ...` pins T although nothing in the source names it as an annotation.
const fromProject = (t) => {
  const decls = (t.aliasSymbol ?? t.symbol)?.declarations ?? [];
  return decls.length === 0 || decls.some((d) => isProject(d.getSourceFile()));
};
function collectTypeRefs(t, at, depth = 0) {
  if (!t || depth > 6 || (seenTypes.get(t) ?? Infinity) <= depth) return;
  seenTypes.set(t, depth);
  addRefSymbol(t.aliasSymbol);
  if (t.symbol) addRefSymbol(t.symbol);
  (t.aliasTypeArguments ?? []).forEach((x) => collectTypeRefs(x, at, depth + 1));
  if (t.isUnionOrIntersection()) t.types.forEach((x) => collectTypeRefs(x, at, depth + 1));
  if (checker.isArrayType(t) || checker.isTupleType(t) || (t.flags & ts.TypeFlags.Object && t.objectFlags & ts.ObjectFlags.Reference)) {
    checker.getTypeArguments(t).forEach((x) => collectTypeRefs(x, at, depth + 1));
  }
  if (!fromProject(t)) return;
  for (const sig of [...t.getCallSignatures(), ...t.getConstructSignatures()]) {
    sig.getParameters().forEach((p) => collectTypeRefs(checker.getTypeOfSymbolAtLocation(p, at), at, depth + 1));
    collectTypeRefs(sig.getReturnType(), at, depth + 1);
  }
  // Members of anonymous object types ({ a: T }); named ones are printed whole through their declaration.
  if (t.flags & ts.TypeFlags.Object && !projectTypeDecls(t.aliasSymbol ?? t.symbol).length) {
    t.getProperties().forEach((p) => collectTypeRefs(checker.getTypeOfSymbolAtLocation(p, at), at, depth + 1));
  }
}

function describe(name, sym) {
  const out = [];
  const kinds = [];
  for (const d of sym.declarations ?? []) {
    const sf = d.getSourceFile();
    if (TYPE_DECL(d)) {
      kinds.push(ts.isEnumDeclaration(d) ? 'enum' : 'type');
      out.push(printer.printNode(ts.EmitHint.Unspecified, d, sf).replace(/^export /, ''));
      printedSymbols.add(sym);
      collectRefs(d);
    } else if (ts.isClassDeclaration(d)) {
      kinds.push('class');
      const inst = checker.getDeclaredTypeOfSymbol(sym);
      const members = checker.getPropertiesOfType(inst).map((m) => `  ${m.name}: ${typeStr(checker.getTypeOfSymbolAtLocation(m, d))};`);
      out.push(`class ${name} {\n${members.sort().join('\n')}\n}`);
      collectTypeRefs(inst, d);
    } else {
      kinds.push('value');
      const t = checker.getTypeOfSymbolAtLocation(sym, d);
      out.push(`${name}: ${typeStr(t)}`);
      collectTypeRefs(t, d);
    }
  }
  return `[${[...new Set(kinds)].join('+')}] ${[...new Set(out)].join('\n')}`;
}

const lines = ['// Public API baseline of iiif-kasane. Generated by scripts/api-surface.mjs (npm run api:update). Do not edit by hand.'];
for (const [entry, file] of ENTRIES) {
  const sf = program.getSourceFile(path.join(pkg, file));
  const mod = checker.getSymbolAtLocation(sf);
  lines.push('', `// ===== ${entry} (${file}) =====`);
  for (const sym of checker.getExportsOfModule(mod).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    lines.push(`export ${describe(sym.name, resolve(sym))}`);
  }
}
lines.push('', '// ===== referenced types (not exported by name, reachable from the declarations above) =====');
const refBlocks = [...referenced]
  .filter(([sym]) => !printedSymbols.has(sym))
  .map(([sym, decls]) => [`${rel(decls[0].getSourceFile().fileName)}#${sym.name}`, decls]);
for (const [key, decls] of refBlocks.sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
  lines.push(`// ${key}`);
  for (const d of decls) lines.push(printer.printNode(ts.EmitHint.Unspecified, d, d.getSourceFile()).replace(/^export /, ''));
}
const current = lines.join('\n').replace(/[ \t]+$/gm, '') + '\n';

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, current);
  console.log(`Wrote ${rel(baselinePath)} (${current.split('\n').length} lines).`);
} else {
  if (!fs.existsSync(baselinePath)) {
    console.error(`The baseline ${rel(baselinePath)} is missing. Create it with \`npm run api:update\` and commit it.`);
    process.exit(1);
  }
  const base = fs.readFileSync(baselinePath, 'utf8').replace(/\r\n/g, '\n');
  if (base === current) {
    console.log('Public API matches the baseline.');
  } else {
    const d = spawnSync('diff', ['-u', '--label', 'baseline', '--label', 'current', baselinePath, '-'], { input: current, encoding: 'utf8' });
    console.error(d.stdout);
    console.error(
      'The public API of iiif-kasane differs from packages/iiif-viewer/api/public-api.txt.\n' +
        'If the change is intended, update the baseline with `npm run api:update` and commit it.\n' +
        'Removals, renames and narrowing (optional -> required, a smaller union) need the maintainer\'s OK.',
    );
    process.exit(1);
  }
}
