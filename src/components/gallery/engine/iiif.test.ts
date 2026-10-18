import { afterEach, describe, expect, it, vi } from 'vitest';
import { curationSelections, loadCuration, plainLabel } from './iiif.js';

// Shaped like codh.rois.ac.jp/software/iiif-curation-viewer/sample/curation.json:
// the manifest is on the selection's `within`, not on each member, and the first
// selection lists `canvases` as plain canvas @id strings.
const CURATION = {
  '@type': 'cr:Curation',
  selections: [
    {
      '@type': 'sc:Range',
      label: 'A',
      within: 'http://example.org/a/manifest.json',
      canvases: ['http://example.org/a/canvas/0', 'http://example.org/a/canvas/1#xywh=10,20,30,40'],
    },
    {
      '@type': 'sc:Range',
      label: 'B',
      within: { '@id': 'https://example.org/b/manifest.json', '@type': 'sc:Manifest' },
      members: [{ '@id': 'https://example.org/b/canvas/0', '@type': 'sc:Canvas', label: 'p.1' }],
    },
  ],
};

const manifest = (base: string, n: number) => ({
  '@id': `${base}/manifest.json`,
  sequences: [
    {
      canvases: Array.from({ length: n }, (_, i) => ({
        '@id': `${base}/canvas/${i}`,
        label: `Page ${i + 1}`,
        images: [{ resource: { service: { '@id': `${base}/image/${i}` } } }],
      })),
    },
  ],
});

const DOCS: Record<string, unknown> = {
  'https://example.org/curation.json': CURATION,
  'https://example.org/a/manifest.json': manifest('http://example.org/a', 2),
  'https://example.org/b/manifest.json': manifest('https://example.org/b', 1),
};

afterEach(() => vi.unstubAllGlobals());

describe('loadCuration', () => {
  it('reads members from `within` and string canvases, upgrading http to https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // An https page cannot fetch http (mixed content).
        if (url.startsWith('http:')) throw new TypeError('Failed to fetch');
        const doc = DOCS[url];
        return doc ? new Response(JSON.stringify(doc)) : new Response('', { status: 404 });
      }),
    );
    const walls = await loadCuration('https://example.org/curation.json');
    expect(walls.map((w: { label: string; source: { id: string; region: string | null } }) => [w.label, w.source.id, w.source.region])).toEqual([
      ['Page 1', 'http://example.org/a/image/0', null],
      ['Page 2', 'http://example.org/a/image/1', '10,20,30,40'],
      ['p.1', 'https://example.org/b/image/0', null],
    ]);
  });
});

describe('curationSelections', () => {
  it('gives each selection a first member that carries its manifest', () => {
    const sels = curationSelections(CURATION);
    expect(sels.map((s: { count: number }) => s.count)).toEqual([2, 1]);
    expect(sels[0].first).toEqual({ '@id': 'http://example.org/a/canvas/0', manifest: 'http://example.org/a/manifest.json' });
  });
});

describe('plainLabel', () => {
  const map = { ja: ['上野駅周辺'], en: ['Around Ueno station'] };
  it('prefers the page language', () => {
    expect(plainLabel(map, 'en')).toBe('Around Ueno station');
    expect(plainLabel(map, 'ja')).toBe('上野駅周辺');
  });
  it('falls back to none, en, then the first language', () => {
    expect(plainLabel({ ja: ['a'], none: ['x'], en: ['y'] }, 'fr')).toBe('x');
    expect(plainLabel({ ja: ['a'], en: ['b'] }, 'fr')).toBe('b');
    expect(plainLabel({ ja: ['a'] }, 'en')).toBe('a');
  });
  it('handles v2 strings, arrays and @value', () => {
    expect(plainLabel('s', 'en')).toBe('s');
    expect(plainLabel(['p', 'q'], 'en')).toBe('p');
    expect(plainLabel({ '@value': 'v', '@language': 'ja' }, 'en')).toBe('v');
  });
});
