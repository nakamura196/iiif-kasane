// Copies the built <iiif-kasane> tag (../../dist, made by `npm run build` in packages/iiif-viewer)
// to public/iiif-viewer/, so that the tag page can load it as a plain script.
// On a real site, use the published copy instead:
//   <script type="module" src="https://kasane.ldas.jp/element/v<version>/iiif-kasane.js"></script>
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../dist/', import.meta.url));
const to = fileURLToPath(new URL('../public/iiif-viewer/', import.meta.url));
if (!existsSync(`${from}iiif-kasane.js`)) {
  console.error('Build the package first: (cd ../.. && npm run build)');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
// The tag and its chunks, style.css and assets; not the npm entries (lib, types).
for (const name of readdirSync(from)) {
  if (name === 'lib' || name === 'types') continue;
  cpSync(`${from}${name}`, `${to}${name}`, { recursive: true });
}
console.log('copied the <iiif-kasane> tag to public/iiif-viewer/');
