import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionEntriesFor } from './CollectionDisplay';

const collection = (id: string, entries: string[]) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  type: 'Collection',
  label: { en: ['C'] },
  items: entries.map((e) => ({ id: e, type: 'Manifest', label: { en: [e] } })),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collectionEntriesFor', () => {
  it('reads the entries from the JSON kept with the shown manifest, without fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const manifest = { id: 'https://example.org/cd-kept/c.json' };
    const raw = collection(manifest.id, ['https://example.org/cd-kept/a.json']);
    const entries = await collectionEntriesFor({ manifest, raw }, manifest);
    expect(entries.map((e) => e.id)).toEqual(['https://example.org/cd-kept/a.json']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the Collection by its id when the host set manifestAtom itself (nothing shown for it)', async () => {
    const id = 'https://example.org/cd-host/c.json';
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => collection(id, ['https://example.org/cd-host/a.json', 'https://example.org/cd-host/b.json']),
    }));
    const entries = await collectionEntriesFor(null, { id });
    expect(entries.map((e) => e.id)).toEqual(['https://example.org/cd-host/a.json', 'https://example.org/cd-host/b.json']);
  });
});
