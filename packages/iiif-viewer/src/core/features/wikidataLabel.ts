// wikidataLabel: parts for fetching a readable name when the body of a tag is a Wikidata item (Recipe 0258).
// No dependency on React.
import { preferredLanguages } from '../services/contentLanguage';

/** The item number (Q...) of a Wikidata item URL (entity / wiki / Special:EntityData). */
export const wikidataIdOf = (url: string | undefined): string | undefined =>
  url ? /^https?:\/\/(?:www\.)?wikidata\.org\/(?:entity|wiki|wiki\/Special:EntityData)\/(Q\d{1,12})(?:[#?.].*)?$/i.exec(url)?.[1]?.toUpperCase() : undefined;

/** The languages to ask for, best first: the chosen content language, the UI language, then en. */
const wantedLanguages = (locale: string): string[] => [
  ...new Set([...preferredLanguages(locale).map((l) => l.toLowerCase().split('-')[0]), 'en'].filter(Boolean)),
];

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
  const hit = wantedLanguages(locale).map((l) => labels[l]).find((l) => l?.value) ?? Object.values(labels)[0];
  const v = hit?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
