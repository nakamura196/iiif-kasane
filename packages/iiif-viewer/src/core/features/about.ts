// about: 資料についての情報（権利・提供者・リンク・日時・場所・多言語のメタデータ）の読み取り。
// React に依存しない。この機能の担当だけがこのファイルを書く。
import type { ManifestV4 } from '../types/iiif';
import { labelIn } from '../services/paintedModels';
import { keysInOrder, uiLanguage } from '../services/contentLanguage';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// ---------------------------------------------------------------------------
// HTML の無害化（許可リスト方式）
// ---------------------------------------------------------------------------
// Presentation 3 が値に許す HTML は a, b, br, i, img, p, small, span, sub, sup だけ。
// ここでは、それ以外のタグは外し（中の文字は残す）、script / style などは中身ごと捨てる。
// 属性は a の href、img の src・alt・width・height、全体の lang だけを残す。
// href / src は http・https・mailto と、スキームの無い相対 URL だけを通す。

const ALLOWED_TAGS = new Set(['a', 'b', 'br', 'i', 'img', 'p', 'small', 'span', 'sub', 'sup']);
const VOID_TAGS = new Set(['br', 'img']);
// 許さないが、区切りのあるタグ。タグを外すと前後の文字がつながる（"項目1項目2"）ので、改行を入れる。
// Presentation 3 の範囲外だが、Wellcome の Auth の note などは <ul><li> で書かれている
const BREAK_TAGS = new Set([
  'li', 'ul', 'ol', 'div', 'dt', 'dd', 'dl', 'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
// 中身ごと捨てるタグ
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'textarea', 'title', 'svg', 'math',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

/** A URL that is safe to put in href / src: http, https, mailto, or relative. Else ''. */
export const safeAboutUrl = (raw: string): string => {
  // 実体参照や制御文字で scheme を隠す手口（&#106;avascript: / java\tscript:）を先に外す
  const url = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (!url) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme) return /^(https?|mailto)$/i.test(scheme[1]) ? url : '';
  // スキームの無い形。"//host" は許す。":" で始まるなどの変な形は捨てる。
  return /^[^:]*(?:[/?#].*)?$/.test(url) && !url.startsWith(':') ? url : '';
};

const parseAttributes = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
};

const attributesFor = (tag: string, attrs: Record<string, string>): string => {
  let out = '';
  if (attrs.lang && /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(attrs.lang)) out += ` lang="${escapeAttr(attrs.lang)}"`;
  if (tag === 'a') {
    const href = safeAboutUrl(attrs.href ?? '');
    if (href) out += ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"`;
  }
  if (tag === 'img') {
    const src = safeAboutUrl(attrs.src ?? '');
    if (src && !/^mailto:/i.test(src)) out += ` src="${escapeAttr(src)}"`;
    if (attrs.alt !== undefined) out += ` alt="${escapeAttr(attrs.alt)}"`;
    for (const k of ['width', 'height']) {
      if (/^\d{1,5}$/.test(attrs[k] ?? '')) out += ` ${k}="${attrs[k]}"`;
    }
  }
  return out;
};

/** Reduce an HTML string from a manifest to the safe subset. The result is HTML. */
export const sanitizeAboutHtml = (html: unknown): string => {
  if (typeof html !== 'string' || !html) return '';
  const src = html;
  const out: string[] = [];
  const open: string[] = [];
  let i = 0;
  let dropUntil: string | null = null;
  let pendingBreak = false;
  // 文字や許したタグを足す。外した区切りのタグの後で、直前が段落の切れ目でなければ改行を挟む
  const push = (piece: string) => {
    if (pendingBreak && piece.trim()) {
      const last = out[out.length - 1];
      if (last && !/^(<br>|<p[ >]|<\/p>)/.test(last)) out.push('<br>');
      pendingBreak = false;
    }
    out.push(piece);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (!dropUntil) push(escapeTextKeepEntities(src.slice(i)));
      break;
    }
    if (lt > i && !dropUntil) push(escapeTextKeepEntities(src.slice(i, lt)));
    // コメント
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(lt, lt + 40));
    if (!m) {
      // "<" の後がタグの形でない: 文字として扱う（"<!doctype" や "<?" も、ここで捨てる）
      if (/^<[!?]/.test(src.slice(lt, lt + 2))) {
        const end = src.indexOf('>', lt);
        i = end < 0 ? src.length : end + 1;
      } else {
        if (!dropUntil) push('&lt;');
        i = lt + 1;
      }
      continue;
    }
    // タグの終わり（引用符の中の ">" を飛ばす）
    let j = lt + m[0].length;
    let quote = '';
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const attrSrc = src.slice(lt + m[0].length, j);
    i = j < src.length ? j + 1 : src.length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (dropUntil) {
      if (closing && tag === dropUntil) dropUntil = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(attrSrc)) dropUntil = tag;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // タグだけ外して中の文字は残す。区切りのタグなら、次に文字が来たときに改行を入れる
      if (BREAK_TAGS.has(tag)) pendingBreak = true;
      continue;
    }
    if (closing) {
      const k = open.lastIndexOf(tag);
      if (k >= 0 && !VOID_TAGS.has(tag)) {
        while (open.length > k) out.push(`</${open.pop()}>`);
      }
      continue;
    }
    push(`<${tag}${attributesFor(tag, parseAttributes(attrSrc))}>`);
    if (!VOID_TAGS.has(tag)) open.push(tag);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
};

// 文字の部分: "&amp;" のような正しい実体参照は残し、単独の & と < > は escape する。
const escapeTextKeepEntities = (s: string): string =>
  s
    .replace(/&(?!(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** HTML to plain text (for tooltips, titles and tests). */
export const htmlToText = (html: unknown): string =>
  decodeEntities(sanitizeAboutHtml(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();

// ---------------------------------------------------------------------------
// 多言語の文字列
// ---------------------------------------------------------------------------

// Presentation 2 の書き方（"text" / {"@value","@language"} / その配列）も読む。
const v2Values = (v: unknown): string[] =>
  asList(v)
    .map((e) => (isObj(e) ? str(e['@value']) : typeof e === 'string' ? e : undefined))
    .filter((e): e is string => !!e);

/** All the strings of a language map in the reader's language (locale, none, en, then any). */
export const valuesIn = (map: unknown, locale: string): string[] => {
  if (typeof map === 'string') return map ? [map] : [];
  if (Array.isArray(map)) return v2Values(map);
  if (!isObj(map)) return [];
  if ('@value' in map) return v2Values(map);
  const lang = keysInOrder(map, locale).find((k) => {
    const v = map[k];
    return Array.isArray(v) ? v.some((e) => typeof e === 'string' && e) : typeof v === 'string' && !!v;
  });
  if (!lang) return [];
  return asList(map[lang]).filter((e): e is string => typeof e === 'string' && !!e);
};

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface AboutMetadataItem {
  label: string;
  /** Plain text. */
  values: string[];
  /** The same values as safe HTML (see sanitizeAboutHtml). */
  html: string[];
}

export interface AboutLink {
  id: string;
  label: string;
  type?: string;
  format?: string;
}

export interface AboutAgent {
  id?: string;
  label: string;
  homepage: AboutLink[];
  logos: string[];
}

export interface AboutPlace {
  label: string;
  geometry: string; // Point / Polygon / ...
  /** [lat, lng] of the point, or of the middle of the bounding box. */
  center: { lat: number; lng: number };
  /** [west, south, east, north] when the shape is not a single point. */
  bbox?: [number, number, number, number];
  /** Number of vertices. */
  points: number;
  /** A link that opens the place in OpenStreetMap. */
  url: string;
  /** The target of a place given as a tagging Annotation (e.g. a canvas region). */
  target?: string;
  source: 'navPlace' | 'annotation';
}

export interface AboutDate {
  /** As written in the manifest. */
  iso: string;
  /** Readable form in the reader's language. */
  text: string;
}

export interface AboutScope {
  id: string;
  type: string;
  label: string;
  /** Safe HTML. */
  summary: string[];
  metadata: AboutMetadataItem[];
  requiredStatement?: AboutMetadataItem;
  rights?: { url: string; label: string };
  providers: AboutAgent[];
  homepage: AboutLink[];
  rendering: AboutLink[];
  seeAlso: AboutLink[];
  partOf: AboutLink[];
  thumbnails: string[];
  navDate?: AboutDate;
  places: AboutPlace[];
}

export interface AboutInfo {
  manifest: AboutScope;
  /** The container (Canvas / Scene / Timeline) that is shown. */
  container?: AboutScope;
  /** Ranges that carry their own metadata. */
  ranges: AboutScope[];
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

const metadataItem = (raw: unknown, locale: string): AboutMetadataItem | null => {
  if (!isObj(raw)) return null;
  const values = valuesIn(raw.value, locale);
  const label = valuesIn(raw.label, locale).join(' ');
  if (!label && values.length === 0) return null;
  return { label, values: values.map(htmlToText), html: values.map(sanitizeAboutHtml) };
};

const linkOf = (raw: unknown, locale: string): AboutLink | null => {
  const r = isObj(raw) ? raw : undefined;
  const id = str(typeof raw === 'string' ? raw : (r?.id ?? r?.['@id']));
  if (!id) return null;
  const label = htmlToText(labelIn(r?.label, locale)) || id;
  const link: AboutLink = { id, label };
  if (str(r?.type)) link.type = r?.type as string;
  if (str(r?.format)) link.format = r?.format as string;
  return link;
};

const linksOf = (v: unknown, locale: string): AboutLink[] =>
  asList(v).map((e) => linkOf(e, locale)).filter((e): e is AboutLink => !!e);

const agentOf = (raw: unknown, locale: string): AboutAgent | null => {
  if (!isObj(raw)) return null;
  const logos = asList(raw.logo)
    .map((l) => str(isObj(l) ? l.id : l))
    .filter((l): l is string => !!l && !!safeAboutUrl(l));
  const label = htmlToText(labelIn(raw.label, locale));
  const id = str(raw.id);
  if (!label && !id && logos.length === 0) return null;
  return { id, label: label || id || '', homepage: linksOf(raw.homepage, locale), logos };
};

const dateText = (iso: string, locale: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  try {
    return new Intl.DateTimeFormat(uiLanguage(locale), {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(midnight ? {} : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' as const }),
    }).format(d);
  } catch {
    return iso;
  }
};

const coordsOf = (geometry: Json): [number, number][] => {
  const out: [number, number][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180) {
        out.push([c[0], c[1]]);
      }
      return;
    }
    c.forEach(walk);
  };
  if (geometry.type === 'GeometryCollection') asList(geometry.geometries).forEach((g) => isObj(g) && out.push(...coordsOf(g)));
  else walk(geometry.coordinates);
  return out;
};

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

const osmUrl = (lat: number, lng: number, bbox?: [number, number, number, number]): string => {
  let zoom = 15;
  if (bbox) {
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1], 1e-6);
    zoom = Math.max(1, Math.min(18, Math.floor(Math.log2(360 / span))));
  }
  const base = 'https://www.openstreetmap.org/';
  return `${base}?mlat=${round(lat)}&mlon=${round(lng)}#map=${zoom}/${round(lat)}/${round(lng)}`;
};

const placeOf = (
  feature: Json,
  locale: string,
  source: AboutPlace['source'],
  target?: string,
): AboutPlace | null => {
  const geometry = isObj(feature.geometry) ? feature.geometry : null;
  if (!geometry) return null;
  const pts = coordsOf(geometry);
  if (pts.length === 0) return null;
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const single = pts.length === 1;
  const center = { lat: (south + north) / 2, lng: (west + east) / 2 };
  const props = isObj(feature.properties) ? feature.properties : {};
  const label = htmlToText(labelIn(props.label, locale));
  const bbox: [number, number, number, number] | undefined = single ? undefined : [west, south, east, north];
  const place: AboutPlace = {
    label,
    geometry: String(geometry.type ?? ''),
    center,
    points: pts.length,
    url: osmUrl(center.lat, center.lng, bbox),
    source,
  };
  if (bbox) place.bbox = bbox;
  if (target) place.target = target;
  return place;
};

// A navPlace value is a FeatureCollection, a Feature, or a list of them.
export const geoFeaturesOf = (v: unknown): Json[] => {
  const out: Json[] = [];
  for (const e of asList(v)) {
    if (!isObj(e)) continue;
    if (e.type === 'FeatureCollection') out.push(...asList(e.features).filter(isObj));
    else if (e.type === 'Feature') out.push(e);
  }
  return out;
};

// Control points of a georeferenced picture pair image coordinates with map coordinates;
// they are not places of the item, so they must not be listed as places.
export const isGeoreferencing = (anno: Json): boolean => asList(anno.motivation).includes('georeferencing');

// A tagging Annotation whose body is a GeoJSON Feature (recipe 0139).
const annotationPlaces = (container: Json, locale: string): AboutPlace[] => {
  const out: AboutPlace[] = [];
  for (const page of asList(container.annotations)) {
    if (!isObj(page)) continue;
    for (const anno of asList(page.items)) {
      if (!isObj(anno) || isGeoreferencing(anno)) continue;
      const target = typeof anno.target === 'string' ? anno.target : isObj(anno.target) ? str(anno.target.id) : undefined;
      const fragment = target?.includes('#') ? target.slice(target.indexOf('#')) : undefined;
      for (const body of geoFeaturesOf(anno.body)) {
        const p = placeOf(body, locale, 'annotation', fragment);
        if (p) out.push(p);
      }
    }
  }
  return out;
};

const scopeOf = (raw: Json, locale: string, withAnnotations: boolean): AboutScope => {
  const metadata = asList(raw.metadata)
    .map((m) => metadataItem(m, locale))
    .filter((m): m is AboutMetadataItem => !!m);

  let requiredStatement = metadataItem(raw.requiredStatement, locale) ?? undefined;
  if (!requiredStatement && raw.attribution) {
    // Presentation 2
    const values = valuesIn(raw.attribution, locale);
    if (values.length) requiredStatement = { label: '', values: values.map(htmlToText), html: values.map(sanitizeAboutHtml) };
  }

  const rightsRaw = str(raw.rights) ?? str(raw.license);
  const rights = rightsRaw ? { url: rightsRaw, label: rightsRaw } : undefined;

  const providers = asList(raw.provider)
    .map((a) => agentOf(a, locale))
    .filter((a): a is AboutAgent => !!a);
  // Presentation 2: a logo on the resource itself
  const v2Logos = asList(raw.logo)
    .map((l) => str(isObj(l) ? (l.id ?? l['@id']) : l))
    .filter((l): l is string => !!l && !!safeAboutUrl(l));
  if (providers.length === 0 && v2Logos.length) providers.push({ label: '', homepage: [], logos: v2Logos });

  const thumbnails = asList(raw.thumbnail)
    .map((t) => str(isObj(t) ? (t.id ?? t['@id']) : t))
    .filter((t): t is string => !!t && /^https?:\/\//i.test(safeAboutUrl(t)));

  const navDateRaw = str(raw.navDate);
  const places = geoFeaturesOf(raw.navPlace)
    .map((f) => placeOf(f, locale, 'navPlace'))
    .filter((p): p is AboutPlace => !!p);
  if (withAnnotations) places.push(...annotationPlaces(raw, locale));

  const summaryVals = valuesIn(raw.summary, locale);
  const description = summaryVals.length ? summaryVals : valuesIn(raw.description, locale); // v2

  return {
    id: str(raw.id) ?? str(raw['@id']) ?? '',
    type: str(raw.type) ?? str(raw['@type']) ?? '',
    label: htmlToText(labelIn(raw.label, locale)) || valuesIn(raw.label, locale).map(htmlToText).join(' '),
    summary: description.map(sanitizeAboutHtml),
    metadata,
    requiredStatement,
    rights,
    providers,
    homepage: linksOf(raw.homepage, locale).concat(linksOf(raw.related, locale)),
    rendering: linksOf(raw.rendering, locale),
    seeAlso: linksOf(raw.seeAlso, locale),
    partOf: linksOf(raw.partOf, locale),
    thumbnails,
    navDate: navDateRaw ? { iso: navDateRaw, text: dateText(navDateRaw, locale) } : undefined,
    places,
  };
};

// full=false: 資料全体の説明・メタデータ・サムネイルは「メタデータ」タブにあるので数えない。
const hasContent = (s: AboutScope, full: boolean): boolean =>
  !!(
    (full && (s.summary.length || s.metadata.length || s.thumbnails.length)) ||
    s.requiredStatement ||
    s.rights ||
    s.providers.length ||
    s.homepage.length ||
    s.rendering.length ||
    s.seeAlso.length ||
    s.partOf.length ||
    s.navDate ||
    s.places.length
  );

/** Whether one scope has something to show (full=false leaves out what the Metadata tab shows). */
export const aboutScopeHasContent = (s: AboutScope, full = true): boolean => hasContent(s, full);

/** Whether there is anything for the "about" tab to show. */
export const aboutHasContent = (info: AboutInfo): boolean =>
  hasContent(info.manifest, false) || (!!info.container && hasContent(info.container, true)) || info.ranges.length > 0;

const collectRanges = (v: unknown, locale: string, out: AboutScope[], depth = 0): void => {
  if (depth > 20) return;
  for (const r of asList(v)) {
    if (!isObj(r) || r.type !== 'Range') continue;
    const s = scopeOf(r, locale, false);
    // Range の items にぶら下がる Range も辿る
    if (s.metadata.length || s.summary.length || s.rights || s.requiredStatement || s.navDate || s.places.length) out.push(s);
    collectRanges(r.items, locale, out, depth + 1);
  }
};

/**
 * What the manifest (and the shown container) say about the resource.
 * `containerId` is the id of the Canvas / Scene / Timeline that is shown.
 */
export const aboutOf = (
  manifest: ManifestV4 | null | undefined,
  containerId: string | undefined,
  locale: string,
): AboutInfo | null => {
  if (!isObj(manifest)) return null;
  const m = manifest as unknown as Json;
  const info: AboutInfo = { manifest: scopeOf(m, locale, false), ranges: [] };
  const container = asList(m.items).find((c) => isObj(c) && c.id === containerId);
  if (isObj(container)) info.container = scopeOf(container, locale, true);
  collectRanges(m.structures, locale, info.ranges);
  return info;
};
