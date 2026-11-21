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
const MAP_KEYS = new Set(['label', 'summary', 'value', 'requiredStatement', 'metadata', 'homepage', 'body', 'items', 'structures', 'annotations']);

/**
 * The languages that appear in a resource: the keys of its language maps (label, summary, metadata labels and
 * values, requiredStatement, and the same on Canvases, Ranges and annotation bodies) and the `language` of
 * annotation bodies. "none" is left out. The order is the order of first appearance.
 */
export const languagesOf = (resource: unknown): string[] => {
  const found = new Set<string>();
  let visited = 0;
  const add = (l: unknown) => {
    if (typeof l === 'string' && l && l !== 'none') found.add(l);
  };
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || visited++ > 200000) return;
    if (Array.isArray(v)) {
      for (const e of v) walk(e, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    if ('language' in v) {
      for (const l of Array.isArray(v.language) ? v.language : [v.language]) add(l);
    }
    for (const [k, child] of Object.entries(v)) {
      if (!MAP_KEYS.has(k)) continue;
      if (isLanguageMap(child)) for (const l of Object.keys(child)) add(l);
      else walk(child, depth + 1);
    }
  };
  walk(resource, 0);
  return [...found];
};
