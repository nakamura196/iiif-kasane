// Building an IIIF Content State (spec 1.0) for "this page, this area, this time", and its encoded forms.
// (Named with a leading underscore so it stays out of the public API of iiif-kasane/core.)
// No React and no DOM: the Share tab and tests both use this file.

import { isCuration } from './curation';
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
  /** The size of the Canvas, when known: the area is kept inside it. */
  canvasSize?: { w?: number; h?: number };
}

const CONTEXT = 'http://iiif.io/api/presentation/3/context.json';
const MEDIA_FRAGMENTS = 'http://www.w3.org/TR/media-frags/';

const round = (n: number, digits = 0): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/**
 * The fragment (without `#`) for an area and/or a time, or '' when there is neither.
 * The area is rounded to whole numbers first (at least 1 wide and high) and, when the Canvas size is known,
 * kept inside the Canvas.
 */
export function shareFragment(region?: ImageRegion, time?: number, size?: { w?: number; h?: number }): string {
  const parts: string[] = [];
  if (region && [region.x, region.y, region.w, region.h].every(Number.isFinite) && region.w > 0 && region.h > 0) {
    let x = Math.max(0, round(region.x));
    let y = Math.max(0, round(region.y));
    let w = Math.max(1, round(region.w));
    let h = Math.max(1, round(region.h));
    if (size?.w && size.w > 0) {
      x = Math.min(x, Math.max(0, round(size.w) - 1));
      w = Math.max(1, Math.min(w, round(size.w) - x));
    }
    if (size?.h && size.h > 0) {
      y = Math.min(y, Math.max(0, round(size.h) - 1));
      h = Math.max(1, Math.min(h, round(size.h) - y));
    }
    parts.push(`xywh=${x},${y},${w},${h}`);
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
    const fragment = shareFragment(input.region, input.time, input.canvasSize);
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

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * The URL of the Manifest to put in a content state for a Canvas, or null when there is none to give.
 * For a manifest, the shown URL. For a curation (`?curation=`) the shown URL is the curation, not a Manifest:
 * the Manifest is the one the Canvas came from (its partOf), if the curation says so.
 */
export function shareManifestUrl(
  shown: { url: string; raw: unknown; manifest: unknown },
  canvasId: string,
  base?: string,
): string | null {
  if (!isCuration(shown.raw)) return absoluteManifestUrl(shown.url, base);
  const items = asList((shown.manifest as { items?: unknown } | null)?.items);
  const canvas = items.find((c) => (c as { id?: unknown } | null)?.id === canvasId) as { partOf?: unknown } | undefined;
  for (const p of asList(canvas?.partOf)) {
    const q = p as { id?: unknown; type?: unknown } | null;
    if (q && q.type === 'Manifest' && typeof q.id === 'string') return absoluteManifestUrl(q.id, base);
  }
  return null;
}

// What describes the item and the place stays; the state of the page (tab, search) does not.
const DROPPED_ARGS = ['manifest', 'curation', 'pos', 'canvas', 'tab', 'q', 'scope'];

/**
 * The page URL with `iiif-content` set to the encoded content state. The arguments that named the item another
 * way (`manifest`, `curation`, `pos`), `canvas`, which would contradict the state, and the page state (`tab`, `q`, `scope`) are dropped.
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
  for (const key of DROPPED_ARGS) p.delete(key);
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
