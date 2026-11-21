// ?content-lang=<tag>: the language of the resource's own text, chosen apart from the page's language.
// The reader's choice is kept in the page (not only in the address), so that an address without the parameter
// (an entry of a Collection, the browser's Back) does not lose it.

export const CONTENT_LANG_PARAM = 'content-lang';

/**
 * What the page knows of the content language. `chosen` is the reader's choice ('' is "Automatic", chosen on purpose).
 * `pending` is set while the reader's choice is on its way into the address (router.replace is a transition: for a
 * moment the address still has the old value, which must not overwrite the choice).
 */
export interface ContentLangState {
  chosen: string | undefined;
  pending: string | null;
}

/** The reader chose `language` (undefined: Automatic). */
export const chooseContentLang = (language: string | undefined): ContentLangState => ({
  chosen: language ?? '',
  pending: language ?? '',
});

/**
 * Bring the state in step with the address. While a choice is pending, the address is not read until it has the
 * chosen value (no parameter for Automatic). Otherwise a value in the address (a link, the browser's Back to an
 * older entry) becomes the choice. Returns the same object when nothing changes.
 */
export function settleContentLang(state: ContentLangState, fromUrl: string | undefined): ContentLangState {
  if (state.pending !== null) return (fromUrl ?? '') === state.pending ? { chosen: state.chosen, pending: null } : state;
  return fromUrl !== undefined && fromUrl !== state.chosen ? { chosen: fromUrl, pending: null } : state;
}

/** The value for the viewer: the choice while one is pending; else the address wins, then the choice. */
export const contentLangForViewer = (fromUrl: string | undefined, state: ContentLangState): string | undefined =>
  state.pending !== null ? state.chosen : (fromUrl ?? state.chosen);

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
