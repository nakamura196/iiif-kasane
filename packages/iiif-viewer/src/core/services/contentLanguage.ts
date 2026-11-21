// The language of a resource's own text (labels, summary, metadata, annotation bodies), which a reader can
// choose apart from the language of the UI. The lookups of the viewer (`labelIn`, `valuesIn`, ...) take one
// "locale" string. A content language rides on that string as a preference list: "zh,ja" means
// "Chinese first; where a value has none, the UI language (ja) and then the usual order". A string
// without a comma is the plain UI locale, exactly as before.

// A language tag as it is accepted from outside (a URL, an attribute): letters and digits in dash-separated
// subtags. Anything else (a "&", "|", ",", a space) is not a tag, so it cannot reach a URL or the preference list.
const TAG_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/;
export const isLanguageTag = (value: string): boolean => TAG_PATTERN.test(value);

/** The locale string the lookups take: the chosen content language first, then the UI locale. An invalid tag is ignored. */
export const contentLocale = (uiLocale: string, chosen?: string | null): string => {
  const c = chosen?.trim();
  return c && c !== uiLocale && isLanguageTag(c) ? `${c},${uiLocale}` : uiLocale;
};

/** The languages to try first, in order. */
export const preferredLanguages = (locale: string): string[] => locale.split(',').filter(Boolean);

/** The language the reader wants for the text (the first of the list). */
export const primaryLanguage = (locale: string): string => preferredLanguages(locale)[0] ?? locale;

/** The rank of a language that is not in the list (a plain number, so that ranks can be subtracted). */
export const NOT_PREFERRED = 1000;

/**
 * How well a language tag fits the reader: 0 for the chosen content language (by `matchLanguage`, so scripts are
 * not mixed up) or, with none chosen, for the UI language (same primary subtag, as it always was); 1 for the UI
 * language when a content language is chosen. The position in the preference list (0 is the
 * best), or `NOT_PREFERRED` when it is not in the list. Used to order captions and the like; ties keep their order.
 */
export const languageRank = (tag: string | undefined, locale: string): number => {
  if (!tag) return NOT_PREFERRED;
  const chosen = chosenLanguage(locale);
  if (chosen && matchLanguage(chosen, [tag]) !== undefined) return 0;
  // the UI language: the same primary subtag, as it always was
  return tag.toLowerCase().split('-')[0] === primaryOfUi(locale) ? (chosen ? 1 : 0) : NOT_PREFERRED;
};

const primaryOfUi = (locale: string): string => uiLanguage(locale).toLowerCase().split('-')[0];

// The script of a language tag: its script subtag ("hant" in "zh-Hant"), else the script a Chinese region implies
// (zh-TW, zh-HK, zh-MO are Traditional; zh-CN, zh-SG are Simplified), else ''.
const scriptOf = (tag: string): string => {
  const parts = tag.toLowerCase().split('-');
  const explicit = parts.slice(1).find((p) => /^[a-z]{4}$/.test(p));
  if (explicit) return explicit;
  if (parts[0] !== 'zh') return '';
  if (parts.some((p) => p === 'tw' || p === 'hk' || p === 'mo')) return 'hant';
  if (parts.some((p) => p === 'cn' || p === 'sg')) return 'hans';
  return '';
};

/** Whether two tags are the same language in the same script (regions may differ: "fr" and "fr-CA"). */
export const sameLanguageFamily = (a: string, b: string): boolean =>
  a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0] && scriptOf(a) === scriptOf(b);

/**
 * The candidate that stands for `tag`, or undefined. Exact match first, then without regard to case. Then the
 * primary subtag, but never across scripts: a plain "zh" matches a lone "zh-Hans" (or several candidates of one
 * script, "en-US" and "en-GB": the first), but not "zh-Hans" together with "zh-Hant"; "zh-Hant" matches a plain "zh"
 * key, but never "zh-Hans". This is for the language the reader chose; the UI language keeps its own plain matching.
 */
export const matchLanguage = (tag: string, candidates: readonly string[]): string | undefined => {
  const lower = tag.toLowerCase();
  const exact = candidates.find((k) => k === tag) ?? candidates.find((k) => k.toLowerCase() === lower);
  if (exact) return exact;
  const primary = lower.split('-')[0];
  const same = candidates.filter((k) => k.toLowerCase().split('-')[0] === primary);
  if (lower === primary) return new Set(same.map(scriptOf)).size <= 1 ? same[0] : undefined;
  return same.find((k) => k.toLowerCase() === primary);
};

/**
 * The language the reader chose for the content (the first of the list), or undefined when the locale is the plain
 * UI locale. Only this language is matched with `matchLanguage`; with none chosen every lookup is as it always was.
 */
export const chosenLanguage = (locale: string): string | undefined => {
  const list = preferredLanguages(locale);
  return list.length > 1 ? list[0] : undefined;
};

/**
 * A content language given from outside (a prop or attribute) as the viewer keeps it. undefined: not given, so
 * whatever the reader chose stays. "" (or something that is not a language tag, such as a list with a comma, or text with "&"): back to
 * automatic (null).
 */
export const contentLanguageOfInput = (value: string | undefined | null): string | null | undefined => {
  if (value === undefined || value === null) return undefined;
  const t = value.trim();
  return t && isLanguageTag(t) ? t : null;
};

/** The UI language (the last of the list). Dates and other UI formatting follow this, not the content language. */
export const uiLanguage = (locale: string): string => preferredLanguages(locale).at(-1) ?? locale;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// A language map: keys that are language tags (or "none"), each holding a list of strings.
const isLanguageMap = (v: unknown): v is Record<string, string[]> => {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => (k === 'none' || isLanguageTag(k)) && Array.isArray(v[k]) && (v[k] as unknown[]).every((e) => typeof e === 'string'));
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
 * Label-map keys are returned as written (two keys that differ only in case count once). The tags of text bodies
 * are lower-cased, and one that `matchLanguage` finds among the keys ("zh" for a lone "zh-Hans") is not listed
 * again. The order is that of first appearance.
 */
export const languagesOf = (resource: unknown): string[] => {
  const keys = new Map<string, string>(); // lower-cased -> as written, from language maps
  const tags = new Set<string>(); // lower-cased, from `language` of text bodies
  let visited = 0;
  const addKey = (l: string) => {
    if (l !== 'none' && !keys.has(l.toLowerCase())) keys.set(l.toLowerCase(), l);
  };
  const addTag = (l: unknown) => {
    // only what the menu and the lookups can use: a language tag (not "English" or "en_US")
    if (typeof l === 'string' && isLanguageTag(l.trim())) tags.add(l.trim().toLowerCase());
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
  const out = [...keys.values()];
  for (const tag of tags) {
    if (!matchLanguage(tag, [...keys.keys()]) && !out.includes(tag)) out.push(tag);
  }
  return out;
};

/**
 * The keys of a language map in the order to try them for `locale`: the content language (matched with `matchLanguage`: without
 * regard to case, and a plain "zh" finds a lone "zh-Hans", but never across scripts), the UI locale, then none,
 * en and the rest. A plain UI locale (no content language) is matched exactly, as it always was.
 */
export const keysInOrder = (map: Record<string, unknown>, locale: string): string[] => {
  const keys = Object.keys(map);
  const wanted = preferredLanguages(locale);
  const loose = wanted.length > 1;
  const resolve = (lang: string, last: boolean): string[] => [(!loose || last ? undefined : matchLanguage(lang, keys)) ?? lang];
  return [...wanted.flatMap((l, i) => resolve(l, i === wanted.length - 1)), 'none', 'en', ...keys];
};
