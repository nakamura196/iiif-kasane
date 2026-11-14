// "Open in other viewers": links that open the manifest shown in Kasane in other IIIF viewers' public demos.
// One entry per viewer (name, URL builder, what it can show). To add a viewer, add one entry to OTHER_VIEWERS
// and check by hand (a browser test against a public manifest) that its demo really loads the manifest.

export type PresentationVersion = 2 | 3;
export type MediaKind = 'image' | 'av';

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
  media: MediaKind[];
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
const SECRET_PARAM = /(token|key|auth|sig|secret|passw|credential|jwt|bearer|session|signature)/i;

function isPrivateIPv6(host: string): boolean {
  const h = host.slice(1, -1).toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('::ffff:') || h.startsWith('64:ff9b:')) return true; // IPv4-mapped / NAT64: the IPv4 inside is not checked
  const first = parseInt(h.split(':')[0] || '0', 16);
  if (first >= 0xfc00 && first <= 0xfdff) return true; // unique local fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true; // link local fe80::/10
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
  for (const name of u.searchParams.keys()) if (SECRET_PARAM.test(name)) return false;
  let h = u.hostname.toLowerCase();
  if (h.startsWith('[')) return !isPrivateIPv6(h);
  h = h.replace(/\.+$/, '');
  if (!h.includes('.')) return false; // localhost, intranet names
  if (PRIVATE_SUFFIXES.some((x) => h === x.slice(1) || h.endsWith(x))) return false;
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip) {
    const a = Number(ip[1]);
    const b = Number(ip[2]);
    if (a === 10 || a === 127 || a === 0 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false;
  }
  return true;
}

const typeOf = (o: Record<string, unknown>): unknown => o.type ?? o['@type'];
const AUTH = /"(?:type|@type)":"Auth[A-Za-z0-9]*Service|iiif\.io\/api\/auth\//;

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
  if (AUTH.test(JSON.stringify(o))) return null;
  return { url: fetchedUrl, version };
}

// One request per URL (the tab can be opened again and again)
const served = new Map<string, Promise<ServedManifest | null>>();

/**
 * Fetches the manifest as served (the browser's cache usually answers, the loader asked for the same URL) and
 * classifies it. An http:// item is asked for as https:// (the viewers are https pages, which cannot load an
 * http manifest); when that does not work, nothing is offered. Any failure gives null.
 */
export function fetchServedManifest(url: string, fetchFn: typeof fetch = fetch): Promise<ServedManifest | null> {
  let p = served.get(url);
  if (!p) {
    const target = url.replace(/^http:/i, 'https:');
    p = (async () => {
      if (!isPublicManifestUrl(url) || !isPublicManifestUrl(target)) return null;
      try {
        const res = await fetchFn(target);
        if (!res.ok) return null;
        return servedManifestOf(await res.json(), target);
      } catch {
        return null;
      }
    })();
    served.set(url, p);
  }
  return p;
}

/** Clears the per-URL memory (tests). */
export const forgetServedManifests = () => served.clear();

/** Kinds of content from the containers of the viewer's manifest (iiif-kasane/core containersOf). */
export function mediaFactsOf(containers: { painting: { options: { kind: string }[] }[] }[]): MediaFacts {
  const kinds = new Set(containers.flatMap((c) => c.painting.flatMap((p) => p.options.map((o) => o.kind))));
  return { image: kinds.has('Image'), av: kinds.has('Video') || kinds.has('Audio') };
}

/** The viewers that can show this manifest (none without a real Manifest or without content they can show). */
export function viewersFor(manifest: ServedManifest | null, media: MediaFacts): OtherViewer[] {
  if (!manifest) return [];
  return OTHER_VIEWERS.filter(
    (v) => v.versions.includes(manifest.version) && ((media.image && v.media.includes('image')) || (media.av && v.media.includes('av'))),
  );
}
