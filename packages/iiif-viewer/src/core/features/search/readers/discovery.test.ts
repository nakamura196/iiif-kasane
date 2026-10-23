import { describe, expect, it } from 'vitest';
import { loadSearchSource } from '.';
import { discoveryReader, recentManifests } from './discovery';
import type { FetchJson } from '../types';

const CTX = 'http://iiif.io/api/discovery/1/context.json';
const fetchFrom = (docs: Record<string, unknown>): FetchJson => async (url: string) => {
  if (!(url in docs)) throw new Error(`404 ${url}`);
  return docs[url];
};
const fetchOptions = { sleep: async () => {} };

const act = (type: string, id: string, endTime: string, extra: Record<string, unknown> = {}) => ({
  type,
  object: { id, type: 'Manifest' },
  endTime,
  ...extra,
});
const page = (n: number, orderedItems: unknown[], prev?: number) => ({
  '@context': CTX,
  id: `https://x/page-${n}`,
  type: 'OrderedCollectionPage',
  ...(prev === undefined ? {} : { prev: { id: `https://x/page-${prev}`, type: 'OrderedCollectionPage' } }),
  orderedItems,
});
const stream = (last: number) => ({
  '@context': CTX,
  id: 'https://x/all',
  type: 'OrderedCollection',
  first: { id: 'https://x/page-0', type: 'OrderedCollectionPage' },
  last: { id: `https://x/page-${last}`, type: 'OrderedCollectionPage' },
});
const manifest = (id: string, label: string) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Manifest',
  label: { en: [label] },
  metadata: [{ label: { en: ['Date'] }, value: { none: ['1850'] } }],
  items: [],
});

describe('recentManifests', () => {
  // 古い順: page-0 → page-1
  const docs = {
    'https://x/page-0': page(0, [
      act('Create', 'https://x/m1', '2026-01-01T00:00:00Z'),
      act('Create', 'https://x/m2', '2026-01-02T00:00:00Z'),
      act('Create', 'https://x/m3', '2026-01-03T00:00:00Z'),
      act('Create', 'https://x/old', '2026-01-04T00:00:00Z'),
    ]),
    'https://x/page-1': page(1, [
      act('Update', 'https://x/m1', '2026-02-01T00:00:00Z'),
      act('Delete', 'https://x/m2', '2026-02-02T00:00:00Z'),
      act('Move', 'https://x/old', '2026-02-03T00:00:00Z', { target: { id: 'https://x/new', type: 'Manifest' } }),
      { type: 'Create', object: { id: 'https://x/c1', type: 'Collection' }, endTime: '2026-02-04T00:00:00Z' },
    ], 0),
  };

  it('walks from the last page backwards and lists live manifests, newest change first', async () => {
    const refs = await recentManifests(stream(1), fetchFrom(docs));
    expect(refs.map((r) => r.id)).toEqual(['https://x/new', 'https://x/m1', 'https://x/m3']);
  });

  it('stops at the item limit without reading older pages', async () => {
    const seen: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      seen.push(url);
      return fetchFrom(docs)(url);
    };
    const refs = await recentManifests(stream(1), fetchJson, { maxItems: 2 });
    expect(refs.map((r) => r.id)).toEqual(['https://x/new', 'https://x/m1']);
    expect(seen).toEqual(['https://x/page-1']);
  });

  it('does not read past a Refresh, since everything before it was announced again after it', async () => {
    const refs = await recentManifests(
      stream(1),
      fetchFrom({
        ...docs,
        'https://x/page-1': page(1, [
          { type: 'Refresh', startTime: '2026-02-01T00:00:00Z', endTime: '2026-02-01T01:00:00Z' },
          act('Create', 'https://x/m1', '2026-02-01T00:30:00Z'),
        ], 0),
      }),
    );
    expect(refs.map((r) => r.id)).toEqual(['https://x/m1']);
  });

  it('fails when the last page cannot be read, but keeps what it has when an older page fails', async () => {
    await expect(recentManifests(stream(1), fetchFrom({}))).rejects.toThrow();
    const refs = await recentManifests(stream(1), fetchFrom({ 'https://x/page-1': docs['https://x/page-1'] }));
    expect(refs.map((r) => r.id)).toEqual(['https://x/new', 'https://x/m1']);
  });

  it('takes the label from the activity object (Activity Streams name) when the manifest is not read', async () => {
    const refs = await recentManifests(
      page(5, [{ type: 'Create', object: { id: 'https://x/m9', type: 'Manifest', name: 'MS. 9' } }]),
      fetchFrom({}),
    );
    expect(refs).toEqual([{ id: 'https://x/m9', label: 'MS. 9' }]);
  });
});

describe('discoveryReader', () => {
  it('is chosen before the collection reader, and reads each manifest for its label and metadata', async () => {
    const fetchJson = fetchFrom({
      'https://x/all': stream(0),
      'https://x/page-0': page(0, [
        act('Create', 'https://x/m1', '2026-01-01T00:00:00Z'),
        act('Create', 'https://x/m2', '2026-01-02T00:00:00Z'),
      ]),
      'https://x/m1': manifest('https://x/m1', 'First'),
    });
    const src = await loadSearchSource({ url: 'https://x/all', fetchJson, locale: 'en', fetchOptions });
    expect(src.kind).toBe('discovery');
    expect(src.items.map((i) => [i.label, i.target.content])).toEqual([
      ['https://x/m2', 'https://x/m2'],
      ['First', 'https://x/m1'],
    ]);
    expect(src.items[1].metadata).toEqual({ Date: ['1850'] });
    expect(src.failed).toBe(1);
  });

  it('accepts a stream or one of its pages, and nothing else', () => {
    expect(discoveryReader.accepts(stream(0))).toBe(true);
    expect(discoveryReader.accepts(page(0, []))).toBe(true);
    expect(discoveryReader.accepts({ type: 'Collection' })).toBe(false);
  });
});
