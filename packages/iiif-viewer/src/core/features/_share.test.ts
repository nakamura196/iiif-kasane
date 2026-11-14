import { describe, expect, it } from 'vitest';
import { parseContentState, parseDroppedText, matchTarget } from './structure';
import type { ContainerInfo } from '../services/containers';
import {
  buildContentState,
  contentStateJson,
  absoluteManifestUrl,
  dragLink,
  encodeShareState,
  shareFragment,
  viewerLinkWith,
} from './_share';

const MANIFEST = 'https://example.org/iiif/m1/manifest';
const CANVAS = 'https://example.org/iiif/m1/canvas/p2';
const containers = (['p1', 'p2', 'p3'] as const).map((p) => ({
  id: `https://example.org/iiif/m1/canvas/${p}`,
})) as unknown as ContainerInfo[];

const enc = (i: Parameters<typeof buildContentState>[0]) => encodeShareState(contentStateJson(i));

describe('buildContentState', () => {
  it('points at the Canvas with the manifest as partOf', () => {
    expect(buildContentState({ manifestUrl: MANIFEST, canvasId: CANVAS })).toEqual({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      type: 'Annotation',
      motivation: ['contentState'],
      target: { id: CANVAS, type: 'Canvas', partOf: [{ id: MANIFEST, type: 'Manifest' }] },
    });
  });

  it('adds the area and the time as fragments', () => {
    const s = buildContentState({
      manifestUrl: MANIFEST,
      canvasId: CANVAS,
      region: { x: 10.4, y: 20, w: 300.6, h: 40 },
    }) as { target: { source: { id: string }; selector: { value: string } } };
    expect(s.target.source.id).toBe(CANVAS);
    expect(s.target.selector.value).toBe('xywh=10,20,301,40');
    expect(shareFragment(undefined, 12.345)).toBe('t=12.35');
  });

  it('points at the manifest only when no page is included', () => {
    const s = buildContentState({ manifestUrl: MANIFEST, region: { x: 0, y: 0, w: 1, h: 1 } }) as { target: unknown };
    expect(s.target).toEqual({ id: MANIFEST, type: 'Manifest' });
  });

  it('ignores an empty area and a bad time', () => {
    expect(shareFragment({ x: 0, y: 0, w: 0, h: 5 }, -1)).toBe('');
  });

  it('uses the container type as the target type', () => {
    for (const type of ['Scene', 'Timeline']) {
      const s = buildContentState({ manifestUrl: MANIFEST, canvasId: CANVAS, canvasType: type }) as { target: { type: string } };
      expect(s.target.type).toBe(type);
    }
  });
});

describe('round trip through Kasane reader', () => {
  it('gives back the same Canvas, area and manifest', () => {
    const state = parseContentState(
      enc({ manifestUrl: MANIFEST, canvasId: CANVAS, region: { x: 10, y: 20, w: 300, h: 40 } }),
    );
    expect(state?.manifestUrl).toBe(MANIFEST);
    const hit = matchTarget(state!.targets, containers);
    expect(hit).toMatchObject({ canvasId: CANVAS, index: 1, xywh: [10, 20, 300, 40] });
  });

  it('gives back the time', () => {
    const state = parseContentState(enc({ manifestUrl: MANIFEST, canvasId: CANVAS, time: 83.5 }));
    expect(matchTarget(state!.targets, containers)?.t).toEqual([83.5, undefined]);
  });

  it('gives back the manifest alone', () => {
    const state = parseContentState(enc({ manifestUrl: MANIFEST }));
    expect(state).toEqual({ manifestUrl: MANIFEST, targets: [] });
  });

  it('survives non-ASCII in the ids', () => {
    const canvasId = 'https://example.org/資料/canvas/1';
    const state = parseContentState(enc({ manifestUrl: 'https://example.org/資料/m', canvasId }));
    expect(state?.targets[0].canvasId).toBe(canvasId);
  });

  it('keeps a Canvas id that contains # (with and without an area)', () => {
    const hashed = 'https://example.org/iiif/m1/manifest#p2';
    const list = [{ id: 'https://example.org/iiif/m1/manifest#p1' }, { id: hashed }] as unknown as ContainerInfo[];
    for (const region of [undefined, { x: 5, y: 6, w: 7, h: 8 }]) {
      const state = parseContentState(enc({ manifestUrl: MANIFEST, canvasId: hashed, region }));
      const hit = matchTarget(state!.targets, list);
      expect(hit?.index).toBe(1);
      expect(hit?.xywh).toEqual(region ? [5, 6, 7, 8] : undefined);
      const dropped = parseDroppedText(dragLink(MANIFEST, enc({ manifestUrl: MANIFEST, canvasId: hashed, region })));
      expect(matchTarget(dropped!.targets, list)?.index).toBe(1);
    }
  });

  it('uses the Timeline type and a time on a Timeline Canvas', () => {
    const state = parseContentState(enc({ manifestUrl: MANIFEST, canvasId: CANVAS, canvasType: 'Timeline', time: 4 }));
    expect(matchTarget(state!.targets, containers)).toMatchObject({ index: 1, t: [4, undefined] });
  });

  it('encodes the spec way: base64url of the percent-encoded JSON, with non-ASCII and %-ids', () => {
    const canvasId = 'https://example.org/資料/canvas/100%25/1';
    const json = contentStateJson({ manifestUrl: 'https://example.org/資料/m', canvasId });
    const encoded = encodeShareState(json);
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const text = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    expect(text).toBe(encodeURIComponent(json));
    expect(decodeURIComponent(text)).toBe(json);
    expect(parseContentState(encoded)?.targets[0].canvasId).toBe(canvasId);
  });

  it('uses no characters outside base64url', () => {
    expect(enc({ manifestUrl: MANIFEST, canvasId: CANVAS })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('dragLink', () => {
  it('is read back by the drop handler', () => {
    const encoded = enc({ manifestUrl: MANIFEST, canvasId: CANVAS, region: { x: 1, y: 2, w: 3, h: 4 } });
    const link = dragLink(MANIFEST, encoded);
    expect(link).toBe(`${MANIFEST}?iiif-content=${encoded}`);
    const state = parseDroppedText(link);
    expect(matchTarget(state!.targets, containers)).toMatchObject({ index: 1, xywh: [1, 2, 3, 4] });
  });

  it('uses & when the manifest URL already has a query', () => {
    expect(dragLink('https://e.org/m?x=1', 'AB')).toBe('https://e.org/m?x=1&iiif-content=AB');
  });
});

describe('viewerLinkWith', () => {
  it('replaces iiif-content, drops canvas and keeps other arguments', () => {
    const link = viewerLinkWith(
      `https://kasane.ldas.jp/ja/viewer?iiif-content=${encodeURIComponent(MANIFEST)}&canvas=3&tab=share`,
      'ENC',
    );
    const u = new URL(link!);
    expect(u.searchParams.get('iiif-content')).toBe('ENC');
    expect(u.searchParams.has('canvas')).toBe(false);
    expect(u.searchParams.get('tab')).toBe('share');
  });

  it('replaces manifest= and curation= (and pos=) too', () => {
    const a = new URL(viewerLinkWith('https://kasane.ldas.jp/ja/viewer?manifest=https%3A%2F%2Fe.org%2Fm&tab=share', 'ENC')!);
    expect(a.searchParams.get('iiif-content')).toBe('ENC');
    expect(a.searchParams.has('manifest')).toBe(false);
    expect(a.searchParams.get('tab')).toBe('share');
    const b = new URL(viewerLinkWith('https://kasane.ldas.jp/ja/viewer?curation=x&pos=3', 'ENC')!);
    expect([...b.searchParams.keys()].sort()).toEqual(['iiif-content']);
  });

  it('is null without any item argument or with a bad URL', () => {
    expect(viewerLinkWith('https://example.org/page?tab=share', 'ENC')).toBeNull();
    expect(viewerLinkWith('not a url', 'ENC')).toBeNull();
  });
});

describe('absoluteManifestUrl', () => {
  it('resolves a site-relative URL against the page', () => {
    expect(absoluteManifestUrl('/manifests/a.json', 'https://kasane.ldas.jp/ja/viewer/')).toBe(
      'https://kasane.ldas.jp/manifests/a.json',
    );
  });

  it('refuses blob:, data: and unresolvable URLs', () => {
    expect(absoluteManifestUrl('blob:https://kasane.ldas.jp/1234', 'https://kasane.ldas.jp/')).toBeNull();
    expect(absoluteManifestUrl('data:application/json,{}', 'https://kasane.ldas.jp/')).toBeNull();
    expect(absoluteManifestUrl('/manifests/a.json')).toBeNull();
  });
});
