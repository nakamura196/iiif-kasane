import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContainerInfo, ImageLayer } from '../../core';
import { SourceImageError, loadSourceImage } from './sourceImage';

// Only the failures are looked at here: each request below fails before an image would be decoded.
const layer: ImageLayer = {
  url: 'https://img.example/a/full/full/0/default.jpg',
  service: { id: 'https://img.example/a', version: 2 },
  width: 4000,
  height: 3000,
  rotation: 0,
  mirror: false,
  annotations: [],
};
const canvas = { id: 'c1', kind: 'Canvas', label: {}, width: 4000, height: 3000, painting: [], supplementing: [] } as unknown as ContainerInfo;

const answer = (status: number, headers: Record<string, string> = {}) => new Response('busy', { status, headers });
const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

afterEach(() => vi.unstubAllGlobals());

describe('how a failure to get the image is told apart', () => {
  it('a busy info.json fails at once for the run over every page, with its status and Retry-After', async () => {
    const fetch = vi.fn(async () => answer(429, { 'Retry-After': '30' }));
    vi.stubGlobal('fetch', fetch);
    const e = await caught(loadSourceImage(layer, canvas, 1024, { busyFails: true }));
    expect(e).toBeInstanceOf(SourceImageError);
    expect((e as SourceImageError).detail).toEqual({ status: 429, retryAfterMs: 30_000 });
    // The whole image is not asked for from a busy server
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('elsewhere, a busy info.json still falls back to the image itself, as before', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('info.json') ? answer(503) : answer(404)));
    vi.stubGlobal('fetch', fetch);
    const e = await caught(loadSourceImage(layer, canvas, 1024));
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://img.example/a/info.json', layer.url]);
    expect((e as SourceImageError).detail).toEqual({ status: 404 });
  });

  it('a request that fails without an answer (a refusal without CORS headers) is a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const e = await caught(loadSourceImage(layer, canvas, 1024, { busyFails: true }));
    expect((e as SourceImageError).reason).toBe('fetch');
    expect((e as SourceImageError).detail).toEqual({ network: true });
  });
});
