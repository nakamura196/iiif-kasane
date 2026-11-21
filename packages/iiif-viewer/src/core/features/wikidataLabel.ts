import { primaryLanguage } from '../services/contentLanguage';
// wikidataLabel: タグの本文が Wikidata の項目（Recipe 0258）のとき、読める名前を取りに行くための部品。React に依存しない。

/** Wikidata の項目の URL（entity / wiki / Special:EntityData）から項目番号（Q…）を取り出す。 */
export const wikidataIdOf = (url: string | undefined): string | undefined =>
  url ? /^https?:\/\/(?:www\.)?wikidata\.org\/(?:entity|wiki|wiki\/Special:EntityData)\/(Q\d{1,12})(?:[#?.].*)?$/i.exec(url)?.[1]?.toUpperCase() : undefined;

/** 問い合わせの URL。origin=* で CORS が通る。言語は UI の言語を先頭に、en を控えにする。 */
export const wikidataLabelUrl = (id: string, locale: string): string => {
  const lang = primaryLanguage(locale).toLowerCase().split('-')[0] || 'en';
  const langs = [...new Set([lang, 'en'])].join('|');
  return `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels&languages=${langs}&languagefallback=1&format=json&origin=*`;
};

/** 応答（wbgetentities）から、UI の言語 → en → 返ってきた最初の言語の順でラベルを選ぶ。 */
export const pickWikidataLabel = (json: unknown, id: string, locale: string): string | undefined => {
  const labels = (json as { entities?: Record<string, { labels?: Record<string, { value?: string }> }> } | null)?.entities?.[id]
    ?.labels;
  if (!labels) return undefined;
  const lang = primaryLanguage(locale).toLowerCase().split('-')[0] || 'en';
  const hit = labels[lang] ?? labels.en ?? Object.values(labels)[0];
  const v = hit?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
