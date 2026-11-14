// The `iiif-content` argument of the IIIF Content State API 1.0.
// The value is either the manifest URL itself or base64url JSON (an Annotation whose target is the manifest).

const toBase64Url = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null;

// The manifest URL from a target (a string, an object, a SpecificResource or an array).
const manifestOf = (target: unknown): string | null => {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const t of target) {
      const found = manifestOf(t);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(target)) return null;
  if (target.type === 'Manifest' && typeof target.id === 'string') return target.id;
  const fromPartOf = (r: Json): string | null => {
    // the parent manifest is written in the partOf of a Canvas and the like
    if (!Array.isArray(r.partOf)) return null;
    for (const p of r.partOf) {
      if (isObject(p) && p.type === 'Manifest' && typeof p.id === 'string') return p.id;
    }
    return null;
  };
  const source = target.source;
  if (typeof source === 'string') return source;
  if (isObject(source)) {
    if (source.type === 'Manifest' && typeof source.id === 'string') return source.id;
    return fromPartOf(source);
  }
  return fromPartOf(target);
};

/** The manifest URL from the value of `iiif-content`. null when it cannot be read. */
export function decodeContentState(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  // A place on this site (/manifests/... etc.; the sample buttons pass this form). One that starts with // is another site, so it is refused
  if (/^\/(?!\/)/.test(v)) return v;
  try {
    // URL-encoded JSON is accepted too, so that either way of writing it works
    let text = v.startsWith('{') || v.startsWith('%7B') ? decodeURIComponent(v) : fromBase64Url(v);
    // Cookbook form: URI-encoded JSON turned into base64url
    if (text.startsWith('%')) text = decodeURIComponent(text);
    const json: unknown = JSON.parse(text);
    if (!isObject(json)) return null;
    if (json.type === 'Annotation') return manifestOf(json.target);
    return manifestOf(json);
  } catch {
    return null;
  }
}

/** A manifest URL as a base64url content state (an Annotation). */
export function encodeContentState(manifestUrl: string): string {
  return toBase64Url(
    JSON.stringify({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      type: 'Annotation',
      motivation: ['contentState'],
      target: { id: manifestUrl, type: 'Manifest' },
    })
  );
}

/**
 * The URL of the manifest to show, from the URL arguments.
 * `iiif-content` comes first; without it the earlier `manifest` is used (so that existing links keep working).
 * `curation` (the URL of a curation) is accepted too, as in the IIIF Curation Viewer.
 */
export function manifestFromParams(params: URLSearchParams): string | null {
  return decodeContentState(params.get('iiif-content')) ?? params.get('manifest') ?? params.get('curation') ?? null;
}

/** The argument of the links the site writes: the manifest URL itself goes in `iiif-content`. */
export function contentParam(manifestUrl: string): string {
  return `iiif-content=${encodeURIComponent(manifestUrl)}`;
}

/**
 * The values of `?collection=` (the Collections walked through to reach the item, top first) as URLs: each goes
 * through the same rules as `iiif-content` (a content state gives its target, `//host` paths are refused);
 * those that do not pass are dropped.
 */
export function collectionsFromParams(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((v) => decodeContentState(v)).filter((v): v is string => !!v);
}

/** Whether two lists of URLs are the same, element by element (no joined string, which a URL could imitate). */
export function sameUrlList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
