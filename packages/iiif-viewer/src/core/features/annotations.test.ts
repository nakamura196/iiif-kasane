import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertToV4 } from '../services/manifestConverter';
import {
  annotationSourcesOf,
  embeddedCanvasAnnotations,
  isAnnotationAt,
  nextPageOf,
  withReferenceLabels,
  parseXywh,
  pathPoints,
  pickBodies,
  pointPercent,
  rawCanvasOf,
  readCanvasAnnotations,
  regionBoxPercent,
  sanitizeAnnotationHtml,
  svgRings,
} from './annotations';

const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__/annotations', name), 'utf8')) as Record<string, unknown>;

const manifestOf = (name: string) => convertToV4(load(name));

const firstCanvasAnnotations = (name: string) => {
  const manifest = manifestOf(name);
  const canvas = (manifest.items[0] as unknown as { id: string; width: number; height: number });
  return { manifest, canvas, annos: embeddedCanvasAnnotations(manifest, canvas.id, canvas) };
};

describe('領域の読み取り', () => {
  it('xywh（pixel / percent）', () => {
    expect(parseXywh('#xywh=1,2,30,40')).toEqual({ x: 1, y: 2, w: 30, h: 40 });
    expect(parseXywh('xywh=pixel:1,2,3,4')).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(parseXywh('#xywh=percent:10,20,50,50', 1000, 500)).toEqual({ x: 100, y: 100, w: 500, h: 250 });
    expect(parseXywh('#xywh=percent:10,20,50,50')).toBeNull();
    expect(parseXywh('#t=1,2')).toBeNull();
  });
  it('SVG の path・polygon・rect・circle', () => {
    expect(pathPoints('M0,0 L10,0 L10,10 Z')).toEqual([[[0, 0], [10, 0], [10, 10]]]);
    expect(pathPoints('M0 0 h10 v10 h-10 z')).toEqual([[[0, 0], [10, 0], [10, 10], [0, 10]]]);
    expect(svgRings("<svg><polygon points='0,0 4,0 4,4'/></svg>")).toEqual([[[0, 0], [4, 0], [4, 4]]]);
    expect(svgRings("<svg><rect x='1' y='2' width='3' height='4'/></svg>")[0]).toHaveLength(4);
    expect(svgRings("<svg><circle cx='5' cy='5' r='2'/></svg>")[0].length).toBeGreaterThan(8);
  });
  it('割合に直す', () => {
    expect(regionBoxPercent({ type: 'rect', x: 100, y: 50, w: 200, h: 100 }, 1000, 500)).toEqual({
      left: 10,
      top: 10,
      width: 20,
      height: 20,
    });
    expect(regionBoxPercent({ type: 'canvas' }, 1000, 500)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    expect(regionBoxPercent({ type: 'point', x: 1, y: 1 }, 1000, 500)).toBeNull();
    expect(pointPercent(250, 100, 1000, 500)).toEqual({ left: 25, top: 20 });
  });
});

describe('Cookbook のレシピ', () => {
  it('0019: HTML の本文・Canvas 全体', () => {
    const { annos } = firstCanvasAnnotations('0019-html-in-annotations.json');
    expect(annos).toHaveLength(1);
    expect(annos[0].region).toEqual({ type: 'canvas' });
    expect(annos[0].motivations).toEqual(['commenting']);
    expect(annos[0].bodies[0]).toMatchObject({ kind: 'text', format: 'text/html', language: 'de' });
  });
  it('0021: タグ', () => {
    const { annos } = firstCanvasAnnotations('0021-tagging.json');
    expect(annos[0].motivations).toEqual(['tagging']);
    expect(annos[0].bodies[0].kind).toBe('text');
  });
  it('0022: ホットスポット（矩形と、別 Canvas へのリンク）', () => {
    const { annos } = firstCanvasAnnotations('0022-linking-with-a-hotspot.json');
    expect(annos[0].region).toEqual({ type: 'rect', x: 265, y: 661, w: 1260, h: 1239 });
    expect(annos[0].bodies.map((b) => b.kind)).toEqual(['text', 'resource']);
    expect(annos[0].bodies[1]).toMatchObject({ resourceType: 'Canvas', url: expect.stringContaining('canvas/p2') });
  });
  it('0135: 点', () => {
    const { annos } = firstCanvasAnnotations('0135-annotating-point-in-canvas.json');
    expect(annos[0].region).toEqual({ type: 'point', x: 3385, y: 1464 });
  });
  it('0258: 外部リソースのタグ', () => {
    const { annos } = firstCanvasAnnotations('0258-tagging-external-resource.json');
    expect(annos[0].region.type).toBe('rect');
    expect(annos[0].bodies[0]).toMatchObject({ kind: 'resource', url: 'http://www.wikidata.org/entity/Q18624915' });
    expect(annos[0].bodies[1]).toMatchObject({ kind: 'text', value: 'Gänseliesel-Brunnen' });
  });
  it('0261: SVG の多角形', () => {
    const { annos } = firstCanvasAnnotations('0261-non-rectangular-commenting.json');
    const r = annos[0].region;
    expect(r.type).toBe('polygon');
    if (r.type === 'polygon') {
      expect(r.rings[0].length).toBeGreaterThan(5);
      expect(r.bbox).toMatchObject({ x: 270, y: 661, w: 1260, h: 1239 });
    }
  });
  it('0464: Canvas を借りたマニフェストで、どの Canvas でもない URI を指す注釈は、その Canvas の全体に付く', () => {
    const { annos } = firstCanvasAnnotations('0464-reuse-manifest.json');
    expect(annos).toHaveLength(1);
    expect(annos[0].motivations).toContain('commenting');
    expect(annos[0].region.type).toBe('canvas');
    expect(annos[0].bodies[0]).toMatchObject({ value: 'Göttinger Marktplatz mit Gänseliesel Brunnen' });
  });

  it('マニフェストにある別の Canvas を指す注釈は、これまでどおり外す', () => {
    const page = { type: 'AnnotationPage', items: [{ id: 'a', type: 'Annotation', motivation: 'commenting', body: { type: 'TextualBody', value: 'x' }, target: 'https://example.org/c2' }] };
    const ids = new Set(['https://example.org/c1', 'https://example.org/c2']);
    expect(readCanvasAnnotations('https://example.org/c1', [page], undefined, ids)).toHaveLength(0);
    expect(readCanvasAnnotations('https://example.org/c2', [page], undefined, ids)).toHaveLength(1);
  });

  it('0266: Canvas 全体', () => {
    const { annos } = firstCanvasAnnotations('0266-full-canvas-annotation.json');
    expect(annos).toHaveLength(1);
    expect(annos[0].region).toEqual({ type: 'canvas' });
  });
  it('0299: 画像の一部を描く painting は、注釈としては出さない（画像側の担当）', () => {
    expect(firstCanvasAnnotations('0299-region.json').annos).toHaveLength(0);
  });
  it('0269 / 0306: 参照だけの AnnotationPage は取りに行く対象になる', () => {
    for (const name of ['0269-embedded-or-referenced-annotations.json', '0306-linking-annotations-to-manifests.json']) {
      const manifest = manifestOf(name);
      const canvas = manifest.items[0] as unknown as { id: string };
      const src = annotationSourcesOf(rawCanvasOf(manifest, canvas.id));
      expect(src.pages.filter((p) => !p.__painting)).toHaveLength(0);
      expect(src.references).toHaveLength(1);
    }
    const manifest = manifestOf('0269-embedded-or-referenced-annotations.json');
    const canvas = manifest.items[0] as unknown as { id: string };
    const page = load('0269-annotationpage.page.json');
    // the page of the recipe points at the Canvas of the same recipe; the ids must match
    const annos = readCanvasAnnotations(
      'https://iiif.io/api/cookbook/recipe/0269-embedded-or-referenced-annotations/canvas-1',
      [page],
    );
    expect(canvas.id).toBe('https://iiif.io/api/cookbook/recipe/0269-embedded-or-referenced-annotations/canvas-1');
    expect(annos).toHaveLength(1);
    expect(annos[0].bodies[0].value).toContain('Gänseliesel');
  });
  it('0309: AnnotationCollection のページと next', () => {
    const manifest = manifestOf('0309-annotation-collection.json');
    const canvas = manifest.items[0] as unknown as { id: string };
    const src = annotationSourcesOf(rawCanvasOf(manifest, canvas.id));
    expect(src.pages.filter((p) => !p.__painting)).toHaveLength(0);
    expect(src.references).toEqual([expect.stringContaining('anno_p1')]);
    const page = load('0309-anno_p1.page.json');
    expect(nextPageOf(page)).toMatch(/anno_p2/);
    const annos = readCanvasAnnotations(canvas.id, [page]);
    expect(annos.length).toBeGreaterThan(3);
    expect(annos[0].region.type).toBe('rect');
    // other Canvas' annotations are not mixed in
    expect(readCanvasAnnotations('https://example.org/other', [page])).toHaveLength(0);
  });
  it('0346: 多言語の本文（Choice）', () => {
    const { annos } = firstCanvasAnnotations('0346-multilingual-annotation-body.json');
    expect(annos[0].bodies).toHaveLength(2);
    expect(annos[0].bodies.every((b) => b.choice === 0)).toBe(true);
    expect(pickBodies(annos[0].bodies, 'ja')[0].value).toBe('袋に収められた琴');
    expect(pickBodies(annos[0].bodies, 'en')[0].value).toBe('Koto with a cover being carried');
    expect(pickBodies(annos[0].bodies, 'fr')).toHaveLength(1); // one per Choice
    expect(pickBodies(annos[0].bodies, 'fr')[0].value).toBe('Koto with a cover being carried');
  });
  it('0561: 画像の上に描くテキスト（painting）', () => {
    const { annos } = firstCanvasAnnotations('0561-text-on-image.json');
    expect(annos).toHaveLength(1);
    expect(annos[0]).toMatchObject({ painted: true, region: { type: 'rect', x: 5500, y: 12200 } });
  });
  it('supplementing: 画像の一部を指すもの（OCR の行）は出し、Canvas 全体のもの（字幕など）は出さない', () => {
    const c = 'https://example.org/canvas/1';
    const page = {
      type: 'AnnotationPage',
      items: [
        { id: 'a1', type: 'Annotation', motivation: 'supplementing', body: { type: 'TextualBody', value: '行' }, target: `${c}#xywh=10,20,30,40` },
        { id: 'a2', type: 'Annotation', motivation: 'supplementing', body: { type: 'TextualBody', value: '全体' }, target: c },
      ],
    };
    const annos = readCanvasAnnotations(c, [page]);
    expect(annos.map((a) => a.id)).toEqual(['a1']);
    expect(annos[0].region).toEqual({ type: 'rect', x: 10, y: 20, w: 30, h: 40 });
  });
});

describe('sanitizeAnnotationHtml', () => {
  it('許可したタグと https のリンクは残す', () => {
    const out = sanitizeAnnotationHtml("<p>a <a href='https://e.org/x?a=1&b=2'>link</a> <b>b</b></p>");
    expect(out).toContain('<p>a <a href="https://e.org/x?a=1&amp;b=2"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('<b>b</b>');
  });
  it('script・イベント属性・javascript: を除く', () => {
    expect(sanitizeAnnotationHtml('<p>x</p><script>alert(1)</script>')).toBe('<p>x</p>');
    expect(sanitizeAnnotationHtml('<img src="https://e.org/a.png" onerror="alert(1)">')).not.toMatch(/onerror/i);
    expect(sanitizeAnnotationHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript/i);
    expect(sanitizeAnnotationHtml('<a href="  JaVa\nScript:alert(1)">x</a>')).not.toMatch(/script/i);
    expect(sanitizeAnnotationHtml('<a href="&#106;avascript:alert(1)">x</a>')).not.toMatch(/javascript/i);
    expect(sanitizeAnnotationHtml('<img src="data:text/html;base64,AAAA">')).not.toMatch(/data:/);
    expect(sanitizeAnnotationHtml('<iframe src="https://e.org"></iframe>after')).toBe('after');
    expect(sanitizeAnnotationHtml('<svg onload=alert(1)><circle/></svg>ok')).toBe('ok');
    expect(sanitizeAnnotationHtml('<p style="background:url(x)" class="c">t</p>')).toBe('<p>t</p>');
  });
  it('閉じていないタグを閉じ、壊れた入れ子で外に出さない', () => {
    expect(sanitizeAnnotationHtml('<p><b>x')).toBe('<p><b>x</b></p>');
    expect(sanitizeAnnotationHtml('</div>x')).toBe('x');
    expect(sanitizeAnnotationHtml('a < b & c')).toContain('&amp;');
  });
});

describe('動画の時間と範囲（#t=…&xywh=…）', () => {
  const C = 'https://example.org/canvas';
  const page = (target: unknown) => ({
    type: 'AnnotationPage',
    items: [{ id: 'a', type: 'Annotation', motivation: 'tagging', body: { type: 'TextualBody', value: 'Person' }, target }],
  });
  const read = (target: unknown) => readCanvasAnnotations(C, [page(target)], { width: 640, height: 360 })[0];

  it('文字列の target から、範囲と時間の両方を読む', () => {
    const a = read(`${C}#t=22.916,23.916&xywh=360,34,234,255`);
    expect(a.region).toEqual({ type: 'rect', x: 360, y: 34, w: 234, h: 255 });
    expect(a.time).toEqual({ start: 22.916, end: 23.916 });
  });

  it('FragmentSelector が 2 つ（範囲と時間）に分かれていても読む', () => {
    const a = read({
      type: 'SpecificResource',
      source: C,
      selector: [
        { type: 'FragmentSelector', value: 't=5,6' },
        { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 'xywh=10,20,30,40' },
      ],
    });
    expect(a.region).toEqual({ type: 'rect', x: 10, y: 20, w: 30, h: 40 });
    expect(a.time).toEqual({ start: 5, end: 6 });
  });

  it('PointSelector の instant は、その一瞬として読む', () => {
    const a = read({ type: 'SpecificResource', source: C, selector: { type: 'PointSelector', x: 100, y: 50, instant: 12 } });
    expect(a.region).toEqual({ type: 'point', x: 100, y: 50 });
    expect(a.time).toEqual({ start: 12, instant: true });
    expect(isAnnotationAt(a, 12.5)).toBe(true);
    expect(isAnnotationAt(a, 13.5)).toBe(false);
  });

  it('終わりの無い #t=10 は、最後まで出る', () => {
    const a = read(`${C}#t=10&xywh=0,0,10,10`);
    expect(a.time).toEqual({ start: 10 });
    expect(isAnnotationAt(a, 9.9)).toBe(false);
    expect(isAnnotationAt(a, 1000)).toBe(true);
  });

  it('時間の範囲の中だけ出る（終わりの時刻は含まない）・時間の無い注釈はいつも出る', () => {
    const a = read(`${C}#t=5,6&xywh=0,0,10,10`);
    expect(isAnnotationAt(a, 4.99)).toBe(false);
    expect(isAnnotationAt(a, 5)).toBe(true);
    expect(isAnnotationAt(a, 6)).toBe(false);
    expect(read(`${C}#xywh=0,0,10,10`).time).toBeUndefined();
    expect(isAnnotationAt(read(`${C}#xywh=0,0,10,10`), 99)).toBe(true);
  });

  it('見本（ArchiveBase の Video Search から作ったマニフェスト）を読める', () => {
    const manifest = convertToV4(
      JSON.parse(readFileSync(join(__dirname, '../../../../../public/manifests/sample-manifest-video-objects.json'), 'utf8')),
    );
    const canvas = manifest.items[0] as unknown as { id: string; width: number; height: number };
    const annos = embeddedCanvasAnnotations(manifest, canvas.id, canvas);
    // 目で確かめて人の枠だけを残した数（scripts/video-objects-review.tsv の keep）
    expect(annos.length).toBe(27);
    expect(annos.every((x) => x.region.type === 'rect' && x.time && x.time.end! > x.time.start)).toBe(true);
  });
});

describe('Text Granularity', () => {
  it('keeps textGranularity (line, word) on OCR annotations', () => {
    const page = {
      type: 'AnnotationPage',
      items: [
        { id: 'l1', type: 'Annotation', motivation: 'supplementing', textGranularity: 'line', body: { type: 'TextualBody', value: 'a b' }, target: 'https://e.org/c1#xywh=0,0,10,2' },
        { id: 'w1', type: 'Annotation', motivation: 'supplementing', textGranularity: 'word', body: { type: 'TextualBody', value: 'a' }, target: 'https://e.org/c1#xywh=0,0,4,2' },
        { id: 'n1', type: 'Annotation', motivation: 'commenting', body: { type: 'TextualBody', value: 'note' }, target: 'https://e.org/c1#xywh=1,1,1,1' },
      ],
    };
    expect(readCanvasAnnotations('https://e.org/c1', [page]).map((a) => [a.id, a.granularity])).toEqual([
      ['l1', 'line'],
      ['w1', 'word'],
      ['n1', undefined],
    ]);
  });
});

describe('withReferenceLabels（0309: 参照の partOf にだけ名前がある）', () => {
  const ref = { id: 'p1.json', type: 'AnnotationPage', partOf: [{ id: 'coll.json', type: 'AnnotationCollection', label: { en: ['Layout'] }, total: 8 }] };
  it('取得したページの partOf に名前を足す', () => {
    const page = { id: 'p1.json', partOf: [{ id: 'coll.json', type: 'AnnotationCollection' }], items: [] };
    const out = withReferenceLabels(page, ref) as { partOf: { label: unknown; total: number }[] };
    expect(out.partOf[0].label).toEqual({ en: ['Layout'] });
    expect(out.partOf[0].total).toBe(8);
  });
  it('ページ自身の名前は上書きしない', () => {
    const page = { id: 'p1.json', partOf: [{ id: 'coll.json', label: { en: ['Own'] } }] };
    expect((withReferenceLabels(page, ref) as { partOf: { label: unknown }[] }).partOf[0].label).toEqual({ en: ['Own'] });
  });
});
