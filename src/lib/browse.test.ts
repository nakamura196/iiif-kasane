import { describe, expect, it } from 'vitest';
import {
  browseQuery,
  canOpenInBrowse,
  compareQuery,
  groupsOf,
  largeImageUrl,
  readBrowseParams,
  sourceFromResource,
  thumbnailOfCanvas,
  viewerQuery,
  type BrowseItem,
} from './browse';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';

const v3Collection = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: 'https://example.org/c.json',
  type: 'Collection',
  label: { ja: ['コレクション'], en: ['Collection'] },
  items: [
    {
      id: 'https://example.org/m1.json',
      type: 'Manifest',
      label: { en: ['One'] },
      thumbnail: [{ id: '/t1.jpg', type: 'Image' }],
      metadata: [{ label: { ja: ['書名'] }, value: { ja: ['シリーズ A'] } }],
    },
    { id: 'https://example.org/m2.json', type: 'Manifest', label: { en: ['Two'] } },
    {
      id: 'https://example.org/sub.json',
      type: 'Collection',
      label: { en: ['Sub'] },
      items: [{ id: 'https://example.org/m3.json', type: 'Manifest', label: { en: ['Three'] } }],
    },
    // 中身を持たない入れ子の Collection は並べない
    { id: 'https://example.org/empty.json', type: 'Collection', label: { en: ['Empty'] } },
  ],
};

const v2Collection = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  '@id': 'https://example.org/c2.json',
  '@type': 'sc:Collection',
  label: 'Old collection',
  manifests: [
    {
      '@id': 'https://example.org/a.json',
      '@type': 'sc:Manifest',
      label: 'A',
      thumbnail: 'https://example.org/a.jpg',
    },
    { '@id': 'https://example.org/b.json', '@type': 'sc:Manifest', label: 'B' },
  ],
};

const canvas = (id: string, service?: string) => ({
  id,
  type: 'Canvas',
  label: { none: [id.split('/').pop()] },
  items: [
    {
      type: 'AnnotationPage',
      items: [
        {
          type: 'Annotation',
          motivation: 'painting',
          body: {
            id: `${service ?? 'https://example.org/img'}/full/full/0/default.jpg`,
            type: 'Image',
            ...(service ? { service: [{ id: service, type: 'ImageService3' }] } : {}),
          },
        },
      ],
    },
  ],
});

describe('sourceFromResource', () => {
  it('lays out the manifests of a v3 collection, resolving relative thumbnails and nested collections', () => {
    const s = sourceFromResource(v3Collection, 'https://example.org/c.json', 'en')!;
    expect(s.kind).toBe('collection');
    expect(s.title).toBe('Collection');
    expect(s.items.map((i) => i.label)).toEqual(['One', 'Two', 'Three']);
    expect(s.items[0].thumbnail).toBe('https://example.org/t1.jpg');
    expect(s.items[1].thumbnail).toBe('');
    expect(s.items[0].summary).toBe('シリーズ A');
    expect(s.items[2].group).toBe('Sub');
  });

  it('uses the Japanese label when the page is Japanese', () => {
    expect(sourceFromResource(v3Collection, 'https://example.org/c.json', 'ja')!.title).toBe(
      'コレクション'
    );
  });

  it('reads a Presentation 2 collection through the viewer converter', () => {
    const s = sourceFromResource(v2Collection, 'https://example.org/c2.json', 'en')!;
    expect(s.items.map((i) => [i.manifestUrl, i.thumbnail])).toEqual([
      ['https://example.org/a.json', 'https://example.org/a.jpg'],
      ['https://example.org/b.json', ''],
    ]);
  });

  it('makes one card per canvas of a manifest, with a thumbnail from the image service', () => {
    const manifest = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: 'https://example.org/m.json',
      type: 'Manifest',
      label: { en: ['Book'] },
      items: [
        canvas('https://example.org/m/c1', 'https://img.example.org/iiif/1'),
        canvas('https://example.org/m/c2'),
      ],
    };
    const s = sourceFromResource(manifest, 'https://example.org/m.json', 'en')!;
    expect(s.kind).toBe('manifest');
    expect(s.items.map((i) => i.canvasIndex)).toEqual([0, 1]);
    expect(s.items[0].thumbnail).toBe('https://img.example.org/iiif/1/full/240,/0/default.jpg');
    expect(s.items[1].thumbnail).toBe('https://example.org/img/full/full/0/default.jpg');
    expect(s.items[0].manifestUrl).toBe('https://example.org/m.json');
  });

  it('returns null for something that is not a collection or manifest', () => {
    expect(
      sourceFromResource({ type: 'AnnotationPage' }, 'https://example.org/x', 'en')
    ).toBeNull();
    expect(sourceFromResource(null, 'https://example.org/x', 'en')).toBeNull();
  });
});

describe('thumbnailOfCanvas', () => {
  it('prefers the thumbnail the canvas declares', () => {
    expect(
      thumbnailOfCanvas({ thumbnail: [{ id: 'https://example.org/t.jpg', type: 'Image' }] })
    ).toBe('https://example.org/t.jpg');
  });
  it('is empty when there is nothing to show', () => {
    expect(thumbnailOfCanvas({ id: 'x', items: [] })).toBe('');
  });
});

describe('canOpenInBrowse', () => {
  it('accepts collections and manifests with several canvases', () => {
    expect(canOpenInBrowse(v3Collection)).toBe(true);
    expect(canOpenInBrowse(v2Collection)).toBe(true);
    expect(canOpenInBrowse({ type: 'Manifest', items: [{}, {}] })).toBe(true);
    expect(canOpenInBrowse({ '@type': 'sc:Manifest', sequences: [{ canvases: [{}, {}] }] })).toBe(
      true
    );
  });
  it('rejects a single-canvas manifest and non-resources', () => {
    expect(canOpenInBrowse({ type: 'Manifest', items: [{}] })).toBe(false);
    expect(canOpenInBrowse(null)).toBe(false);
    expect(canOpenInBrowse([])).toBe(false);
  });
});

describe('groupsOf', () => {
  const card = (group: string): BrowseItem => ({
    id: group + Math.random(),
    label: '',
    manifestUrl: '',
    canvasIndex: null,
    thumbnail: '',
    group,
    summary: '',
  });
  it('numbers the groups in order of appearance', () => {
    expect(groupsOf([card('b'), card('a'), card('b')])).toEqual({
      names: ['b', 'a'],
      of: [0, 1, 0],
    });
  });
});

describe('URL', () => {
  const params = (q: string) => readBrowseParams(new URLSearchParams(q), manifestFromParams);
  it('takes the resource from manifest (the old app), iiif-content (Kasane), curation or u (gallery)', () => {
    expect(params('manifest=https://a.example/m.json').url).toBe('https://a.example/m.json');
    expect(params('iiif-content=https://a.example/c.json').url).toBe('https://a.example/c.json');
    expect(params('u=https://a.example/u.json').url).toBe('https://a.example/u.json');
    expect(params('').url).toBeNull();
  });
  it('reads layout and limit, ignoring bad values', () => {
    expect(params('layout=helix&limit=30')).toMatchObject({ layout: 'helix', limit: 30 });
    expect(params('layout=cube&limit=-5')).toMatchObject({ layout: null, limit: null });
  });
  it('writes a link without the default layout', () => {
    expect(browseQuery('https://a.example/c.json')).toBe(
      'iiif-content=https%3A%2F%2Fa.example%2Fc.json'
    );
    expect(browseQuery('https://a.example/c.json', { layout: 'sphere', limit: 30 })).toBe(
      'iiif-content=https%3A%2F%2Fa.example%2Fc.json&layout=sphere&limit=30'
    );
  });
  it('opens a canvas card at its frame number in the viewer', () => {
    const item: BrowseItem = {
      id: 'c',
      label: '',
      manifestUrl: 'https://a.example/m.json',
      canvasIndex: 4,
      thumbnail: '',
      group: '',
      summary: '',
    };
    expect(viewerQuery(item)).toBe('iiif-content=https%3A%2F%2Fa.example%2Fm.json&canvas=5');
    expect(viewerQuery({ ...item, canvasIndex: null })).toBe(
      'iiif-content=https%3A%2F%2Fa.example%2Fm.json'
    );
  });
});

describe('compareQuery', () => {
  const m = (u: string, i: number | null): BrowseItem => ({
    id: u + i,
    label: '',
    manifestUrl: u,
    canvasIndex: i,
    thumbnail: '',
    group: '',
    summary: '',
  });
  it('needs two items', () => {
    expect(compareQuery([m('https://a.example/1', null)])).toBeNull();
  });
  it('compares manifests as separate sources, up to four', () => {
    const q = compareQuery([1, 2, 3, 4, 5].map((n) => m(`https://a.example/${n}`, null)))!;
    expect(q.split('&')).toHaveLength(4);
    expect(q.startsWith('src=https%3A%2F%2Fa.example%2F1&')).toBe(true);
  });
  it('compares two canvases of one manifest by position', () => {
    expect(compareQuery([m('https://a.example/m', 2), m('https://a.example/m', 5)])).toBe(
      'iiif-content=https%3A%2F%2Fa.example%2Fm&a=2&b=5'
    );
  });
});

describe('largeImageUrl', () => {
  it('widens an IIIF image URL and leaves others alone', () => {
    expect(largeImageUrl('https://i.example/x/full/240,/0/default.jpg')).toBe(
      'https://i.example/x/full/1200,/0/default.jpg'
    );
    expect(largeImageUrl('https://example.org/t.png')).toBe('https://example.org/t.png');
  });
});
