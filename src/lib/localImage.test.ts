import { describe, expect, it } from 'vitest';
import { convertToV4, parseManifestV4 } from '@nakamura196/iiif-viewer/core';
import { isLocalManifestUrl, looksLikeImage, manifestFromLocalImage } from './localImage';

const image = {
  name: '銘尽.jpg',
  imageUrl: 'blob:http://localhost:3838/1234',
  format: 'image/jpeg',
  width: 4000,
  height: 3000,
  digest: 'ab'.repeat(32),
};

describe('manifestFromLocalImage', () => {
  it('paints the blob image on one Canvas of its size', () => {
    const m = manifestFromLocalImage(image) as { id: string; label: unknown; items: Record<string, unknown>[] };
    expect(m.id).toBe(`urn:kasane:local:sha256:${'ab'.repeat(32)}`);
    expect(m.label).toEqual({ none: ['銘尽.jpg'] });
    expect(m.items).toHaveLength(1);
    const canvas = m.items[0] as { id: string; width: number; height: number; items: { items: { body: Record<string, unknown>; target: string }[] }[] };
    expect(canvas.width).toBe(4000);
    expect(canvas.height).toBe(3000);
    const anno = canvas.items[0].items[0];
    expect(anno.target).toBe(canvas.id);
    expect(anno.body).toMatchObject({ id: image.imageUrl, type: 'Image', format: 'image/jpeg' });
  });

  it('gives the same file the same Canvas id', () => {
    const a = manifestFromLocalImage(image) as { items: { id: string }[] };
    const b = manifestFromLocalImage({ ...image, imageUrl: 'blob:http://localhost:3838/5678' }) as { items: { id: string }[] };
    expect(a.items[0].id).toBe(b.items[0].id);
  });

  it('is read by the viewer as a manifest with one image Canvas', () => {
    const v4 = convertToV4(manifestFromLocalImage(image));
    const { annotations } = parseManifestV4(v4);
    expect(v4.items).toHaveLength(1);
    expect(annotations).toEqual([]);
  });
});

describe('helpers', () => {
  it('tells blob manifests apart', () => {
    expect(isLocalManifestUrl('blob:https://kasane.ldas.jp/x')).toBe(true);
    expect(isLocalManifestUrl('https://example.org/manifest.json')).toBe(false);
    expect(isLocalManifestUrl(null)).toBe(false);
  });

  it('accepts images and files without a type', () => {
    expect(looksLikeImage({ type: 'image/png' })).toBe(true);
    expect(looksLikeImage({ type: '' })).toBe(true);
    expect(looksLikeImage({ type: 'application/pdf' })).toBe(false);
  });
});
