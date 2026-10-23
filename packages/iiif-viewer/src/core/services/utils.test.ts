import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchManifest } from './utils';

const manifest = { '@context': 'http://iiif.io/api/presentation/3/context.json', id: 'm', type: 'Manifest', items: [] };

const stubFetch = (ok: () => boolean) => {
  const fn = vi.fn(async () => (ok() ? new Response(JSON.stringify(manifest)) : new Response('', { status: 500 })));
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchManifest', () => {
  it('shares one request among calls for the same URL', async () => {
    const fn = stubFetch(() => true);
    const url = 'https://example.org/shared/manifest';
    const [a, b] = await Promise.all([fetchManifest(url), fetchManifest(url)]);
    // a later call (a display mounted after the first answer) is served from the same request
    const c = await fetchManifest(url);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(c).toBe(a);
  });

  it('asks again after a failure', async () => {
    let ok = false;
    const fn = stubFetch(() => ok);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = 'https://example.org/failing/manifest';
    expect(await fetchManifest(url)).toBeNull();
    ok = true;
    expect(await fetchManifest(url)).not.toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('asks again once the reuse window has passed', async () => {
    vi.useFakeTimers();
    const fn = stubFetch(() => true);
    const url = 'https://example.org/stale/manifest';
    await fetchManifest(url);
    await vi.advanceTimersByTimeAsync(61_000);
    await fetchManifest(url);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
