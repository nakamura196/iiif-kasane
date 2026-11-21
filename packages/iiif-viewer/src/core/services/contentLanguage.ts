// The language of a resource's own text (labels, summary, metadata, annotation bodies), which a reader can
// choose apart from the language of the UI. The lookups of the viewer (`labelIn`, `valuesIn`, ...) take one
// "locale" string. A content language rides on that string as a preference list: "zh,ja" means
// "Chinese first; where a value has none, the UI language (ja) and then the usual order". A string
// without a comma is the plain UI locale, exactly as before.

/** The locale string the lookups take: the chosen content language first, then the UI locale. */
export const contentLocale = (uiLocale: string, chosen?: string | null): string => {
  const c = chosen?.trim();
  return c && c !== uiLocale && !c.includes(',') ? `${c},${uiLocale}` : uiLocale;
};

/** The languages to try first, in order. */
export const preferredLanguages = (locale: string): string[] => locale.split(',').filter(Boolean);

/** The language the reader wants for the text (the first of the list). */
export const primaryLanguage = (locale: string): string => preferredLanguages(locale)[0] ?? locale;

/** The rank of a language that is not in the list (a plain number, so that ranks can be subtracted). */
export const NOT_PREFERRED = 1000;

/**
 * How well a language tag fits the reader: the position of its primary subtag in the preference list (0 is the
 * best), or `NOT_PREFERRED` when it is not in the list. Used to order captions and the like; ties keep their order.
 */
export const languageRank = (tag: string | undefined, locale: string): number => {
  const primary = (t: string) => t.toLowerCase().split('-')[0];
  if (!tag) return NOT_PREFERRED;
  const i = preferredLanguages(locale).map(primary).indexOf(primary(tag));
  return i < 0 ? NOT_PREFERRED : i;
};

/**
 * A content language given from outside (a prop or attribute) as the viewer keeps it. undefined: not given, so
 * whatever the reader chose stays. "" (or something that cannot be a tag, such as a list with a comma): back to
 * automatic (null).
 */
export const contentLanguageOfInput = (value: string | undefined | null): string | null | undefined => {
  if (value === undefined || value === null) return undefined;
  const t = value.trim();
  return t && !t.includes(',') ? t : null;
};

/** The UI language (the last of the list). Dates and other UI formatting follow this, not the content language. */
export const uiLanguage = (locale: string): string => preferredLanguages(locale).at(-1) ?? locale;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// A language map: keys that look like language tags, each holding a list of strings.
const TAG = /^(none|[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*)$/;
const isLanguageMap = (v: unknown): v is Record<string, string[]> => {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => TAG.test(k) && Array.isArray(v[k]) && (v[k] as unknown[]).every((e) => typeof e === 'string'));
};

// Properties that hold language maps, or hold things that do (metadata entries, requiredStatement).
const MAP_KEYS = new Set(['label', 'summary', 'value', 'requiredStatement', 'metadata', 'body', 'items', 'structures', 'annotations']);
// Properties that point to other resources (a link, a rendering): only their `label` is text of the resource.
const LINK_KEYS = new Set(['homepage', 'seeAlso', 'rendering', 'partOf', 'provider', 'service']);

/**
 * The languages that appear in a resource: the keys of its language maps (label, summary, metadata labels and
 * values, requiredStatement, and the same on Canvases, Ranges and annotation bodies) and the `language` of
 * annotation text bodies (objects with a `value`). The `language` of a link, a painting body or a media file
 * says what the target is in, not what the text is, so it is not counted. "none" is left out.
 *
 * Tags are lower-cased. A tag that has a region or script ("zh-hans") is merged into the one language map key
 * with the same primary subtag ("zh") when there is exactly one such key; the order is that of first appearance.
 */
export const languagesOf = (resource: unknown): string[] => {
  const keys = new Map<string, string>(); // lower-cased -> as written, from language maps
  const tags = new Set<string>(); // lower-cased, from `language` of text bodies
  let visited = 0;
  const addKey = (l: string) => {
    if (l !== 'none' && !keys.has(l.toLowerCase())) keys.set(l.toLowerCase(), l);
  };
  const addTag = (l: unknown) => {
    if (typeof l === 'string' && l.trim() && l.trim() !== 'none') tags.add(l.trim().toLowerCase());
  };
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || visited++ > 200000) return;
    if (Array.isArray(v)) {
      for (const e of v) walk(e, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    if ('language' in v && 'value' in v) {
      for (const l of Array.isArray(v.language) ? v.language : [v.language]) addTag(l);
    }
    for (const [k, child] of Object.entries(v)) {
      if (LINK_KEYS.has(k)) {
        // only the label of each linked resource
        for (const link of Array.isArray(child) ? child : [child]) {
          if (isObj(link) && isLanguageMap(link.label)) Object.keys(link.label).forEach(addKey);
        }
        continue;
      }
      if (!MAP_KEYS.has(k)) continue;
      if (isLanguageMap(child)) Object.keys(child).forEach(addKey);
      else walk(child, depth + 1);
    }
  };
  walk(resource, 0);
  const primary = (t: string) => t.split('-')[0];
  const out = [...keys.values()];
  for (const tag of tags) {
    if (keys.has(tag) || out.includes(tag)) continue;
    // exactly one key with the same primary subtag: the same language ("zh" and "zh-hans")
    if ([...keys.keys()].filter((k) => primary(k) === primary(tag)).length !== 1) out.push(tag);
  }
  return out;
};

/**
 * The keys of a language map in the order to try them for `locale`: the content language (matched without regard to
 * case, and to a region or script: "zh" finds "zh-Hans" when it is the only such key), the UI locale, then none,
 * en and the rest. A plain UI locale (no content language) is matched exactly, as it always was.
 */
export const keysInOrder = (map: Record<string, unknown>, locale: string): string[] => {
  const keys = Object.keys(map);
  const wanted = preferredLanguages(locale);
  const loose = wanted.length > 1;
  const resolve = (lang: string, last: boolean): string[] => {
    if (!loose || last) return [lang];
    const lower = lang.toLowerCase();
    const exact = keys.filter((k) => k.toLowerCase() === lower);
    if (exact.length) return exact;
    const same = keys.filter((k) => k.toLowerCase().split('-')[0] === lower.split('-')[0]);
    return same.length === 1 ? same : [lang];
  };
  return [...wanted.flatMap((l, i) => resolve(l, i === wanted.length - 1)), 'none', 'en', ...keys];
};
