// "Open in other viewers": links that open the manifest shown in Kasane in other IIIF viewers' public demos.
// One entry per viewer (name, URL builder, what it can show). To add a viewer, add one entry to OTHER_VIEWERS
// and check by hand (a browser test against a public manifest) that its demo really loads the manifest.

export type PresentationVersion = 2 | 3;
export type MediaKind = 'image' | 'av';

/** What the shown manifest is, as far as choosing viewers goes. */
export interface ManifestFacts {
  /** Presentation API version, from @context / @type. null when it cannot be told (Collections, odd JSON). */
  version: PresentationVersion | null;
  /** The manifest paints at least one image / audio or video. */
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

/**
 * Whether a public viewer on the web can fetch this URL: http(s) only, and not an address that only
 * this computer can reach (blob: of a local image, localhost, private networks).
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
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '[::1]') return false;
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip) {
    const a = Number(ip[1]);
    const b = Number(ip[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false;
  }
  return true;
}

const typeOf = (o: Record<string, unknown>): unknown => o.type ?? o['@type'];

/** Reads the version and the kinds of content from a Manifest as served. */
export function manifestFacts(raw: unknown): ManifestFacts {
  const none: ManifestFacts = { version: null, image: false, av: false };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return none;
  const o = raw as Record<string, unknown>;
  const type = typeOf(o);
  const ctx = JSON.stringify(o['@context'] ?? '');
  let version: PresentationVersion | null = null;
  if (type === 'sc:Manifest' || /presentation\/2/.test(ctx)) version = 2;
  else if (type === 'Manifest' && /presentation\/3/.test(ctx)) version = 3;
  if (version === null) return none;
  const facts: ManifestFacts = { version, image: false, av: false };
  const walk = (node: unknown, depth: number) => {
    if (depth > 14 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    const n = node as Record<string, unknown>;
    const t = typeOf(n);
    if (t === 'Image' || t === 'dctypes:Image') facts.image = true;
    else if (t === 'Video' || t === 'Sound' || t === 'dctypes:MovingImage' || t === 'dctypes:Sound') facts.av = true;
    for (const key of ['items', 'body', 'sequences', 'canvases', 'images', 'resource']) {
      if (key in n) walk(n[key], depth + 1);
    }
  };
  walk(o, 0);
  return facts;
}

/** The viewers that can show this manifest (none when the URL is not public or the manifest is not a Manifest). */
export function viewersFor(manifestUrl: string | undefined | null, raw: unknown): OtherViewer[] {
  if (!isPublicManifestUrl(manifestUrl)) return [];
  const f = manifestFacts(raw);
  if (f.version === null) return [];
  return OTHER_VIEWERS.filter(
    (v) => v.versions.includes(f.version as PresentationVersion) && ((f.image && v.media.includes('image')) || (f.av && v.media.includes('av'))),
  );
}
