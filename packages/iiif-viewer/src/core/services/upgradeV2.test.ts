import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canvasImagesOf } from '../features/image';
import { convertToV4 } from './manifestConverter';
import { isPresentation2, upgradeToV3 } from './upgradeV2';

// シェリー書簡（東京大学総合図書館）の manifest。2026-10-12 に
// https://utda.github.io/shelley/iiif/shelley/manifest.json から保存した。
// 元画像と透過光画像の oa:Choice で、Choice 自身に format と .jpg の @id が付いている。
const shelley = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/v2-shelley-choice.json', import.meta.url)), 'utf8'));

describe('upgradeToV3', () => {
  it('Presentation 2 の Choice を、候補を潰さずに 3 にする', () => {
    const m = upgradeToV3(shelley()) as { '@context': string; type: string; items: unknown[] };
    expect(m['@context']).toBe('http://iiif.io/api/presentation/3/context.json');
    expect(m.type).toBe('Manifest');
    const images = canvasImagesOf(m.items[0]);
    expect(images.paintings).toHaveLength(1);
    const options = images.paintings[0].options;
    expect(options.map((o) => o.label)).toEqual([{ none: ['元画像'] }, { none: ['透過光画像'] }]);
    expect(options.map((o) => o.layer?.service)).toEqual([
      { id: 'https://utda.github.io/shelley/files/tile/original', version: 2 },
      { id: 'https://utda.github.io/shelley/files/tile/toka', version: 2 },
    ]);
  });

  it('変換した manifest は、そのまま読み込み時の変換（4 へ）に渡せる', () => {
    expect(() => convertToV4(upgradeToV3(shelley()))).not.toThrow();
  });

  it('3 と 4 には手を入れない', () => {
    const v3 = { '@context': 'http://iiif.io/api/presentation/3/context.json', id: 'https://example.org/m', type: 'Manifest', items: [] };
    const v4 = { '@context': 'http://iiif.io/api/presentation/4/context.json', id: 'https://example.org/m', type: 'Manifest', items: [] };
    expect(upgradeToV3(v3)).toBe(v3);
    expect(upgradeToV3(v4)).toBe(v4);
    expect(isPresentation2(v3)).toBe(false);
  });

  it('@context の無い 2 も、@id と sc:Manifest で見分ける', () => {
    expect(isPresentation2({ '@id': 'https://example.org/m', '@type': 'sc:Manifest' })).toBe(true);
  });

  // 比較ページで、関連資料に「http://example.org/undefined/2 unknown」と出ていた
  it('文字列の related を、URL を残したまま 3 の homepage にする', () => {
    const v2 = (o: Record<string, unknown>) => ({
      '@context': 'http://iiif.io/api/presentation/2/context.json',
      '@id': 'https://example.org/m',
      '@type': 'sc:Manifest',
      label: 'L',
      sequences: [],
      ...o,
    });
    const m = upgradeToV3(
      v2({ related: ['https://example.org/a', { '@id': 'https://example.org/b', label: 'B', format: 'text/html' }] }),
    ) as Record<string, unknown>;
    expect(m.homepage).toEqual([
      { id: 'https://example.org/a', type: 'Text' },
      { id: 'https://example.org/b', type: 'Text', label: { none: ['B'] }, format: 'text/html' },
    ]);
    expect(m.provider).toBeUndefined();

    const s = upgradeToV3(v2({ seeAlso: 'https://example.org/s', rendering: 'https://example.org/r' })) as Record<string, unknown>;
    expect(s.seeAlso).toEqual([{ id: 'https://example.org/s', type: 'Dataset' }]);
    expect(s.rendering).toEqual([{ id: 'https://example.org/r', type: 'Text' }]);
  });
});

describe('upgradeToV3: resource の @type が oa:Annotation の画像', () => {
  const manifest = (resource: Record<string, unknown>) => ({
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': 'https://example.org/m',
    '@type': 'sc:Manifest',
    label: 'm',
    sequences: [
      {
        '@type': 'sc:Sequence',
        canvases: [
          {
            '@id': 'https://example.org/c1',
            '@type': 'sc:Canvas',
            width: 100,
            height: 200,
            images: [{ '@type': 'oa:Annotation', motivation: 'sc:painting', on: 'https://example.org/c1', resource }],
          },
        ],
      },
    ],
  });
  const body = (m: unknown) => {
    const items = (m as { items: { items: { items: { body: { type: string; service?: unknown } }[] }[] }[] }).items;
    return items[0].items[0].items[0].body;
  };

  it('画像サービスを持つ resource は Image になる', () => {
    const b = body(
      upgradeToV3(
        manifest({
          '@id': 'https://example.org/i/full/full/0/default.jpg',
          '@type': 'oa:Annotation',
          format: 'image/jpeg',
          service: { '@context': 'http://iiif.io/api/image/2/context.json', '@id': 'https://example.org/i', profile: 'http://iiif.io/api/image/2/level2.json' },
        }),
      ),
    );
    expect(b.type).toBe('Image');
    expect(b.service).toBeTruthy();
  });

  it('画像でない resource（テキストなど）は Image にしない', () => {
    const b = body(upgradeToV3(manifest({ '@id': 'https://example.org/t.txt', '@type': 'oa:Annotation', format: 'text/plain' })));
    expect(b.type).not.toBe('Image');
  });
});
