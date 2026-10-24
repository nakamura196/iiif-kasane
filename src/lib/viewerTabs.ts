import { PANEL_IDS } from '@nakamura196/iiif-viewer';

// /viewer の ?tab= に指定できるタブ。ViewerContent が URL を読むときと、
// ユースケース・サンプルが「開いたあとに選ぶタブ」を書くときの両方で使う。
// 一覧はビューアの右パネル（panels/）から作るので、タブを足してもここは書き換えない。
// サイトが足すタブ（ほかの表示。components/OtherViewsPanel）だけはパッケージの外にあるので、ここで加える。
export const OTHER_VIEWS_TAB = 'views';

// ビューアのタブのうち、/viewer では出さずに「ほかの表示」の中に置くもの。
// パズルは資料を読む道具ではないので、いつも目に入るタブの並びから外した（2026-10-23）。
export const HIDDEN_VIEWER_TABS = ['puzzle'];

export const VIEWER_TABS: readonly string[] = [...PANEL_IDS, OTHER_VIEWS_TAB];

export type ViewerTab = string;

export const isViewerTab = (v: string | null | undefined): v is ViewerTab => !!v && VIEWER_TABS.includes(v);

/** ?tab= の値から開くタブ。外したタブ（古いリンクの ?tab=puzzle）は「ほかの表示」へ。 */
export const viewerTabOf = (v: string | null | undefined): ViewerTab | undefined =>
  !isViewerTab(v) ? undefined : HIDDEN_VIEWER_TABS.includes(v) ? OTHER_VIEWS_TAB : v;
