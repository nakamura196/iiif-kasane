// Serve the static export (out/) for the browser tests: node scripts/serve-export.mjs [port]
// A tiny stand-in for the web server of the hosting: /ja/viewer/ -> out/ja/viewer/index.html.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 3862);
const root = resolve('out');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

async function find(pathname) {
  const base = join(root, normalize(pathname));
  if (!base.startsWith(root)) return null;
  for (const f of [base, join(base, 'index.html'), `${base}.html`]) {
    try {
      if ((await stat(f)).isFile()) return f;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const file = await find(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`serving out/ at http://localhost:${port}`));
