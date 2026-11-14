import { afterEach, describe, expect, it, vi } from 'vitest';
import { containersOf } from 'iiif-kasane/core';
import { fetchManifest } from '../../packages/iiif-viewer/src/core/services/utils';
import {
  OTHER_VIEWERS,
  fetchServedManifest,
  isSecretParam,
  isPublicManifestUrl,
  mediaFactsOf,
  servedManifestOf,
  viewersFor,
} from './otherViewers';

const V3 = 'http://iiif.io/api/presentation/3/context.json';
const painting = (body: unknown) => ({ type: 'Canvas', items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'painting', body }] }] });
const v3 = (body: unknown, extra: object = {}) => ({ '@context': V3, id: 'https://example.org/m.json', type: 'Manifest', items: [painting(body)], ...extra });
const v2 = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  '@id': 'https://example.org/v2.json',
  '@type': 'sc:Manifest',
  label: 'v2',
  sequences: [
    {
      '@type': 'sc:Sequence',
      canvases: [
        {
          '@id': 'https://example.org/v2/c1',
          '@type': 'sc:Canvas',
          width: 100,
          height: 100,
          images: [
            {
              '@type': 'oa:Annotation',
              motivation: 'sc:painting',
              on: 'https://example.org/v2/c1',
              resource: { '@id': 'https://example.org/p.jpg', '@type': 'dctypes:Image', format: 'image/jpeg', width: 100, height: 100 },
            },
          ],
        },
      ],
    },
  ],
};
const infoJson = {
  '@context': 'http://iiif.io/api/image/3/context.json',
  id: 'https://example.org/img/abc',
  type: 'ImageService3',
  protocol: 'http://iiif.io/api/image',
  profile: 'level1',
  width: 100,
  height: 100,
};
const URL3 = 'https://example.org/a b/manifest.json?x=1&y=é';
const ids = (list: { id: string }[]) => list.map((v) => v.id);
const IMG = { image: true, av: false };

describe('isPublicManifestUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(isPublicManifestUrl('https://iiif.io/m.json')).toBe(true);
    expect(isPublicManifestUrl('http://example.org/m.json')).toBe(true);
    expect(isPublicManifestUrl('http://172.32.0.1/m.json')).toBe(true);
    expect(isPublicManifestUrl('http://[2001:4860:4860::8888]/m.json')).toBe(true);
    expect(isPublicManifestUrl('http://[::ffff:8.8.8.8]/m.json')).toBe(true); // the IPv4 inside decides
    expect(isPublicManifestUrl('http://[::808:808]/m.json')).toBe(true); // IPv4-compatible with a public IPv4 inside
    expect(isPublicManifestUrl('https://example.org/m.json?lang=ja&page=2')).toBe(true);
  });
  it('refuses local images, other schemes and addresses only this computer or its network can reach', () => {
    for (const u of [
      'blob:http://localhost:3838/abc',
      'data:application/json,{}',
      'file:///a.json',
      'http://localhost:3839/manifest.json',
      'http://localhost./m.json',
      'http://127.0.0.1/m.json',
      'http://192.168.1.5/m.json',
      'http://10.0.0.1/m.json',
      'http://172.20.0.1/m.json',
      'http://100.64.0.1/m.json',
      'http://169.254.1.1/m.json',
      'http://[::1]/m.json',
      'http://[fd12:3456::1]/m.json',
      'http://[fc00::1]/m.json',
      'http://[fe80::1]/m.json',
      'http://[::ffff:127.0.0.1]/m.json',
      'http://[::ffff:10.0.0.1]/m.json',
      'http://[::]/m.json',
      'http://[::7f00:1]/m.json',
      'http://[::127.0.0.1]/m.json',
      'http://[::a00:1]/m.json',
      'http://[::10.1.2.3]/m.json',
      'http://[::c0a8:101]/m.json',
      'http://[0:0:0:0:0:0:0:1]/m.json',
      'http://[64:ff9b::a00:1]/m.json',
      'http://[ff02::1]/m.json',
      'http://nas/m.json',
      'http://nas.local/m.json',
      'http://nas.internal/m.json',
      'http://printer.lan/m.json',
      'http://router.home.arpa/m.json',
      'http://app.test/m.json',
      'http://app.localhost/m.json',
      'not a url',
      '',
      undefined,
      null,
    ]) {
      expect(isPublicManifestUrl(u), String(u)).toBe(false);
    }
  });
  it('refuses a URL with user:password@ or a query parameter that looks like a credential', () => {
    expect(isPublicManifestUrl('https://user:pass@example.org/m.json')).toBe(false);
    expect(isPublicManifestUrl('https://user@example.org/m.json')).toBe(false);
    for (const q of ['token=abc', 'access_token=abc', 'apikey=abc', 'api_key=abc', 'X-Amz-Signature=abc', 'auth=1', 'sig=1']) {
      expect(isPublicManifestUrl(`https://example.org/m.json?${q}`), q).toBe(false);
    }
  });
});

describe('servedManifestOf', () => {
  it('reads the version of a real Manifest as served', () => {
    expect(servedManifestOf(v3({ type: 'Image' }), 'https://example.org/m.json')).toEqual({ url: 'https://example.org/m.json', version: 3 });
    expect(servedManifestOf(v2, 'https://example.org/v2.json')).toEqual({ url: 'https://example.org/v2.json', version: 2 });
  });
  it('gives nothing for what is not a Manifest, Presentation 4, or a private URL', () => {
    const u = 'https://example.org/x.json';
    expect(servedManifestOf({ '@context': V3, type: 'Collection' }, u)).toBeNull();
    expect(servedManifestOf(infoJson, u)).toBeNull();
    expect(servedManifestOf({ '@context': V3, type: 'Canvas' }, u)).toBeNull();
    expect(servedManifestOf({ '@context': V3, type: 'AnnotationPage' }, u)).toBeNull();
    expect(servedManifestOf({ '@type': 'cr:Curation', '@context': ['http://iiif.io/api/presentation/2/context.json', 'http://codh.rois.ac.jp/iiif/curation/1/context.json'] }, u)).toBeNull();
    expect(servedManifestOf({ '@context': 'http://iiif.io/api/presentation/4/context.json', type: 'Manifest' }, u)).toBeNull();
    expect(servedManifestOf(null, u)).toBeNull();
    expect(servedManifestOf(v3({ type: 'Image' }), 'https://example.org/m.json?token=1')).toBeNull();
  });
  it('gives nothing for an item behind IIIF Authentication', () => {
    const v3auth = v3({ type: 'Image', service: [{ type: 'ImageService3', service: [{ type: 'AuthAccessService2', profile: 'active' }] }] });
    const v2auth = { ...v2, service: { '@context': 'http://iiif.io/api/auth/1/context.json', profile: 'http://iiif.io/api/auth/1/login' } };
    expect(servedManifestOf(v3auth, 'https://example.org/m.json')).toBeNull();
    expect(servedManifestOf(v2auth, 'https://example.org/v2.json')).toBeNull();
  });
});

describe('through the real loader (fetchManifest)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const serve = (json: unknown) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(json)) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('a v2 manifest: the loader copy says 3, the served file says 2, and the media is read from the copy', async () => {
    serve(v2);
    const url = 'https://example.org/v2.json';
    const loaded = (await fetchManifest(url)) as { '@context'?: unknown } | null;
    expect(JSON.stringify(loaded?.['@context'])).toContain('presentation/3'); // no marker of the origin is left
    const served = await fetchServedManifest(url);
    expect(served).toEqual({ url, version: 2 });
    const media = mediaFactsOf(containersOf(loaded as never));
    expect(media).toEqual({ image: true, av: false });
    // a v3-only viewer is left out: reading the version from the loader copy would have offered it
    expect(ids(viewersFor(served, media))).not.toContain('clover');
    expect(ids(viewersFor(served, media))).toContain('mirador');
  });

  it('an info.json is wrapped into a Manifest by the loader but gets no links', async () => {
    serve(infoJson);
    const url = 'https://example.org/img/abc/info.json';
    const loaded = (await fetchManifest(url)) as { type?: string } | null;
    expect(loaded?.type).toBe('Manifest');
    expect(await fetchServedManifest(url)).toBeNull();
  });

  it('a curation is wrapped into a Manifest by the loader but gets no links', async () => {
    const curation = {
      '@context': ['http://iiif.io/api/presentation/2/context.json', 'http://codh.rois.ac.jp/iiif/curation/1/context.json'],
      '@type': 'cr:Curation',
      '@id': 'https://example.org/curation.json',
      selections: [],
    };
    serve(curation);
    const url = 'https://example.org/curation.json';
    await fetchManifest(url);
    expect(await fetchServedManifest(url)).toBeNull();
  });

  it('media is read through the existing containersOf (Choice, Audio, motivation)', () => {
    const m = v3({ type: 'Choice', items: [{ type: 'Sound', id: 'https://example.org/a.mp3' }, { type: 'Sound', id: 'https://example.org/a.ogg' }] });
    expect(mediaFactsOf(containersOf(m as never))).toEqual({ image: false, av: true });
    // only painting counts: an image that is a commenting annotation does not make the item an image
    const commenting = { '@context': V3, id: 'https://example.org/c.json', type: 'Manifest', items: [{ type: 'Canvas', items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'commenting', body: { type: 'Image', id: 'https://example.org/p.jpg' } }] }] }] };
    expect(mediaFactsOf(containersOf(commenting as never))).toEqual({ image: false, av: false });
  });
});

describe('fetchServedManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const stub = (impl: () => Promise<unknown>) => {
    const m = vi.fn(impl);
    vi.stubGlobal('fetch', m);
    return m;
  };
  it('asks for an http item as https, and links to the https URL', async () => {
    const m = stub(async () => ({ ok: true, json: async () => v3({ type: 'Image' }) }));
    const got = await fetchServedManifest('http://example.org/m.json');
    expect(m).toHaveBeenCalledWith('https://example.org/m.json');
    expect(got).toEqual({ url: 'https://example.org/m.json', version: 3 });
  });
  it('offers nothing when the https URL does not answer, or the request fails', async () => {
    stub(async () => ({ ok: false }));
    expect(await fetchServedManifest('http://example.org/a.json')).toBeNull();
    stub(async () => {
      throw new Error('network');
    });
    expect(await fetchServedManifest('https://example.org/b.json')).toBeNull();
  });
  it('does not remember a failure: the same URL is asked again and can succeed', async () => {
    let ok = false;
    stub(async () => (ok ? { ok: true, json: async () => v3({ type: 'Image' }) } : { ok: false }));
    expect(await fetchServedManifest('https://example.org/retry.json')).toBeNull();
    ok = true;
    expect(await fetchServedManifest('https://example.org/retry.json')).toEqual({ url: 'https://example.org/retry.json', version: 3 });
  });
  it('does not even ask for a private URL', async () => {
    const m = stub(async () => ({ ok: true, json: async () => ({}) }));
    expect(await fetchServedManifest('http://192.168.0.2/m.json')).toBeNull();
    expect(m).not.toHaveBeenCalled();
  });
});

describe('isSecretParam', () => {
  it('matches credential names in their usual forms', () => {
    for (const n of ['token', 'access_token', 'accessToken', 'access-token', 'accesstoken', 'api_key', 'api-key', 'apikey', 'key', 'X-Amz-Signature', 'X-Amz-Credential', 'sig', 'auth', 'Authorization', 'jwt', 'sessionid', 'client_secret', 'password']) {
      expect(isSecretParam(n), n).toBe(true);
    }
  });
  it('does not match names that only contain such letters', () => {
    for (const n of ['author', 'authority', 'keyword', 'keywords', 'design', 'monkey', 'signal', 'tokenize', 'secretary', 'lang', 'page', 'canvas']) {
      expect(isSecretParam(n), n).toBe(false);
    }
  });
  it('a manifest URL with such a name is still offered', () => {
    expect(isPublicManifestUrl('https://example.org/m.json?author=a&keyword=b&design=c&monkey=d')).toBe(true);
    expect(isPublicManifestUrl('https://example.org/m.json?access_token=a')).toBe(false);
  });
});

describe('viewersFor', () => {
  const m3 = { url: URL3, version: 3 as const };
  it('offers every viewer for a v3 image manifest', () => {
    expect(ids(viewersFor(m3, IMG))).toEqual(ids(OTHER_VIEWERS));
  });
  it('leaves out image-only viewers for audio / video', () => {
    expect(ids(viewersFor(m3, { image: false, av: true }))).toEqual(['uv', 'clover']);
  });
  it('offers nothing without a real Manifest or without image / audio / video', () => {
    expect(viewersFor(null, IMG)).toEqual([]);
    expect(viewersFor(m3, { image: false, av: false })).toEqual([]);
  });
});

describe('url builders', () => {
  it('encode the manifest URL once, so its own ? & # survive', () => {
    for (const v of OTHER_VIEWERS) {
      const link = new URL(v.url(URL3));
      expect(link.protocol).toBe('https:');
      expect(link.search + link.hash).toContain(encodeURIComponent(URL3));
      const param = new URLSearchParams(link.hash.startsWith('#?') ? link.hash.slice(2) : link.search);
      expect(param.get('manifest') ?? param.get('iiif-content')).toBe(URL3);
    }
  });
});
