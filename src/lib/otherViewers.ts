// "Open in other viewers": links that open the manifest shown in Kasane in other IIIF viewers' public demos.
// One entry per viewer (name, URL builder, what it can show). To add a viewer, add one entry to OTHER_VIEWERS
// and check by hand (a browser test against a public manifest) that its demo really loads the manifest.

import { fetchJson, type ContainerInfo, type MediaKind } from 'iiif-kasane/core';

export type PresentationVersion = 2 | 3;
export type ViewerMedia = 'image' | 'av';

/**
 * What the file at the manifest's URL really is, read from the JSON as served (not from the upgraded copy the
 * viewer holds: that one is always Presentation 3, and an info.json, Canvas, AnnotationPage or curation has been
 * wrapped in a stand-in Manifest). Only a real, openly readable Manifest gets one.
 */
export interface ServedManifest {
  /** The URL to link to (https, even if the item was given as http). */
  url: string;
  version: PresentationVersion;
}

/** The kinds of content the shown manifest paints (from containersOf on the viewer's own manifest). */
export interface MediaFacts {
  image: boolean;
  av: boolean;
}

export interface OtherViewer {
  id: string;
  /** Proper name, shown as it is (not translated). */
  name: string;
  /** Presentation versions it reads. */
  versions: PresentationVersion[];
  /** Kinds of content it can show. It is offered when the manifest has at least one of them. */
  media: ViewerMedia[];
  /** The link that opens `manifestUrl` (already checked to be a public http(s) URL). */
  url: (manifestUrl: string) => string;
}

const enc = encodeURIComponent;

// Each URL was checked with a headless browser against a v3 and a v2 manifest of the IIIF Cookbook / Presentation 2.1
// fixtures (title or image of that manifest appeared). The parameter name differs per viewer.
export const OTHER_VIEWERS: OtherViewer[] = [
  {
    id: 'uv',
    name: 'Universal Viewer',
    versions: [2, 3],
    media: ['image', 'av'],
    // UV reads its parameters from the hash (?manifest= before # shows an empty player)
    url: (m) => `https://www.universalviewer.dev/uv.html#?manifest=${enc(m)}`,
  },
  {
    id: 'mirador',
    name: 'Mirador',
    versions: [2, 3],
    media: ['image'],
    url: (m) => `https://projectmirador.org/embed/?iiif-content=${enc(m)}`,
  },
  {
    id: 'codh',
    name: 'IIIF Curation Viewer',
    versions: [2, 3],
    media: ['image'],
    url: (m) => `https://codh.rois.ac.jp/software/iiif-curation-viewer/demo/?manifest=${enc(m)}`,
  },
  {
    id: 'clover',
    name: 'Clover',
    versions: [3],
    media: ['image', 'av'],
    // the demo page of Clover 2.x's docs; the front page of the docs ignores the parameter
    url: (m) => `https://clover.iiif.library.northwestern.edu/docs/deprecated-versions/viewer/demo?iiif-content=${enc(m)}`,
  },
  {
    id: 'theseus',
    name: 'Theseus',
    versions: [2, 3],
    media: ['image'],
    url: (m) => `https://theseusviewer.org/?iiif-content=${enc(m)}`,
  },
];

const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa', '.test', '.invalid', '.intranet', '.corp', '.home'];

// Query parameters that carry a credential. A link with one cannot be shared: dropping it breaks the link and
// keeping it would hand the credential to a third-party site, so no links are offered.
// A name counts when the whole name is one of SECRET_NAMES (accesstoken, apikey...) or one of its parts, split at
// - _ . and camelCase, is one of SECRET_PARTS (access_token, api-key, X-Amz-Signature). "author", "keyword" and
// "design" do not match.
const SECRET_PARTS = new Set(['token', 'key', 'auth', 'sig', 'signature', 'secret', 'password', 'passwd', 'pwd', 'credential', 'credentials', 'jwt', 'bearer', 'session', 'sessionid', 'sid']);
const SECRET_NAMES = new Set(['accesstoken', 'authtoken', 'idtoken', 'refreshtoken', 'apikey', 'accesskey', 'authkey', 'authorization', 'xamzsignature', 'xamzcredential']);

export function isSecretParam(name: string): boolean {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const parts = spaced.toLowerCase().split(/[\s_\-.]+/).filter(Boolean);
  return SECRET_NAMES.has(name.toLowerCase().replace(/[\s_\-.]+/g, '')) || parts.some((p) => SECRET_PARTS.has(p));
}

const isPrivateIPv4 = (a: number, b: number): boolean =>
  a === 10 || a === 127 || a === 0 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);

// "[...]" as the URL parser leaves it (lower case, compressed, an embedded IPv4 already turned into hex) -> 8 numbers
function hextetsOf(host: string): number[] | null {
  const h = host.slice(1, -1).toLowerCase();
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - left.length - right.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const all = [...left, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...right].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n)) ? all : null;
}

function isPrivateIPv6(host: string): boolean {
  const g = hextetsOf(host);
  if (!g) return true; // cannot be read: do not hand it out
  const embedded = (hi: number) => isPrivateIPv4(hi >> 8, hi & 255); // the first two bytes of the IPv4 decide
  if (g.every((n) => n === 0)) return true; // :: (unspecified)
  // IPv4-compatible (::a.b.c.d), IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4 inside
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0 || g[5] === 0xffff)) return embedded(g[6]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return embedded(g[6]);
  if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true; // unique local fc00::/7
  if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true; // link local fe80::/10
  if (g[0] >= 0xff00) return true; // multicast
  return false;
}

/**
 * Whether a public viewer on the web can be handed this URL: http(s) only; not an address only this computer or
 * its network can reach (blob: of a local image, localhost, private / link-local / IPv6 local addresses, names
 * without a dot, local suffixes); no user:password@; and no query parameter that looks like a credential.
 */
export function isPublicManifestUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  for (const name of u.searchParams.keys()) if (isSecretParam(name)) return false;
  let h = u.hostname.toLowerCase();
  if (h.startsWith('[')) return !isPrivateIPv6(h);
  h = h.replace(/\.+$/, '');
  if (!h.includes('.')) return false; // localhost, intranet names
  if (PRIVATE_SUFFIXES.some((x) => h === x.slice(1) || h.endsWith(x))) return false;
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip && isPrivateIPv4(Number(ip[1]), Number(ip[2]))) return false;
  return true;
}

const typeOf = (o: Record<string, unknown>): unknown => o.type ?? o['@type'];

// An IIIF Authentication service (1.0 or 2.0) anywhere along the services of the manifest, its canvases and their bodies
const isAuthService = (n: Record<string, unknown>): boolean => {
  const t = typeOf(n);
  const text = `${typeof n.profile === 'string' ? n.profile : ''} ${JSON.stringify(n['@context'] ?? '')}`;
  return (typeof t === 'string' && /^Auth.*Service/.test(t)) || /iiif\.io\/api\/auth\//.test(text);
};
const hasAuthService = (node: unknown, depth = 0): boolean => {
  if (depth > 12 || node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => hasAuthService(n, depth + 1));
  const o = node as Record<string, unknown>;
  if (isAuthService(o)) return true;
  // services hang on the manifest / canvas / body (service, services), nested in each other; canvases and bodies are reached through these keys
  for (const key of ['service', 'services', 'items', 'body', 'sequences', 'canvases', 'images', 'resource']) {
    if (key in o && hasAuthService(o[key], depth + 1)) return true;
  }
  return false;
};

/**
 * Reads the JSON as served at `fetchedUrl`: a real Manifest of Presentation 2 or 3 without an IIIF Authentication
 * service, otherwise null (Collections, info.json, Canvas, AnnotationPage, curations, Presentation 4, restricted items).
 */
export function servedManifestOf(json: unknown, fetchedUrl: string): ServedManifest | null {
  if (!isPublicManifestUrl(fetchedUrl)) return null;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const ctx = JSON.stringify(o['@context'] ?? '');
  let version: PresentationVersion | null = null;
  if (typeOf(o) === 'sc:Manifest') version = 2;
  else if (typeOf(o) === 'Manifest' && /presentation\/3/.test(ctx)) version = 3;
  if (version === null) return null;
  if (hasAuthService(o)) return null;
  return { url: fetchedUrl, version };
}

/**
 * Fetches the manifest as served and classifies it. The loader's own copy is upgraded and wrapped, so this asks
 * for the JSON again (the browser's cache usually answers). It uses core's `fetchJson`, which returns the JSON
 * unmodified. An http:// item is asked for as https:// (the viewers are https pages, which cannot load an http
 * manifest); when that does not work, nothing is offered. Any failure gives null and is not remembered.
 */
export async function fetchServedManifest(url: string): Promise<ServedManifest | null> {
  const target = url.replace(/^http:/i, 'https:');
  if (!isPublicManifestUrl(url) || !isPublicManifestUrl(target)) return null;
  try {
    return servedManifestOf(await fetchJson(target), target);
  } catch {
    return null;
  }
}

/** Kinds of content from the containers of the viewer's manifest (iiif-kasane/core containersOf). */
export function mediaFactsOf(containers: ContainerInfo[]): MediaFacts {
  const kinds = new Set<MediaKind>(containers.flatMap((c) => c.painting.flatMap((p) => p.options.map((o) => o.kind))));
  return { image: kinds.has('Image'), av: kinds.has('Video') || kinds.has('Audio') };
}

/** The viewers that can show this manifest (none without a real Manifest or without content they can show). */
export function viewersFor(manifest: ServedManifest | null, media: MediaFacts): OtherViewer[] {
  if (!manifest) return [];
  return OTHER_VIEWERS.filter(
    (v) => v.versions.includes(manifest.version) && ((media.image && v.media.includes('image')) || (media.av && v.media.includes('av'))),
  );
}
