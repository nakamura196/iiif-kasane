import { describe, expect, it } from 'vitest';
import { OTHER_VIEWERS, isPublicManifestUrl, manifestFacts, viewersFor } from './otherViewers';

const painting = (body: unknown) => ({ type: 'Canvas', items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', body }] }] });
const v3 = (body: unknown) => ({ '@context': 'http://iiif.io/api/presentation/3/context.json', type: 'Manifest', items: [painting(body)] });
const v2 = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  '@type': 'sc:Manifest',
  sequences: [{ canvases: [{ images: [{ resource: { '@type': 'dctypes:Image' } }] }] }],
};
const URL3 = 'https://example.org/a b/manifest.json?x=1&y=é';
const ids = (list: { id: string }[]) => list.map((v) => v.id);

describe('isPublicManifestUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(isPublicManifestUrl('https://iiif.io/m.json')).toBe(true);
    expect(isPublicManifestUrl('http://example.org/m.json')).toBe(true);
  });
  it('refuses local images, other schemes and addresses only this computer can reach', () => {
    for (const u of [
      'blob:http://localhost:3838/abc',
      'data:application/json,{}',
      'file:///a.json',
      'http://localhost:3839/manifest.json',
      'http://127.0.0.1/m.json',
      'http://192.168.1.5/m.json',
      'http://10.0.0.1/m.json',
      'http://172.20.0.1/m.json',
      'http://nas.local/m.json',
      'not a url',
      '',
      undefined,
      null,
    ]) {
      expect(isPublicManifestUrl(u)).toBe(false);
    }
    expect(isPublicManifestUrl('http://172.32.0.1/m.json')).toBe(true);
  });
});

describe('manifestFacts', () => {
  it('reads version and kinds of content', () => {
    expect(manifestFacts(v3({ type: 'Image' }))).toEqual({ version: 3, image: true, av: false });
    expect(manifestFacts(v3({ type: 'Video' }))).toEqual({ version: 3, image: false, av: true });
    expect(manifestFacts(v3({ type: 'Sound' })).av).toBe(true);
    expect(manifestFacts(v2)).toEqual({ version: 2, image: true, av: false });
  });
  it('gives no version for Collections, 3D-only content and odd JSON', () => {
    expect(manifestFacts({ '@context': 'http://iiif.io/api/presentation/3/context.json', type: 'Collection' }).version).toBeNull();
    expect(manifestFacts(null).version).toBeNull();
    expect(manifestFacts([]).version).toBeNull();
    expect(manifestFacts(v3({ type: 'Model' }))).toEqual({ version: 3, image: false, av: false });
  });
});

describe('viewersFor', () => {
  it('offers every viewer for a v3 image manifest', () => {
    expect(ids(viewersFor(URL3, v3({ type: 'Image' })))).toEqual(ids(OTHER_VIEWERS));
  });
  it('leaves out v3-only viewers for a v2 manifest', () => {
    const got = ids(viewersFor(URL3, v2));
    expect(got).not.toContain('clover');
    expect(got).toContain('mirador');
  });
  it('leaves out image-only viewers for audio / video', () => {
    expect(ids(viewersFor(URL3, v3({ type: 'Video' })))).toEqual(['uv', 'clover']);
  });
  it('offers nothing for 3D-only content, Collections or local URLs', () => {
    expect(viewersFor(URL3, v3({ type: 'Model' }))).toEqual([]);
    expect(viewersFor(URL3, { type: 'Collection' })).toEqual([]);
    expect(viewersFor('blob:http://localhost/x', v3({ type: 'Image' }))).toEqual([]);
    expect(viewersFor(undefined, v3({ type: 'Image' }))).toEqual([]);
  });
});

describe('url builders', () => {
  it('encode the manifest URL once, so its own ? & # survive', () => {
    for (const v of OTHER_VIEWERS) {
      const link = new URL(v.url(URL3));
      expect(link.protocol).toBe('https:');
      const raw = link.search + link.hash;
      expect(raw).toContain(encodeURIComponent(URL3));
      const param = new URLSearchParams(link.hash.startsWith('#?') ? link.hash.slice(2) : link.search);
      expect(param.get('manifest') ?? param.get('iiif-content')).toBe(URL3);
    }
  });
});
