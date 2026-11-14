// Building an IIIF Content State (spec 1.0) for "this page, this area, this time", and its encoded forms.
// (Named with a leading underscore so it stays out of the public API of iiif-kasane/core.)
// No React and no DOM: the Share tab and tests both use this file.

import type { ImageRegion } from './image';

export interface ShareInput {
  /** URL of the manifest that is shown (not a Collection). */
  manifestUrl: string;
  /** The Canvas to point at. Without it the content state points at the manifest only. */
  canvasId?: string;
  /** The area of the Canvas (Canvas coordinates). Needs `canvasId`. */
  region?: ImageRegion;
  /** The time in seconds (audio and video). Needs `canvasId`. */
  time?: number;
}

const CONTEXT = 'http://iiif.io/api/presentation/3/context.json';

const stripFragment = (id: string): string => {
  const hash = id.indexOf('#');
  return hash < 0 ? id : id.slice(0, hash);
};

const round = (n: number, digits = 0): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** The `#...` fragment (without `#`) for an area and/or a time, or '' when there is neither. */
export function shareFragment(region?: ImageRegion, time?: number): string {
  const parts: string[] = [];
  if (region && [region.x, region.y, region.w, region.h].every(Number.isFinite) && region.w > 0 && region.h > 0) {
    parts.push(`xywh=${[region.x, region.y, region.w, region.h].map((n) => round(n)).join(',')}`);
  }
  if (time !== undefined && Number.isFinite(time) && time >= 0) parts.push(`t=${round(time, 2)}`);
  return parts.join('&');
}

/** The content state as an object: an Annotation (motivation contentState) whose target is the Canvas. */
export function buildContentState(input: ShareInput): Record<string, unknown> {
  const manifest = { id: input.manifestUrl, type: 'Manifest' };
  const target = input.canvasId
    ? (() => {
        const fragment = shareFragment(input.region, input.time);
        const id = stripFragment(input.canvasId);
        return { id: fragment ? `${id}#${fragment}` : id, type: 'Canvas', partOf: [manifest] };
      })()
    : manifest;
  return { '@context': CONTEXT, type: 'Annotation', motivation: ['contentState'], target };
}

/** The content state as pretty JSON text. */
export function contentStateJson(input: ShareInput): string {
  return JSON.stringify(buildContentState(input), null, 2);
}

/** base64url (no padding) of the UTF-8 bytes, as the Content State spec says. */
export function encodeShareState(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The page URL with `iiif-content` replaced by the encoded content state. A `canvas=` argument would
 * contradict the page the state points at, so it is dropped. Returns null when the URL has no `iiif-content`
 * (an embed on another site), since there is no viewer link to build.
 */
export function viewerLinkWith(pageUrl: string, encoded: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!url.searchParams.has('iiif-content')) return null;
  url.searchParams.set('iiif-content', encoded);
  url.searchParams.delete('canvas');
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
