import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  buildManifest,
  imageUrlOf,
  manifestIdOf,
  move,
  pageLabelOf,
  problemsOf,
  serverPathOf,
  type EditorPage,
  type EditorSettings,
} from './manifestEditor';

const page = (path: string, extra: Partial<EditorPage> = {}): EditorPage => ({
  key: path,
  label: pageLabelOf(path),
  path,
  width: 1000,
  height: 1500,
  format: 'image/png',
  previewUrl: `blob:http://localhost/${path}`,
  ...extra,
});

const settings = (extra: Partial<EditorSettings> = {}): EditorSettings => ({
  ...DEFAULT_SETTINGS,
  imageBase: 'https://example.org/book',
  ...extra,
});

type Any = Record<string, any>;

describe('serverPathOf / pageLabelOf', () => {
  it('フォルダ自体の名前は外し、その中の位置は残す', () => {
    expect(serverPathOf('book/001.jpg')).toBe('001.jpg');
    expect(serverPathOf('book/vol1/001.jpg')).toBe('vol1/001.jpg');
    expect(serverPathOf('001.jpg')).toBe('001.jpg');
  });
  it('ページの名前は拡張子を外す', () => {
    expect(pageLabelOf('001.jpg')).toBe('001');
    expect(pageLabelOf('a.b.png')).toBe('a.b');
    expect(pageLabelOf('noext')).toBe('noext');
  });
});

describe('imageUrlOf', () => {
  it('画像ファイル: 置き場所の後ろにファイル名をつなぎ、名前の中の空白などはエスケープする', () => {
    expect(imageUrlOf(settings(), 'vol 1/001.jpg')).toBe('https://example.org/book/vol%201/001.jpg');
    expect(imageUrlOf(settings({ imageBase: 'https://example.org/book/' }), '001.jpg')).toBe(
      'https://example.org/book/001.jpg',
    );
  });
  it('IIIF Image API: 識別子は 1 つの区切りにまとめ（/ もエスケープ）、3.0 は max、2.x は full', () => {
    const s3 = settings({ hosting: 'iiif3', imageBase: 'https://iiif.example.org/iiif/3/' });
    expect(imageUrlOf(s3, 'vol1/001.jpg')).toBe('https://iiif.example.org/iiif/3/vol1%2F001.jpg/full/max/0/default.jpg');
    const s2 = settings({ hosting: 'iiif2', imageBase: 'https://iiif.example.org/iiif/2' });
    expect(imageUrlOf(s2, '001.jpg')).toBe('https://iiif.example.org/iiif/2/001.jpg/full/full/0/default.jpg');
  });
});

describe('manifestIdOf / problemsOf', () => {
  it('画像ファイルなら、マニフェストは画像と同じ場所の manifest.json が既定', () => {
    expect(manifestIdOf(settings())).toBe('https://example.org/book/manifest.json');
    expect(manifestIdOf(settings({ manifestId: 'https://example.org/m.json' }))).toBe('https://example.org/m.json');
  });
  it('IIIF Image API のときは既定を作らない（画像サーバにマニフェストは置かないため）', () => {
    expect(manifestIdOf(settings({ hosting: 'iiif3' }))).toBe('');
    expect(problemsOf(settings({ hosting: 'iiif3' }), [page('1.png')])).toEqual(['manifestId']);
  });
  it('足りないものを挙げる', () => {
    expect(problemsOf(DEFAULT_SETTINGS, [])).toEqual(['noImages', 'imageBase', 'manifestId']);
    expect(problemsOf(settings({ rights: 'CC BY' }), [page('1.png')])).toEqual(['rights']);
    expect(problemsOf(settings(), [page('1.png')])).toEqual([]);
  });
});

describe('buildManifest', () => {
  it('画像ファイル: 測った大きさで Canvas を作り、画像の URL は置き場所から作る', () => {
    const m = buildManifest(settings({ label: '本' }), [page('001.png'), page('002.png', { label: '' })]) as Any;
    expect(m.id).toBe('https://example.org/book/manifest.json');
    expect(m.label).toEqual({ none: ['本'] });
    expect(m.items).toHaveLength(2);
    const [c1, c2] = m.items;
    expect(c1.id).toBe('https://example.org/book/canvas/p1');
    expect(c1.label).toEqual({ none: ['001'] });
    expect(c2.label).toEqual({ none: ['2'] });
    expect([c1.width, c1.height]).toEqual([1000, 1500]);
    const anno = c1.items[0].items[0];
    expect(anno.target).toBe(c1.id);
    expect(anno.body).toEqual({
      id: 'https://example.org/book/001.png',
      type: 'Image',
      format: 'image/png',
      width: 1000,
      height: 1500,
    });
    expect(m.rights).toBeUndefined();
    expect(m.behavior).toBeUndefined();
    expect(m.viewingDirection).toBeUndefined();
  });

  it('blob: の URL はダウンロードするマニフェストに入らない', () => {
    const json = JSON.stringify(buildManifest(settings({ hosting: 'iiif3' }), [page('001.png')]));
    expect(json).not.toContain('blob:');
  });

  it('プレビューは手元の画像を指し、画像サービスを付けない', () => {
    const m = buildManifest(settings({ hosting: 'iiif3' }), [page('001.png')], { preview: true }) as Any;
    const body = m.items[0].items[0].items[0].body;
    expect(body.id).toBe('blob:http://localhost/001.png');
    expect(body.service).toBeUndefined();
  });

  it('IIIF Image API 3 / 2 の画像サービスを付ける', () => {
    const s3 = settings({ hosting: 'iiif3', imageBase: 'https://i.example.org/iiif/3', manifestId: 'https://example.org/m.json' });
    const b3 = (buildManifest(s3, [page('001.png')]) as Any).items[0].items[0].items[0].body;
    expect(b3.format).toBe('image/jpeg');
    expect(b3.service).toEqual([{ id: 'https://i.example.org/iiif/3/001.png', type: 'ImageService3', profile: 'level1' }]);
    const s2 = { ...s3, hosting: 'iiif2' as const };
    const b2 = (buildManifest(s2, [page('001.png')]) as Any).items[0].items[0].items[0].body;
    expect(b2.service[0]['@type']).toBe('ImageService2');
    expect(b2.service[0]['@id']).toBe('https://i.example.org/iiif/3/001.png');
  });

  it('言語・説明・権利・帰属・右から左・見開き', () => {
    const m = buildManifest(
      settings({
        label: '源氏物語',
        language: 'ja',
        summary: '写本',
        rights: 'http://creativecommons.org/licenses/by/4.0/',
        attribution: '東京大学',
        viewingDirection: 'right-to-left',
        paged: true,
      }),
      [page('1.png')],
    ) as Any;
    expect(m.label).toEqual({ ja: ['源氏物語'] });
    expect(m.summary).toEqual({ ja: ['写本'] });
    expect(m.rights).toBe('http://creativecommons.org/licenses/by/4.0/');
    expect(m.requiredStatement).toEqual({ label: { ja: ['帰属'] }, value: { ja: ['東京大学'] } });
    expect(m.viewingDirection).toBe('right-to-left');
    expect(m.behavior).toEqual(['paged']);
    expect(m.items[0].label).toEqual({ ja: ['1'] });
  });
});

describe('move', () => {
  it('前後に動かし、端では止まる', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    const list = ['a', 'b'];
    expect(move(list, 0, -1)).toBe(list);
  });
});
