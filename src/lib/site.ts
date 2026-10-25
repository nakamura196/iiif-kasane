// 公開 URL はここ 1 か所で決める(canonical・OGP・robots・sitemap が参照する)。
// 2026-09 に nakamura196.github.io/iiif-3d-viewer から 3d.ldas.jp へ移し、
// 2026-10 に名前を IIIF Kasane に改めたのに合わせて kasane.ldas.jp へ移した。
// github.io/iiif-kasane は GitHub Pages の独自ドメイン設定で、旧 3d.ldas.jp と
// 3d-iiif-viewer.vercel.app は vercel.json で、同じパスのまま kasane.ldas.jp へ転送される。
// (リポジトリ名を変えたので、github.io/iiif-3d-viewer の転送は無くなった)
export const SITE_URL = 'https://kasane.ldas.jp';

export const OLD_HOSTS = ['nakamura196.github.io/iiif-3d-viewer', '3d-iiif-viewer.vercel.app', '3d.ldas.jp'];

export const LOCALES = ['ja', 'en'] as const;

// sitemap に載せるページ(ロケールの後ろのパス。trailingSlash: true)
export const PUBLIC_PATHS = ['', 'viewer/', 'georef/', 'usecases/', 'inference-models/', 'gallery/', 'browse/', 'structure-share-embed/', 'news/', 'samples/', 'samples/kasane/', 'search/', 'help/', 'privacy/', 'terms/'];

/**
 * ページの canonical と言語の組。metadataBase (SITE_URL) からの相対で返す。
 * path はロケールの後ろ (例 'help/'、トップは '')。
 */
export function alternatesFor(locale: string, path: string) {
  return {
    canonical: `/${locale}/${path}`,
    languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/${path}`])),
  };
}
