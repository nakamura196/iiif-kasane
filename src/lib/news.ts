import { COOKBOOK_VIDEO_ID } from '@/lib/cookbookVideo';
import { USE_CASES, hrefOf, type UseCase } from '@/lib/usecases';

// お知らせ。トップには新しいものから NEWS_ON_HOME 件、/news に全件、/news/<id> に 1 件ずつの詳細を出す。
// 1 件足すときは content/news/<id>.md を 1 つ置く（書き方は content/news/README.md）。ページの部品は触らなくてよい。

type Localized = { ja: string; en: string };

/** 詳細ページの「試す」ボタン。label は messages の News.<label> */
export interface NewsAction {
  // 言語で行き先が違うとき（日英の記事など）は Localized で書く
  href: string | Localized;
  external?: boolean;
  label?: 'tryIt' | 'readArticle';
}

export interface NewsItem {
  // 詳細ページの URL（/news/<id>）。英小文字・数字・ハイフン。公開後は変えない
  id: string;
  // YYYY-MM-DD
  date: string;
  // 一覧に出す見出し。短く
  title: Localized;
  // 詳細ページの本文。2〜3 文。何ができるようになったか
  body: Localized;
  action?: NewsAction;
  // 紹介動画（YouTube の videoId）。片方の言語しか無いときは、それを両方の言語で出す
  video?: Partial<Localized>;
  // 関連するユースケースの id。詳細ページにサムネイル付きで出す（先頭のものは動画が無いときの画像にも使う）
  usecases?: string[];
}

export const NEWS_ON_HOME = 5;

// content/news/<id>.md を scripts/build-news.mjs が 1 つにまとめたもの（git に入れない。npm の pre〜 で作られる）
import RAW from './news.generated.json';

/** ファイルに書く「試す」の行き先。usecase・viewer（＋params）・href のどれか 1 つ */
interface RawAction {
  usecase?: string;
  viewer?: string;
  params?: string;
  href?: string | Localized;
  external?: boolean;
  label?: NewsAction['label'];
}
interface RawNews extends Omit<NewsItem, 'action' | 'video'> {
  action?: RawAction;
  video?: Partial<Localized> | 'cookbook';
}

function hrefOfUseCase(id: string): string {
  const u = USE_CASES.find((x) => x.id === id);
  if (!u) throw new Error(`news: unknown use case ${id}`);
  return hrefOf(u.open);
}

function actionOf(id: string, a: RawAction): NewsAction {
  const href = a.usecase
    ? hrefOfUseCase(a.usecase)
    : a.viewer
      ? `/viewer/?iiif-content=${encodeURIComponent(a.viewer)}${a.params ? `&${a.params}` : ''}`
      : a.href;
  if (!href) throw new Error(`news/${id}.md: action に usecase・viewer・href のどれも無い`);
  return { href, ...(a.external ? { external: true } : {}), ...(a.label ? { label: a.label } : {}) };
}

export const NEWS: NewsItem[] = (RAW as RawNews[]).map(({ action, video, ...n }) => ({
  ...n,
  ...(action ? { action: actionOf(n.id, action) } : {}),
  ...(video ? { video: video === 'cookbook' ? COOKBOOK_VIDEO_ID : video } : {}),
}));

export const newsById = (id: string): NewsItem | undefined => NEWS.find((n) => n.id === id);

export const relatedUseCasesOf = (n: NewsItem): UseCase[] =>
  (n.usecases ?? []).map((id) => USE_CASES.find((u) => u.id === id)).filter((u): u is UseCase => !!u);

// このユースケースを取り上げたお知らせ（新しいものが先）
export const newsAboutUseCase = (useCaseId: string): NewsItem[] =>
  NEWS.filter((n) => n.usecases?.includes(useCaseId));

export const newsVideoOf = (n: NewsItem, locale: keyof Localized): string | undefined =>
  n.video?.[locale] ?? n.video?.[locale === 'ja' ? 'en' : 'ja'];

export const actionHrefOf = (a: NewsAction, locale: keyof Localized): string =>
  typeof a.href === 'string' ? a.href : a.href[locale];
