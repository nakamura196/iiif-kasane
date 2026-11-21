// wikidataLabel: parts for fetching a readable name when the body of a tag is a Wikidata item (Recipe 0258).
// No dependency on React.
import { chosenLanguage, matchLanguage, uiLanguage } from '../services/contentLanguage';

/** The item number (Q...) of a Wikidata item URL (entity / wiki / Special:EntityData). */
export const wikidataIdOf = (url: string | undefined): string | undefined =>
  url ? /^https?:\/\/(?:www\.)?wikidata\.org\/(?:entity|wiki|wiki\/Special:EntityData)\/(Q\d{1,12})(?:[#?.].*)?$/i.exec(url)?.[1]?.toUpperCase() : undefined;

/**
 * The languages to ask for, best first: the chosen content language as the whole tag ("zh-hant", never cut to its
 * primary subtag, which could turn Traditional into Simplified), the UI language by its primary subtag, then en.
 */
const wantedLanguages = (locale: string): string[] => {
  const chosen = chosenLanguage(locale);
  const ui = uiLanguage(locale).toLowerCase().split('-')[0];
  return [...new Set([...(chosen ? [chosen.toLowerCase()] : []), ui || 'en', 'en'])];
};

/** The query URL (origin=* makes CORS work). Each language is asked for, in the order of `wantedLanguages`; en is the fallback. */
export const wikidataLabelUrl = (id: string, locale: string): string => {
  const langs = wantedLanguages(locale).map(encodeURIComponent).join('|');
  return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels&languages=${langs}&languagefallback=1&format=json&origin=*`;
};

/** The label from a wbgetentities response: the first of the wanted languages that has one, else the first language returned. */
export const pickWikidataLabel = (json: unknown, id: string, locale: string): string | undefined => {
  const labels = (json as { entities?: Record<string, { labels?: Record<string, { value?: string }> }> } | null)?.entities?.[id]
    ?.labels;
  if (!labels) return undefined;
  // the chosen content language is matched with matchLanguage; the UI language and en by their exact key, as always
  const chosen = chosenLanguage(locale);
  const chosenKey = chosen ? matchLanguage(chosen, Object.keys(labels)) : undefined;
  const ui = uiLanguage(locale).toLowerCase().split('-')[0] || 'en';
  const hit = (chosenKey ? labels[chosenKey] : undefined) ?? labels[ui] ?? labels.en ?? Object.values(labels)[0];
  const v = hit?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
