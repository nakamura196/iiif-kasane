import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';

// The <iiif-kasane> tag bundle as shipped in the npm package (dist/iiif-kasane.js from the installed tarball).
// A local server (any free port) stands in for a user's website: the page, the bundle, a manifest and an image.
// Nothing is read from the outside network.
// The server listens on port 0 (any free port) so that a busy port cannot fail the test.
const PKG = process.env.SMOKE_PKG_DIR;

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), data.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height, 0xcc);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

let origin = '';
const manifest = () => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${origin}/manifest.json`,
  type: 'Manifest',
  label: { en: ['Smoke test manifest'] },
  items: [
    {
      id: `${origin}/canvas/1`,
      type: 'Canvas',
      width: 800,
      height: 600,
      items: [
        {
          id: `${origin}/canvas/1/page`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${origin}/canvas/1/page/image`,
              type: 'Annotation',
              motivation: 'painting',
              body: { id: `${origin}/image.png`, type: 'Image', format: 'image/png', width: 800, height: 600 },
              target: `${origin}/canvas/1`,
            },
          ],
        },
      ],
    },
  ],
});

const pageHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>iiif-kasane{display:block;height:480px}</style></head><body>
<iiif-kasane iiif-content="${origin}/manifest.json" locale="en" theme="light"></iiif-kasane>
<script type="module" src="/dist/iiif-kasane.js"></script></body></html>`;

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.html': 'text/html',
};

let server: Server;
test.beforeAll(async () => {
  test.skip(!PKG, 'SMOKE_PKG_DIR is not set (run through scripts/smoke-package.mjs)');
  const image = png(800, 600);
  server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const send = (type: string, body: string | Buffer) => {
      res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' });
      res.end(body);
    };
    if (url === '/') return send('text/html', pageHtml());
    if (url === '/manifest.json') return send('application/json', JSON.stringify(manifest()));
    if (url === '/image.png') return send('image/png', image);
    const type = MIME[extname(url)];
    if (url.startsWith('/dist/') && !url.includes('..') && type) {
      try {
        return send(type, readFileSync(join(PKG!, url)));
      } catch {
        /* falls through to 404 */
      }
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, () => {
      origin = `http://localhost:${(server.address() as AddressInfo).port}`;
      ok();
    });
  });
});
test.afterAll(() => server?.close());

test('the <iiif-kasane> tag from the packed package shows a manifest', async ({ page }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`));
  await page.goto(origin + '/');
  const tag = page.locator('iiif-kasane');
  // The viewer shows the painted image as an <img> on its stage, and the manifest label in the About panel.
  const img = tag.locator('[data-iiif-stage] img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBe(800);
  await expect(tag.getByText('Smoke test manifest').first()).toBeAttached();
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});
