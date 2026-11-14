// Building an IIIF Content State (spec 1.0) for "this page, this area, this time", and its encoded forms.
// (Named with a leading underscore so it stays out of the public API of iiif-kasane/core.)
// No React and no DOM: the Share tab and tests both use this file.

import type { ImageRegion } from './image';

export interface ShareInput {
  /** Absolute URL of the manifest that is shown (not a Collection). */
  manifestUrl: string;
  /** The Canvas to point at. Without it the content state points at the manifest only. */
  canvasId?: string;
  /** The type of the target: "Canvas" (default), "Scene" or "Timeline". */
  canvasType?: string;
  /** The area of the Canvas (Canvas coordinates). Needs `canvasId`. */
  region?: ImageRegion;
  /** The time in seconds (audio and video). Needs `canvasId`. */
  time?: number;
}

const CONTEXT = 'http://iiif.io/api/presentation/3/context.json';
const MEDIA_FRAGMENTS = 'http://www.w3.org/TR/media-frags/';

const round = (n: number, digits = 0): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** The fragment (without `#`) for an area and/or a time, or '' when there is neither. */
export function shareFragment(region?: ImageRegion, time?: number): string {
  const parts: string[] = [];
  if (region && [region.x, region.y, region.w, region.h].every(Number.isFinite) && region.w > 0 && region.h > 0) {
    parts.push(`xywh=${[region.x, region.y, region.w, region.h].map((n) => round(n)).join(',')}`);
  }
  if (time !== undefined && Number.isFinite(time) && time >= 0) parts.push(`t=${round(time, 2)}`);
  return parts.join('&');
}

/**
 * The content state as an object: an Annotation (motivation contentState) whose target is the Canvas.
 * An area or a time is a SpecificResource with a FragmentSelector, so a Canvas id that itself contains '#' stays whole.
 */
export function buildContentState(input: ShareInput): Record<string, unknown> {
  const manifest = { id: input.manifestUrl, type: 'Manifest' };
  let target: Record<string, unknown> = manifest;
  if (input.canvasId) {
    const canvas = { id: input.canvasId, type: input.canvasType ?? 'Canvas', partOf: [manifest] };
    const fragment = shareFragment(input.region, input.time);
    target = fragment
      ? {
          type: 'SpecificResource',
          source: canvas,
          selector: { type: 'FragmentSelector', conformsTo: MEDIA_FRAGMENTS, value: fragment },
        }
      : canvas;
  }
  return { '@context': CONTEXT, type: 'Annotation', motivation: ['contentState'], target };
}

/** The content state as pretty JSON text. */
export function contentStateJson(input: ShareInput): string {
  return JSON.stringify(buildContentState(input), null, 2);
}

// TODO: share with contentState.ts once #356 lands (its toBase64Url is not exported; encodeContentState builds only a Manifest target)
/**
 * The encoded form, the way the Content State spec says: encodeURIComponent, then base64url without padding.
 * Kasane's reader accepts this and the plain UTF-8 form.
 */
export function encodeShareState(json: string): string {
  return btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The manifest URL as an absolute URL (a site-relative one is resolved against `base`); null when it is not http(s). */
export function absoluteManifestUrl(url: string, base?: string): string | null {
  try {
    const u = new URL(url, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    // a relative URL and no base: not resolvable here
    return null;
  }
}

/**
 * The page URL with `iiif-content` set to the encoded content state. The arguments that named the item another
 * way (`manifest`, `curation`, `pos`) and `canvas`, which would contradict the state, are dropped.
 * Returns null when the URL names no item at all (an embed on another site), since there is no viewer link to build.
 */
export function viewerLinkWith(pageUrl: string, encoded: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const p = url.searchParams;
  if (!p.has('iiif-content') && !p.has('manifest') && !p.has('curation')) return null;
  p.set('iiif-content', encoded);
  for (const key of ['manifest', 'curation', 'pos', 'canvas']) p.delete(key);
  return url.toString();
}

/**
 * The link of the IIIF drag-and-drop convention: the manifest URL with `iiif-content=<encoded>` appended.
 * Dropping it on a viewer opens the place (Kasane reads it with parseDroppedText).
 */
export function dragLink(manifestUrl: string, encoded: string): string {
  const hashAt = manifestUrl.indexOf('#');
  const base = hashAt < 0 ? manifestUrl : manifestUrl.slice(0, hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}iiif-content=${encoded}`;
}
