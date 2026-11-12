import { contentParam } from 'iiif-kasane/core';
import type { ViewerTab } from '@/lib/viewerTabs';

// IIIF Cookbook の全レシピ。/samples の一覧に、レシピ番号の順で並べる。
// カテゴリと英語の題名は Cookbook の目次（https://iiif.io/api/cookbook/）に合わせる。
// 開く URL は、Cookbook の対応表に Kasane を載せるときに確かめたもの（docs/notes/cookbook-matrix.md）。

export const COOKBOOK_CATEGORIES = [
  'basics',
  'supplementary',
  'annotations',
  'internal',
  'higher',
  'segmentation',
  'linking',
  'sharing',
  'technical',
  'realWorld',
] as const;

export type CookbookCategory = (typeof COOKBOOK_CATEGORIES)[number];

// checked: Kasane で開いて、レシピの説明どおりに表示されることを確かめた
// unchecked: まだ確かめていない（開くことはできる）
// none: 開くマニフェストが無い（考え方だけを説明するレシピ）
export type RecipeStatus = 'checked' | 'unchecked' | 'none';

export interface RecipeLink {
  // 1 つのレシピに複数のマニフェストがあるときの見分け（v4 / v3、ファイル名など）
  label?: string;
  // マニフェスト・コレクション・content state の URL。無ければ空のビューアを開く
  url?: string;
}

export interface CookbookRecipe {
  id: string;
  category: CookbookCategory;
  title: { ja: string; en: string };
  links: RecipeLink[];
  status: RecipeStatus;
  // 開いたあとに選ぶタブ
  tab?: ViewerTab;
  note?: { ja: string; en: string };
}

// レシピのフォルダ名（番号-名前）。番号だけの URL は 404 になる
const FOLDERS: Record<string, string> = {
  '0001': '0001-mvm-image',
  '0002': '0002-mvm-audio',
  '0003': '0003-mvm-video',
  '0004': '0004-canvas-size',
  '0005': '0005-image-service',
  '0006': '0006-text-language',
  '0007': '0007-string-formats',
  '0008': '0008-rights',
  '0009': '0009-book-1',
  '0010': '0010-book-2-viewing-direction',
  '0011': '0011-book-3-behavior',
  '0013': '0013-placeholderCanvas',
  '0014': '0014-accompanyingcanvas',
  '0015': '0015-start',
  '0017': '0017-transcription-av',
  '0019': '0019-html-in-annotations',
  '0021': '0021-tagging',
  '0022': '0022-linking-with-a-hotspot',
  '0024': '0024-book-4-toc',
  '0025': '0025-newspaper-article-index',
  '0026': '0026-toc-opera',
  '0027': '0027-alternative-page-order',
  '0029': '0029-metadata-anywhere',
  '0030': '0030-multi-volume',
  '0031': '0031-bound-multivolume',
  '0032': '0032-collection',
  '0033': '0033-choice',
  '0035': '0035-foldouts',
  '0036': '0036-composition-from-multiple-images',
  '0040': '0040-image-rotation-service',
  '0045': '0045-css',
  '0046': '0046-rendering',
  '0047': '0047-homepage',
  '0053': '0053-seeAlso',
  '0057': '0057-publishing-v2-and-v3',
  '0064': '0064-opera-one-canvas',
  '0065': '0065-opera-multiple-canvases',
  '0068': '0068-newspaper',
  '0074': '0074-multiple-language-captions',
  '0103': '0103-poetry-reading-annotations',
  '0117': '0117-add-image-thumbnail',
  '0118': '0118-multivalue',
  '0135': '0135-annotating-point-in-canvas',
  '0139': '0139-geolocate-canvas-fragment',
  '0154': '0154-geo-extension',
  '0202': '0202-start-canvas',
  '0219': '0219-using-caption-file',
  '0229': '0229-behavior-ranges',
  '0230': '0230-navdate',
  '0231': '0231-transcript-meta-recipe',
  '0232': '0232-image-thumbnail-canvas',
  '0234': '0234-provider',
  '0240': '0240-navPlace-on-canvases',
  '0253': '0253-using-transcript-file',
  '0258': '0258-tagging-external-resource',
  '0261': '0261-non-rectangular-commenting',
  '0266': '0266-full-canvas-annotation',
  '0269': '0269-embedded-or-referenced-annotations',
  '0283': '0283-missing-image',
  '0299': '0299-region',
  '0306': '0306-linking-annotations-to-manifests',
  '0309': '0309-annotation-collection',
  '0318': '0318-navPlace-navDate',
  '0326': '0326-annotating-image-layer',
  '0346': '0346-multilingual-annotation-body',
  '0377': '0377-image-in-annotation',
  '0434': '0434-choice-av',
  '0464': '0464-reuse-manifest',
  '0466': '0466-link-for-loading-manifest',
  '0485': '0485-contentstate-canvas-region',
  '0489': '0489-multimedia-canvas',
  '0540': '0540-link-for-opening-multiple-canvases',
  '0560': '0560-resources-on-a-timeline',
  '0561': '0561-text-on-image',
  '0599': '0599-drag-and-drop',
  '0608': '0608-mvm-3d',
};

const BASE = 'https://iiif.io/api/cookbook/recipe';

/** レシピのページ（Cookbook） */
export const recipePage = (id: string): string => `${BASE}/${FOLDERS[id]}/`;

// レシピのフォルダの中のファイル
const file = (id: string, name = 'manifest.json'): string => `${BASE}/${FOLDERS[id]}/${name}`;
// 4.0 の版（v4/ の下にあるのは 0001・0002・0003・0219・0253・0608 だけ）
const v4 = (id: string): string => `${BASE}/${FOLDERS[id]}/v4/manifest.json`;

// 1 つのマニフェストだけのレシピ
const one = (id: string, name?: string): RecipeLink[] => [{ url: file(id, name) }];
// 名前つきのマニフェストが複数あるレシピ。ファイル名をそのまま見分けに使う
const files = (id: string, ...names: string[]): RecipeLink[] => names.map((n) => ({ label: n, url: file(id, n) }));
// 4.0 と 3.0 の両方の版があるレシピ
const both = (id: string): RecipeLink[] => [
  { label: 'v4', url: v4(id) },
  { label: 'v3', url: file(id) },
];

type Row = Omit<CookbookRecipe, 'status'> & { status?: RecipeStatus };

const ROWS: Row[] = [
  {
    id: '0001', category: 'basics',
    title: { ja: 'いちばん簡単なマニフェスト（画像）', en: 'Simplest Manifest - Image' },
    links: both('0001'),
  },
  {
    id: '0002', category: 'basics',
    title: { ja: 'いちばん簡単なマニフェスト（音声）', en: 'Simplest Manifest - Audio' },
    links: both('0002'),
  },
  {
    id: '0003', category: 'basics',
    title: { ja: 'いちばん簡単なマニフェスト（動画）', en: 'Simplest Manifest - Video' },
    links: both('0003'),
  },
  {
    id: '0004', category: 'basics',
    title: { ja: '画像と Canvas の大きさが違う', en: 'Image and Canvas with Differing Dimensions' },
    links: one('0004'),
  },
  {
    id: '0005', category: 'basics',
    title: { ja: 'IIIF Image API で拡大表示する', en: 'Support Deep Viewing with Basic Use of a IIIF Image Service' },
    links: one('0005'),
  },
  {
    id: '0006', category: 'basics',
    title: { ja: '多言語の値', en: 'Internationalization and Multi-language Values' },
    links: one('0006'),
  },
  {
    id: '0007', category: 'basics',
    title: { ja: '説明の項目に HTML を入れる', en: 'Embedding HTML in descriptive properties' },
    links: one('0007'),
  },
  {
    id: '0008', category: 'basics',
    title: { ja: '権利の表示', en: 'Rights statement' },
    links: one('0008'),
  },
  {
    id: '0009', category: 'basics',
    title: { ja: 'いちばん簡単な本', en: 'Simple Manifest - Book' },
    links: one('0009'),
  },
  {
    id: '0010', category: 'basics',
    title: { ja: '読む向き（viewingDirection）とページの移り方', en: 'Viewing direction and its effect on navigation' },
    links: files('0010', 'manifest-rtl.json', 'manifest-ttb.json'),
    note: { ja: '右から左（rtl）と、上から下（ttb）の 2 つ', en: 'Right-to-left (rtl) and top-to-bottom (ttb)' },
  },
  {
    id: '0011', category: 'basics',
    title: { ja: '本の見せ方の違い（behavior）', en: 'Book behavior (paging) variations' },
    links: files('0011', 'manifest-continuous.json', 'manifest-individuals.json'),
    note: {
      ja: 'continuous は複数の Canvas を 1 本につなげて表示します（読み込みに 20 秒ほどかかります）',
      en: 'continuous joins the canvases into one strip (takes about 20 seconds to load)',
    },
  },
  {
    id: '0013', category: 'basics',
    title: { ja: '本体の前にプレビュー画像を出す', en: 'Load a Preview Image Before the Main Content' },
    links: one('0013'),
  },
  {
    id: '0014', category: 'basics',
    title: { ja: '音声に画像を添える', en: 'Audio Presentation with Accompanying Image' },
    links: one('0014'),
  },
  {
    id: '0015', category: 'basics',
    title: { ja: '時間メディアを途中から再生する', en: 'Begin playback at a specific point - Time-based media' },
    links: one('0015'),
  },
  {
    id: '0017', category: 'supplementary',
    title: { ja: '音声・動画の文字起こし', en: 'Using Transcripts with A/V Content' },
    links: one('0017'), tab: 'transcript',
  },
  {
    id: '0019', category: 'annotations',
    title: { ja: 'アノテーションに HTML を入れる', en: 'HTML in Annotations' },
    links: one('0019'), tab: 'canvasAnnotations',
  },
  {
    id: '0021', category: 'annotations',
    title: { ja: 'タグづけ', en: 'Simple Annotation - Tagging' },
    links: one('0021'), tab: 'canvasAnnotations',
  },
  {
    id: '0022', category: 'annotations',
    title: { ja: '画像の一部から別の場所へ移る（ホットスポット）', en: 'Redirecting from one Canvas to another resource (Hotspot linking)' },
    links: one('0022'), tab: 'canvasAnnotations',
  },
  {
    id: '0024', category: 'internal',
    title: { ja: '本の章の目次', en: 'Table of Contents for Book Chapters' },
    links: one('0024'), tab: 'structure',
  },
  {
    id: '0025', category: 'internal',
    title: { ja: '新聞の記事ごとに移る', en: 'Navigation by Newspaper Article' },
    links: one('0025'), tab: 'structure',
  },
  {
    id: '0026', category: 'internal',
    title: { ja: '音声・動画の目次', en: 'Table of contents for A/V content' },
    links: one('0026'), tab: 'structure',
  },
  {
    id: '0027', category: 'internal',
    title: { ja: '別のページ順', en: 'Alternative Page Sequences' },
    links: one('0027'), tab: 'structure',
  },
  {
    id: '0029', category: 'basics',
    title: { ja: 'どの資源にもメタデータを付ける', en: 'Metadata on any Resource' },
    links: one('0029'),
  },
  {
    id: '0030', category: 'higher',
    title: { ja: '別々に綴じた複数巻', en: 'Multi-volume Work with Individually-bound Volumes' },
    links: files('0030', 'collection.json', 'manifest_v1.json', 'manifest_v2.json'),
  },
  {
    id: '0031', category: 'higher',
    title: { ja: '1 冊に綴じた複数巻', en: 'Multiple Volumes in a Single Bound Volume' },
    links: one('0031'), tab: 'structure',
  },
  {
    id: '0032', category: 'basics',
    title: { ja: 'いちばん簡単なコレクション', en: 'Simple Collection' },
    links: files('0032', 'collection.json', 'manifest-01.json', 'manifest-02.json'),
  },
  {
    id: '0033', category: 'segmentation',
    title: { ja: '画像の切り替え（Choice）', en: 'Multiple choice of images in a single view' },
    links: one('0033'),
  },
  {
    id: '0035', category: 'segmentation',
    title: { ja: '折り込み・めくり・地図', en: 'Foldouts, Flaps, and Maps' },
    links: one('0035'),
  },
  {
    id: '0036', category: 'segmentation',
    title: { ja: '複数の画像の合成', en: 'Composition from Multiple Images' },
    links: one('0036'),
  },
  {
    id: '0040', category: 'segmentation',
    title: { ja: '画像の回転（2 通り）', en: 'Image Rotation Two Ways' },
    links: files('0040', 'manifest-service.json', 'manifest-css.json'),
  },
  {
    id: '0045', category: 'annotations',
    title: { ja: 'アノテーションの色分け（CSS）', en: 'CSS in an Annotation' },
    links: one('0045'), tab: 'canvasAnnotations',
    note: {
      ja: '外部の CSS が読めないときは、クラスごとの色で代用します',
      en: 'Falls back to per-class colours when the external CSS cannot be read',
    },
  },
  {
    id: '0046', category: 'supplementary',
    title: { ja: '別の形式（PDF など）へのリンク', en: 'Providing Alternative Representations' },
    links: one('0046'),
  },
  {
    id: '0047', category: 'linking',
    title: { ja: '資料のウェブページへのリンク（homepage）', en: 'Linking to Web Page of an Object (homepage)' },
    links: one('0047'),
  },
  {
    id: '0053', category: 'linking',
    title: { ja: '構造化されたメタデータへのリンク（seeAlso）', en: 'Linking to Structured Metadata' },
    links: one('0053'),
  },
  {
    id: '0057', category: 'technical',
    title: { ja: '同じ URL で v2 と v3 のマニフェストを出す', en: 'Making IIIF Presentation API v2 and v3 manifests available at the same URL' },
    links: files('0057', 'manifest-v3.json'), status: 'unchecked',
    note: { ja: 'サーバ側の設定のレシピです', en: 'A recipe about server configuration' },
  },
  {
    id: '0064', category: 'realWorld',
    title: { ja: '1 つの Canvas の音声・動画の目次', en: 'Table of Contents for Multiple A/V files on a Single Canvas' },
    links: one('0064'), tab: 'structure',
  },
  {
    id: '0065', category: 'realWorld',
    title: { ja: '複数の Canvas の音声・動画の目次', en: 'Table of Contents for Multiple A/V files on Multiple Canvases' },
    links: one('0065'), tab: 'structure',
  },
  {
    id: '0068', category: 'realWorld',
    title: { ja: '新聞', en: 'Basic Newspaper' },
    links: files('0068', 'newspaper_title-collection.json', 'newspaper_issue_1-manifest.json', 'newspaper_issue_2-manifest.json'),
    status: 'unchecked',
  },
  {
    id: '0074', category: 'realWorld',
    title: { ja: '多言語の字幕', en: 'Using Caption and Subtitle Files in Multiple Languages with Video Content' },
    links: one('0074'),
  },
  {
    id: '0103', category: 'supplementary',
    title: { ja: '詩の朗読への学術的なアノテーション', en: 'Scholarly Annotation of a Poetry Reading' },
    links: one('0103'), tab: 'annotationTranscript',
  },
  {
    id: '0117', category: 'basics',
    title: { ja: 'マニフェストのサムネイル', en: 'Image Thumbnail for Manifest' },
    links: one('0117'),
  },
  {
    id: '0118', category: 'basics',
    title: { ja: '言語ごとに複数の値を出す', en: 'Displaying Multiple Values with Language Maps' },
    links: one('0118'),
    note: {
      ja: '画像は出ません。レシピの画像の URL（Wikimedia）がエラーを返すためです',
      en: 'The picture does not load, because the image URL in the recipe (Wikimedia) returns an error',
    },
  },
  {
    id: '0135', category: 'annotations',
    title: { ja: '画像の 1 点へのアノテーション', en: 'Annotating a specific point of an image' },
    links: one('0135'), tab: 'canvasAnnotations',
  },
  {
    id: '0139', category: 'annotations',
    title: { ja: '画像の一部を地図上の範囲にする', en: 'Geographic coordinates' },
    links: one('0139'), tab: 'map',
  },
  {
    id: '0154', category: 'basics',
    title: { ja: 'マニフェストを地図に置く（navPlace）', en: 'Locate a Manifest on a Web Map' },
    links: one('0154'), tab: 'map',
  },
  {
    id: '0202', category: 'basics',
    title: { ja: '指定した Canvas から開く', en: 'Load Manifest Beginning with a Specific Canvas' },
    links: one('0202'),
  },
  {
    id: '0219', category: 'supplementary',
    title: { ja: '動画と字幕ファイル', en: 'Using Caption Files with Video Content' },
    links: both('0219'),
  },
  {
    id: '0229', category: 'internal',
    title: { ja: 'サムネイルで動画の区切りを選ぶ（no-nav）', en: 'Adding Thumbnail Navigation and no-nav to a Video Resource' },
    links: one('0229'), tab: 'structure',
  },
  {
    id: '0230', category: 'basics',
    title: { ja: '年代順にたどる（navDate）', en: 'Navigation by Chronology' },
    links: files('0230', 'navdate-collection.json', 'navdate_map_1-manifest.json', 'navdate_map_2-manifest.json'),
  },
  {
    id: '0231', category: 'supplementary',
    title: { ja: '文字起こし・字幕の考え方', en: 'Transcripts, Captions, and Subtitles - General Considerations' },
    links: [], status: 'none',
  },
  {
    id: '0232', category: 'basics',
    title: { ja: 'Canvas のサムネイル（実装の議論）', en: 'Implementation discussion: Thumbnails on Canvases' },
    links: files('0232', 'manifest-image.json', 'manifest-av.json'), status: 'unchecked',
  },
  {
    id: '0234', category: 'basics',
    title: { ja: '提供者を示す（provider）', en: 'Acknowledge Content Contributors' },
    links: one('0234'),
  },
  {
    id: '0240', category: 'basics',
    title: { ja: '複数の Canvas を地図に置く', en: 'Locate Multiple Canvases on a Web Map' },
    links: one('0240'), tab: 'map',
  },
  {
    id: '0253', category: 'supplementary',
    title: { ja: '動画と文字起こし', en: 'Video with Accompanying Transcript' },
    links: [{ label: 'v4', url: v4('0253') }], tab: 'transcript',
  },
  {
    id: '0258', category: 'annotations',
    title: { ja: '外部の資源でタグづけする', en: 'Tagging with an External Resource' },
    links: one('0258'), tab: 'canvasAnnotations',
  },
  {
    id: '0261', category: 'annotations',
    title: { ja: '四角でない範囲へのアノテーション', en: 'Annotation with a Non-Rectangular Polygon' },
    links: one('0261'), tab: 'canvasAnnotations',
  },
  {
    id: '0266', category: 'annotations',
    title: { ja: 'いちばん簡単なアノテーション', en: 'Simplest Annotation' },
    links: one('0266'), tab: 'canvasAnnotations',
  },
  {
    id: '0269', category: 'annotations',
    title: { ja: '埋め込んだアノテーションと参照するアノテーション', en: 'Embedded or Referenced Annotations' },
    links: one('0269'), tab: 'canvasAnnotations',
  },
  {
    id: '0283', category: 'basics',
    title: { ja: '画像の欠けたページ', en: 'Missing Images in a Sequence' },
    links: one('0283'),
  },
  {
    id: '0299', category: 'basics',
    title: { ja: '画像の一部だけを使う', en: 'Addressing a spatial region' },
    links: one('0299'),
  },
  {
    id: '0306', category: 'annotations',
    title: { ja: '外部のアノテーションをマニフェストに結びつける', en: 'Linking external Annotations targeting a Canvas to a Manifest' },
    links: one('0306'), tab: 'canvasAnnotations',
  },
  {
    id: '0309', category: 'annotations',
    title: { ja: 'アノテーションのコレクション', en: 'Using Annotation collections' },
    links: one('0309'), tab: 'canvasAnnotations',
  },
  {
    id: '0318', category: 'realWorld',
    title: { ja: '資料を場所と時間に置く', en: 'Locating an Item in Place and Time' },
    links: one('0318', 'collection.json'),
  },
  {
    id: '0326', category: 'annotations',
    title: { ja: '特定の画像（レイヤー）へのアノテーション', en: 'Annotate a specific images or layers' },
    links: one('0326'), tab: 'canvasAnnotations',
  },
  {
    id: '0346', category: 'annotations',
    title: { ja: '多言語のアノテーション', en: 'Annotating in Multiple Languages' },
    links: one('0346'), tab: 'canvasAnnotations',
  },
  {
    id: '0377', category: 'annotations',
    title: { ja: 'アノテーションの中の画像', en: 'Image in annotations' },
    links: one('0377'), tab: 'canvasAnnotations',
  },
  {
    id: '0434', category: 'realWorld',
    title: { ja: '音声の形式の切り替え（Choice）', en: 'Multiple Choice of Audio Formats in a Single View (Canvas)' },
    links: one('0434'),
  },
  {
    id: '0464', category: 'basics',
    title: { ja: 'マニフェストの一部を再利用する', en: 'Reuse parts of a Manifest' },
    links: one('0464'), status: 'unchecked',
  },
  {
    id: '0466', category: 'sharing',
    title: { ja: 'リンクでビューアにマニフェストを読み込む', en: 'Loading a manifest with a viewer using a link' },
    links: [{ url: file('0001') }],
    note: { ja: '0001 のマニフェストを iiif-content で開きます', en: 'Opens the 0001 manifest with iiif-content' },
  },
  {
    id: '0485', category: 'sharing',
    title: { ja: 'Canvas の一部を指定して開く', en: 'Open a specific region of a canvas in a viewer' },
    links: [{ label: 'annotation.json', url: file('0485', 'annotation.json') }],
  },
  {
    id: '0489', category: 'segmentation',
    title: { ja: '時間のある Canvas に複数の種類のメディアを置く', en: 'Rendering Multiple Media Types on a Time-Based Canvas' },
    links: one('0489'),
  },
  {
    id: '0540', category: 'sharing',
    title: { ja: '複数の Canvas を開くリンク', en: 'Sharing a link for opening two or more Canvases' },
    links: [{ label: 'annotation.json', url: file('0540', 'annotation.json') }],
    note: {
      ja: '2 つのマニフェストにある Canvas を並べて表示します',
      en: 'Shows canvases from two manifests side by side',
    },
  },
  {
    id: '0560', category: 'segmentation',
    title: { ja: '時間軸の上に資源を順に並べる', en: 'Rendering Resources Sequentially on a Timeline' },
    links: one('0560'), status: 'unchecked',
  },
  {
    id: '0561', category: 'annotations',
    title: { ja: 'Canvas に見える文字を置く', en: 'Visible Text Resource on a Canvas' },
    links: one('0561'), status: 'unchecked',
  },
  {
    id: '0599', category: 'sharing',
    title: { ja: 'ドラッグ・アンド・ドロップで開く', en: 'Drag and drop' },
    links: [{}],
    note: {
      ja: '空のビューアを開き、レシピのページの IIIF ロゴを画面に落とします',
      en: 'Open an empty viewer and drop the IIIF logo from the recipe page onto it',
    },
  },
  {
    id: '0608', category: 'basics',
    title: { ja: 'いちばん簡単なマニフェスト（3D）', en: 'Simplest Manifest - 3D' },
    links: [{ label: 'v4', url: v4('0608') }],
    note: { ja: '読み込みに 15〜20 秒かかります', en: 'Takes 15–20 seconds to load' },
  },
];

export const COOKBOOK_RECIPES: CookbookRecipe[] = ROWS.map((r) => ({ ...r, status: r.status ?? 'checked' }));

/** 「開く」の行き先（/viewer）。URL が無ければ空のビューア */
export const recipeHref = (r: CookbookRecipe, link: RecipeLink): string =>
  link.url ? `/viewer?${contentParam(link.url)}${r.tab ? `&tab=${r.tab}` : ''}` : '/viewer';

export const recipeById = (id: string): CookbookRecipe | undefined => COOKBOOK_RECIPES.find((r) => r.id === id);
