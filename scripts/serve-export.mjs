// Serve the static export (out/) for the browser tests: node scripts/serve-export.mjs [port]
// A tiny stand-in for the web server of the hosting: /ja/viewer/ -> out/ja/viewer/index.html.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const port = Number(process.argv[2] ?? 3862);
const root = resolve('out');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.vtt': 'text/vtt; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function kind(f) {
  try {
    const s = await stat(f);
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

// Returns { file } to send, { redirect } for a directory without the trailing slash, or {} for 404.
async function find(pathname) {
  const base = join(root, normalize(pathname));
  if (base !== root && !base.startsWith(root + sep)) return {};
  const k = await kind(base);
  if (k === 'file') return { file: base };
  if (k === 'dir') {
    if (!pathname.endsWith('/')) return { redirect: true }; // the export uses trailingSlash: true
    if ((await kind(join(base, 'index.html'))) === 'file') return { file: join(base, 'index.html') };
  }
  if ((await kind(`${base}.html`)) === 'file') return { file: `${base}.html` };
  return {};
}

// One range only: bytes=a-b, bytes=a- or bytes=-n. Returns [start, end], null (no usable header) or 'bad'.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] !== '' && m[2] !== '' && Number(m[1]) > Number(m[2])) return null; // invalid: ignore it and send the whole file
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return size === 0 || start >= size ? 'bad' : [start, end];
}

async function send(req, res, file) {
  const { size } = await stat(file);
  const headers = { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
  const range = parseRange(req.headers.range, size);
  if (range === 'bad') {
    res.writeHead(416, { 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  const [start, end] = range ?? [0, size - 1];
  if (range) res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  else res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

createServer(async (req, res) => {
  try {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        // an undecodable path cannot match a file: it falls through to 404
      }
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('bad request');
      return;
    }
    const { pathname: rawPath, search } = new URL(req.url, 'http://localhost');
    const { file, redirect } = await find(pathname);
    if (redirect) {
      res.writeHead(308, { location: `${rawPath}/${search}` }); // still percent-encoded, with the query
      res.end();
      return;
    }
    if (!file) {
      const page = join(root, '404.html');
      const body = (await kind(page)) === 'file' ? await readFile(page) : 'not found';
      res.writeHead(404, { 'content-type': typeof body === 'string' ? 'text/plain' : types['.html'] });
      res.end(body);
      return;
    }
    await send(req, res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal error');
  }
}).listen(port, () => console.log(`serving out/ at http://localhost:${port}`));
