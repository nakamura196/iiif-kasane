import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchedEntriesFor, storedEntriesFor } from './CollectionDisplay';

const collection = (id: string, entries: string[]) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Collection',
  label: { en: ['C'] },
  items: entries.map((e) => ({ id: e, type: 'Manifest', label: { en: [e] } })),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchedEntriesFor', () => {
  it('reads the Collection by its id (the host set manifestAtom itself)', async () => {
    const id = 'https://example.org/cd-host/c.json';
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => collection(id, ['https://example.org/cd-host/a.json', 'https://example.org/cd-host/b.json']),
    }));
    const entries = await fetchedEntriesFor({ id });
    expect(entries.map((e) => e.id)).toEqual(['https://example.org/cd-host/a.json', 'https://example.org/cd-host/b.json']);
  });

  it('gives no entries, without rejecting, when the Collection cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    await expect(fetchedEntriesFor({ id: 'https://example.org/cd-fail/c.json' })).resolves.toEqual([]);
  });
});

describe('storedEntriesFor', () => {
  it('gives the entries at once (no promise) for the shown manifest, and null for another', () => {
    const manifest = { id: 'https://example.org/cd-sync/c.json' };
    const raw = collection(manifest.id, ['https://example.org/cd-sync/a.json']);
    expect(storedEntriesFor({ manifest, raw }, manifest)?.map((e) => e.id)).toEqual(['https://example.org/cd-sync/a.json']);
    expect(storedEntriesFor({ manifest, raw }, { id: manifest.id })).toBeNull();
    expect(storedEntriesFor(null, manifest)).toBeNull();
  });
});
