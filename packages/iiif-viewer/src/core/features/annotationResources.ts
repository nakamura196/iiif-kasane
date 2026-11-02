// annotationResources: an annotation's related resources (pictures of the place, Wikidata, Wikipedia, references),
// read into one classified list. React に依存しない。2D の注釈一覧と 3D の注釈カードが同じ部品で見せる。
//
// Two forms are read, and give the same list:
//  - bodies with a `purpose` (Region & Tag extension §5, the preferred form): an Image body (describing = a picture of
//    the place, linking = a related picture), a Wikidata body (identifying), a Wikipedia page or reference (linking);
//  - `seeAlso` as the 3D annotation editor writes it: Image items whose real file is in the non-standard `source`
//    (their `id` is not resolvable; always related pictures, as only the editor's RDF tells which show the place), Wikidata (Dataset), Wikipedia (Text) and bibliography (text/plain, no URL).

import { isImageBody, isResourceBody, type AnnotationBodyItem } from './annotationBody';
import { wikidataIdOf } from './wikidataLabel';

type Json = Record<string, unknown>;

export type AnnotationResourceKind = 'image' | 'wikidata' | 'wikipedia' | 'web' | 'citation';
/** place: a picture of the annotated place itself. identifying: what the region depicts. related: anything else. */
export type AnnotationResourceRole = 'place' | 'related' | 'identifying';

export interface AnnotationResource {
  kind: AnnotationResourceKind;
  role: AnnotationResourceRole;
  /** The page to open (not for a citation without an address; for an image, the file). */
  url?: string;
  /** A label as in the manifest (IIIF language map or string). A citation's text is its label. */
  label?: unknown;
  format?: string;
  /** image: the Image API service base URL (to request a thumbnail) */
  service?: string;
  /** image: the page that describes it (the holding institution's record) */
  homepage?: string;
  homepageLabel?: unknown;
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const idOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : isObj(v) ? str(v.id ?? v['@id']) : undefined);
const isWeb = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** The editor's own ids for an uploaded image or a bibliography record: they are not addresses of anything. */
export const isUnresolvableEditorId = (url: string | undefined): boolean =>
  !!url && /\/(?:media|bibliography)\/[0-9a-f]{8}-[0-9a-f-]{20,}\/?$/i.test(url);

const isWikipedia = (u: string) => /^https?:\/\/[a-z-]+\.(?:m\.)?wikipedia\.org\//i.test(u);

// A link or a text: Wikidata, Wikipedia, a web page, or a reference given as plain text.
const linkResource = (
  url: string | undefined,
  label: unknown,
  format: string | undefined,
  identifying: boolean,
): AnnotationResource | null => {
  const textOnly = format !== undefined && /^text\/plain/i.test(format);
  const open = isWeb(url) && !isUnresolvableEditorId(url) && !textOnly ? url : undefined;
  if (!open) {
    // a reference as plain text: its label is the text. Without one there is nothing to show.
    const has = typeof label === 'string' ? label : label !== undefined && label !== null;
    return has ? { kind: 'citation', role: 'related', label, ...(format ? { format } : {}) } : null;
  }
  if (wikidataIdOf(open)) return { kind: 'wikidata', role: 'identifying', url: open, ...(label !== undefined ? { label } : {}) };
  const role: AnnotationResourceRole = identifying ? 'identifying' : 'related';
  return {
    kind: isWikipedia(open) ? 'wikipedia' : 'web',
    role,
    url: open,
    ...(label !== undefined ? { label } : {}),
    ...(format ? { format } : {}),
  };
};

const fromBody = (b: AnnotationBodyItem): AnnotationResource | null => {
  if (isImageBody(b)) {
    if (!b.url) return null;
    return {
      kind: 'image',
      role: b.purpose === 'linking' ? 'related' : 'place',
      url: b.url,
      ...(b.label !== undefined ? { label: b.label } : {}),
      ...(b.format ? { format: b.format } : {}),
      ...(b.service ? { service: b.service } : {}),
      ...(b.homepage ? { homepage: b.homepage } : {}),
      ...(b.homepageLabel !== undefined ? { homepageLabel: b.homepageLabel } : {}),
    };
  }
  return linkResource(b.url, b.label, b.format, b.purpose === 'identifying');
};

const fromSeeAlso = (item: unknown): AnnotationResource | null => {
  if (typeof item === 'string') return linkResource(item, undefined, undefined, false);
  if (!isObj(item)) return null;
  const id = idOf(item);
  const format = str(item.format);
  if (item.type === 'Image' || /^image\//i.test(format ?? '')) {
    // the editor keeps the real file in `source` (its own `id` does not resolve)
    const source = idOf(item.source);
    const url = source ?? (isUnresolvableEditorId(id) ? undefined : id);
    if (!isWeb(url)) return null;
    // A seeAlso picture does not say whether it shows the place: it may be another object (a comparison, a typology).
    // Only the editor's RDF tells, so it is a related resource (Region & Tag extension §7.4).
    return {
      kind: 'image',
      role: 'related',
      url,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(format ? { format } : {}),
    };
  }
  return linkResource(id, item.label, format, false);
};

const keyOf = (r: AnnotationResource): string =>
  r.url ?? (typeof r.label === 'string' ? r.label : JSON.stringify(r.label ?? ''));

const ORDER: Record<AnnotationResourceKind, number> = { image: 0, wikidata: 1, wikipedia: 2, web: 3, citation: 4 };

/**
 * The related resources of an annotation, from its resource bodies and its `seeAlso`: pictures of the place first,
 * then what the region depicts, then the related ones (pictures, Wikipedia, web pages, references). Duplicates
 * (the same address, or the same text) are dropped.
 */
export const readAnnotationResources = (bodies: AnnotationBodyItem[], seeAlso?: unknown): AnnotationResource[] => {
  const all = [
    ...bodies.filter(isResourceBody).map(fromBody),
    ...asList(seeAlso).map(fromSeeAlso),
  ].filter((r): r is AnnotationResource => r !== null);
  const seen = new Set<string>();
  const unique = all.filter((r) => {
    const k = `${r.kind === 'image' ? 'image' : 'link'}|${keyOf(r)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rank = (r: AnnotationResource) => (r.role === 'place' ? 0 : r.role === 'identifying' ? 1 : 2);
  return unique
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || ORDER[a.r.kind] - ORDER[b.r.kind] || a.i - b.i)
    .map(({ r }) => r);
};
