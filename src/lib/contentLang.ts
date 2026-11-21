// ?content-lang=<tag>: the language of the resource's own text, chosen apart from the page's language.
// The reader's choice is kept in the page (not only in the address), so that an address without the parameter
// (an entry of a Collection, the browser's Back) does not lose it.

export const CONTENT_LANG_PARAM = 'content-lang';

/** The value for the viewer: the address wins; else the reader's choice ('' is "Automatic" chosen by the reader). */
export const contentLangForViewer = (fromUrl: string | undefined, chosen: string | undefined): string | undefined =>
  fromUrl ?? chosen;

/** Write (or remove) the parameter. `lang` of undefined or '' removes it. Returns the same params object. */
export function withContentLang(params: URLSearchParams, lang: string | undefined): URLSearchParams {
  if (lang) params.set(CONTENT_LANG_PARAM, lang);
  else params.delete(CONTENT_LANG_PARAM);
  return params;
}

/** The address (`?...`) of an entry the viewer moved to, with the content language the reader has now. */
export function shownLocationSearch(
  base: { url: string; collections: string[]; tab: string | null },
  lang: string | undefined,
): string {
  const params = new URLSearchParams();
  params.set('iiif-content', base.url);
  for (const c of base.collections) params.append('collection', c);
  if (base.tab) params.set('tab', base.tab);
  withContentLang(params, lang);
  return `?${params.toString()}`;
}
