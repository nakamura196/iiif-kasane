// annotationBody: 注釈 1 件の本文の読み方（見出し・本文・タグ・画像・リンク）。2D の注釈一覧と 3D の注釈一覧の両方が使う。
// React に依存しない。本文は言語を決めずに読み、言語は表示や 3D の注釈を作るときに選ぶ（pickBodies）。

import type { AnnotationImage, AnnotationTag } from '../types/main';
import { labelIn } from '../services/paintedModels';

type Json = Record<string, unknown>;

export interface AnnotationBodyItem {
  kind: 'text' | 'resource';
  /** text: the value (plain text or HTML, see `format`) */
  value?: string;
  format?: string;
  language?: string;
  /** resource: the address of the thing linked or tagged */
  url?: string;
  resourceType?: string;
  /**
   * A label given by the body, as in the manifest (IIIF language map or string). For a resource, its name;
   * for a tag, the tag's key (Keyed Tag extension).
   */
  label?: unknown;
  /** text: the body's purpose is tagging */
  tagging?: true;
  /** resource: the W3C purpose, when it is 'linking' (a related resource) or 'describing' */
  purpose?: 'linking' | 'describing';
  /** resource: the IIIF Image API service base URL (to request a thumbnail) */
  service?: string;
  /** resource: the page that describes it (the holding institution's record), and that page's label */
  homepage?: string;
  homepageLabel?: unknown;
  /** Items of one Choice (for example one per language) share the same number. */
  choice?: number;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const idOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : str(isObj(v) ? v.id ?? v['@id'] : undefined));

/** A label may be a plain string, a list of strings or a IIIF language map: the reader's locale first. */
export const localizedString = (label: unknown, locale: string): string =>
  Array.isArray(label) ? label.map(String).join(' ') : labelIn(label, locale);

const hasPurpose = (body: Json, purpose: string): boolean =>
  Array.isArray(body.purpose) ? body.purpose.includes(purpose) : body.purpose === purpose;

const isTagging = (body: Json): boolean => hasPurpose(body, 'tagging');

// A body without a purpose takes the annotation's motivation (W3C Web Annotation §3.3.5). Only an annotation
// whose sole motivation is tagging makes such bodies tags: with several motivations it is unclear which one applies.
const tagsByMotivation = (anno: Json): boolean => {
  const m = asList(anno.motivation);
  return m.length > 0 && m.every((x) => x === 'tagging');
};
const isTagIn = (body: Json, byMotivation: boolean): boolean =>
  isTagging(body) || (byMotivation && body.purpose == null);

// What a linked resource says about itself: purpose, Image API service, homepage (§5 Images in an annotation,
// Region & Tag extension draft).
const resourceDetails = (body: Json, src: Json): Partial<AnnotationBodyItem> => {
  const service = asList(src.service).find(isObj);
  const homepage = asList(src.homepage).find(isObj);
  const serviceId = idOf(service);
  const purpose = hasPurpose(body, 'linking') ? 'linking' : hasPurpose(body, 'describing') ? 'describing' : undefined;
  return {
    ...(purpose ? { purpose } : {}),
    ...(serviceId ? { service: serviceId.replace(/\/info\.json$/, '') } : {}),
    ...(str(homepage?.id) ? { homepage: str(homepage?.id) } : {}),
    ...(homepage?.label !== undefined ? { homepageLabel: homepage.label } : {}),
  };
};

const bodyItems = (
  body: unknown,
  out: AnnotationBodyItem[],
  counter: { n: number },
  byMotivation: boolean,
  choice?: number,
): void => {
  for (const raw of asList(body)) {
    if (typeof raw === 'string') {
      out.push({ kind: 'resource', url: raw, ...(choice !== undefined ? { choice } : {}) });
      continue;
    }
    if (!isObj(raw)) continue;
    const c = choice !== undefined ? { choice } : {};
    if (raw.type === 'Choice') {
      bodyItems(raw.items, out, counter, byMotivation, counter.n++);
    } else if (raw.type === 'TextualBody' || (raw.value !== undefined && raw.type !== 'SpecificResource')) {
      const value = str(raw.value) ?? '';
      if (!value) continue;
      out.push({
        kind: 'text',
        value,
        format: str(raw.format),
        language: str(raw.language),
        ...(raw.label !== undefined ? { label: raw.label } : {}),
        ...(isTagIn(raw, byMotivation) ? { tagging: true } : {}),
        ...c,
      });
    } else if (raw.type === 'SpecificResource' && isObj(raw.source) && raw.source.type === 'TextualBody') {
      // a styled text (recipe 0045): the TextualBody is wrapped in a SpecificResource that carries the styleClass
      const value = str(raw.source.value) ?? '';
      if (!value) continue;
      out.push({ kind: 'text', value, format: str(raw.source.format), language: str(raw.source.language), ...c });
    } else if (raw.type === 'SpecificResource') {
      const url = idOf(raw.source);
      if (!url) continue;
      const src = isObj(raw.source) ? raw.source : {};
      out.push({
        kind: 'resource',
        url,
        resourceType: str(src.type),
        label: src.label ?? raw.label,
        format: str(src.format),
        ...resourceDetails(raw, src),
        ...c,
      });
    } else {
      const url = idOf(raw);
      if (!url) continue;
      out.push({
        kind: 'resource',
        url,
        resourceType: str(raw.type),
        label: raw.label,
        format: str(raw.format),
        ...resourceDetails(raw, raw),
        ...c,
      });
    }
  }
};

/**
 * The bodies of an annotation, in order, with every alternative of a Choice kept (pick one with pickBodies).
 * A `bodyValue` (the short form of a single text body) comes first. When the annotation's only motivation is
 * tagging, its text bodies without a purpose are tags.
 */
export const readAnnotationBodies = (anno: Json): AnnotationBodyItem[] => {
  const out: AnnotationBodyItem[] = [];
  const bodyValue = str(anno.bodyValue);
  if (bodyValue) out.push({ kind: 'text', value: bodyValue });
  bodyItems(anno.body, out, { n: 0 }, tagsByMotivation(anno));
  return out;
};

/**
 * The heading of an annotation (IIIF language map or string): its own label, else the label of the first body
 * that is not a tag (the older convention, as the 3D annotation editor writes it).
 */
export const annotationTitleOf = (anno: Json): unknown => {
  if (anno.label !== undefined) return anno.label;
  const byMotivation = tagsByMotivation(anno);
  for (const b of asList(anno.body)) {
    if (isObj(b) && b.type === 'TextualBody' && !isTagIn(b, byMotivation)) return b.label;
  }
  return undefined;
};

// Among the alternatives of a Choice, the one in the wanted language (else the first).
// Items outside a Choice are all kept, in order.
export const pickBodies = (bodies: AnnotationBodyItem[], locale: string): AnnotationBodyItem[] => {
  const out: AnnotationBodyItem[] = [];
  const groups = new Map<number, AnnotationBodyItem[]>();
  for (const b of bodies) {
    if (b.choice === undefined) {
      out.push(b);
      continue;
    }
    const g = groups.get(b.choice);
    if (g) g.push(b);
    else {
      groups.set(b.choice, [b]);
      out.push(b); // placeholder, replaced below
    }
  }
  return out.map((b) => {
    if (b.choice === undefined) return b;
    const g = groups.get(b.choice) ?? [b];
    const lang = (l?: string) => l?.toLowerCase().split('-')[0];
    return g.find((x) => lang(x.language) === lang(locale)) ?? g[0];
  });
};

/** The description of an annotation: its first text that is not a tag. */
export const mainTextBody = (bodies: AnnotationBodyItem[]): AnnotationBodyItem | undefined =>
  bodies.find((b) => b.kind === 'text' && !b.tagging);

/** A tagging body as a tag; its label is the tag's key (Keyed Tag extension). */
export const isTagBody = (b: AnnotationBodyItem): boolean => b.kind === 'text' && b.tagging === true;

export const tagOfBody = (b: AnnotationBodyItem, locale: string): AnnotationTag => {
  const key = localizedString(b.label, locale);
  return key ? { key, value: b.value ?? '' } : { value: b.value ?? '' };
};

/** A picture in the annotation (recipe 0377): an Image resource, or a resource whose format is an image. */
export const isImageBody = (b: AnnotationBodyItem): boolean =>
  b.kind === 'resource' && (b.resourceType === 'Image' || /^image\//i.test(b.format ?? ''));

export const imageOfBody = (b: AnnotationBodyItem, locale: string): AnnotationImage => {
  const label = localizedString(b.label, locale);
  const homepageLabel = localizedString(b.homepageLabel, locale);
  return {
    id: b.url ?? '',
    ...(label ? { label } : {}),
    ...(b.format ? { format: b.format } : {}),
    ...(b.purpose ? { purpose: b.purpose } : {}),
    ...(b.service ? { service: b.service } : {}),
    ...(b.homepage ? { homepage: b.homepage } : {}),
    ...(homepageLabel ? { homepageLabel } : {}),
  };
};

/**
 * The bodies a 3D annotation card shows below its description: not the description itself, a tag or a picture
 * (the card shows those on their own). For example a second text, or a link to a Wikidata item.
 */
export const otherBodies = (bodies: AnnotationBodyItem[]): AnnotationBodyItem[] => {
  const main = mainTextBody(bodies);
  return bodies.filter((b) => b !== main && !isTagBody(b) && !isImageBody(b));
};
