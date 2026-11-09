import { upgrade } from '@iiif/parser/upgrader';

// Presentation 2 の manifest / collection を 3 に変換する（3 以降はそのまま返す）。
// 変換そのものは IIIF の公式ライブラリ（@iiif/parser の upgrader）に任せる。
//
// ただし upgrader は、oa:Choice に format や画像らしい @id（.jpg 等）があると、
// 型を「Image」と判定して候補を 1 つに潰してしまう（@iiif/parser 4.0.3 で確認）。
// 東京大学のシェリー書簡（https://utda.github.io/shelley/iiif/shelley/manifest.json）が
// まさにこの形で、元画像と透過光画像の切り替えが消える。そこで変換の前に、
// Choice の型判定を誤らせる 2 つだけを外しておく。

const IMAGE_ID = /\.(jpe?g|png)$/;

type Json = Record<string, unknown>;

function fixChoices(v: unknown): void {
  if (Array.isArray(v)) {
    v.forEach(fixChoices);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  const o = v as Json;
  if (o['@type'] === 'oa:Choice') {
    delete o.format;
    // 候補の 1 つ（default）と同じ @id が付いていることが多い。Choice 自身の id として残すため、断片を足す
    if (typeof o['@id'] === 'string' && IMAGE_ID.test(o['@id'])) o['@id'] = `${o['@id']}#choice`;
  }
  Object.values(o).forEach(fixChoices);
}

// upgrader は、related / seeAlso / rendering が URL の文字列だと、URL を捨てて
// 「http://example.org/undefined/1」「type: unknown」の仮の値に置き換える（@iiif/parser 4.0.3 で確認）。
// さらに related は先頭の 1 件だけを、仮の provider の homepage に入れる。
// そこで文字列は { @id } の形にそろえ、資料全体の related は upgrader に渡さず、3 の homepage として自分で付ける。
const LINK_KEYS = ['related', 'seeAlso', 'rendering'];
const LINK_TYPES: Record<string, string> = { homepage: 'Text', rendering: 'Text', seeAlso: 'Dataset' };

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const linkObject = (e: unknown): unknown => (typeof e === 'string' ? { '@id': e } : e);

function fixLinkStrings(v: unknown): void {
  if (Array.isArray(v)) {
    v.forEach(fixLinkStrings);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  const o = v as Json;
  for (const key of LINK_KEYS) if (o[key] != null) o[key] = asList(o[key]).map(linkObject);
  Object.values(o).forEach(fixLinkStrings);
}

const homepageOf = (related: unknown): Json[] =>
  asList(related).flatMap((e) => {
    if (typeof e !== 'object' || e === null) return [];
    const r = e as Json;
    const id = r['@id'] ?? r.id;
    if (typeof id !== 'string' || !id) return [];
    const link: Json = { id, type: 'Text' };
    if (typeof r.label === 'string' && r.label) link.label = { none: [r.label] };
    if (typeof r.format === 'string' && r.format) link.format = r.format;
    return [link];
  });

// 仮の type: unknown を、その欄で普通に使う型に直す
function fixUnknownTypes(v: unknown): void {
  if (Array.isArray(v)) {
    v.forEach(fixUnknownTypes);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  const o = v as Json;
  for (const [key, type] of Object.entries(LINK_TYPES)) {
    for (const e of asList(o[key])) {
      if (typeof e === 'object' && e !== null && (e as Json).type === 'unknown') (e as Json).type = type;
    }
  }
  Object.values(o).forEach(fixUnknownTypes);
}

// 画像の本体（images[].resource）の @type が dctypes:Image でなく oa:Annotation と書かれた manifest がある
// （青森県立図書館、musetheque.jp 系）。仕様は dctypes:Image を推奨（should）にとどめるので誤りとは言えないが、
// upgrader は型で画像かどうかを決めるため、このままだと本体が画像として扱われず「この画像はありません」になる。
// 画像サービスを持つか、format が image/* のときだけ dctypes:Image に直す。他の種類の resource には触れない。
function fixImageBodies(v: unknown): void {
  if (Array.isArray(v)) {
    v.forEach(fixImageBodies);
    return;
  }
  if (typeof v !== 'object' || v === null) return;
  const o = v as Json;
  if (Array.isArray(o.images)) {
    for (const img of o.images) {
      const r = (img as Json | null)?.resource as Json | undefined;
      if (typeof r !== 'object' || r === null || r['@type'] !== 'oa:Annotation') continue;
      const isImage = r.service != null || (typeof r.format === 'string' && r.format.startsWith('image/'));
      if (isImage) r['@type'] = 'dctypes:Image';
    }
  }
  Object.values(o).forEach(fixImageBodies);
}

const V2_CONTEXTS = ['http://iiif.io/api/presentation/2/context.json', 'http://www.shared-canvas.org/ns/context.json'];

/** Presentation 2 の manifest / collection か（upgrader 自身の判定と同じ基準）。 */
export const isPresentation2 = (json: unknown): boolean => {
  if (typeof json !== 'object' || json === null) return false;
  const o = json as Json;
  const ctx = Array.isArray(o['@context']) ? o['@context'] : [o['@context']];
  if (ctx.some((c) => V2_CONTEXTS.includes(c as string))) return true;
  return typeof o['@id'] === 'string' && (o['@type'] === 'sc:Manifest' || o['@type'] === 'sc:Collection');
};

// 2 のときだけ upgrader に渡す。upgrader は 4 の Scene を扱えない（型の上でも 3 を返す）ので、
// 3 / 4 の manifest は通さない。
export const upgradeToV3 = (json: unknown): unknown => {
  if (!isPresentation2(json)) return json;
  fixChoices(json);
  fixImageBodies(json);
  fixLinkStrings(json);
  const o = json as Json;
  const homepage = homepageOf(o.related);
  delete o.related;
  const out = upgrade(json) as unknown as Json;
  if (homepage.length) out.homepage = [...asList(out.homepage), ...homepage];
  fixUnknownTypes(out);
  return out;
};
