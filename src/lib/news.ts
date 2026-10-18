import { COOKBOOK_VIDEO_ID } from '@/lib/cookbookVideo';
import { SITE_URL } from '@/lib/site';
import { USE_CASES, hrefOf, type UseCase } from '@/lib/usecases';

// お知らせ。トップには新しいものから NEWS_ON_HOME 件、/news に全件、/news/<id> に 1 件ずつの詳細を出す。
// 1 件足すときは NEWS の先頭に 1 項目を書き足す（新しいものが上）。ページの部品は触らなくてよい。

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

const viewer = (manifest: string, params: string) =>
  `/viewer/?iiif-content=${encodeURIComponent(manifest)}&${params}`;

export const NEWS: NewsItem[] = [
  {
    id: 'auth2-substitute',
    date: '2026-10-17',
    title: {
      ja: '同意の前に代わりの画像（劣化版）を出す型に対応しました',
      en: 'Showing a degraded version before consent (IIIF Auth 2.0)',
    },
    body: {
      ja: 'IIIF Auth 2.0 で、同意やログインの前に代わりの画像（白黒や小さな版）を出す型に対応しました。同意の前は代わりの画像と案内を出し、同意すると高精細な画像に替えます。国立国会図書館『百鬼夜行絵巻』で試せる例をユースケースに足しました。',
      en: 'Kasane now supports the IIIF Auth 2.0 pattern that shows a substitute (such as a small grayscale version) before consent or login. It shows the substitute with the prompt, then switches to the full-resolution image once access is granted. An example using Hyakki yagyō emaki from the National Diet Library is in the use cases.',
    },
    action: { href: hrefOfUseCase('degraded-auth') },
    usecases: ['degraded-auth', 'wellcome-auth'],
  },
  {
    id: 'other-views-tab',
    date: '2026-10-17',
    title: {
      ja: '地図と 3D の美術館への入口を、右の「ほかの表示」タブに移しました',
      en: 'The map and 3D gallery now open from the Other views tab',
    },
    body: {
      ja: 'これまでビューアの左下に出ていた「地図に重ねて見る」「3D の美術館で見る」のボタンを、右の「ほかの表示」タブにまとめました。絵や動画にボタンが重ならなくなります。美術館は、見かた（見回す・歩く）・内装・画質・枚数を選んでから「閲覧」で開けます。',
      en: 'The “View on the map” and “View in 3D gallery” buttons that sat at the bottom left of the viewer are now in the Other views tab on the right, so they no longer cover images or videos. For the gallery, choose the mode (look around or walk), interior, quality and number of works, then press View.',
    },
    action: { href: viewer(`${SITE_URL}/manifests/geo-hongo-buildings.json`, 'tab=views') },
  },
  {
    id: 'inference-view-region',
    date: '2026-10-17',
    title: {
      ja: '大きな絵図は、拡大した範囲だけを推論にかけられるようになりました',
      en: 'Run inference on just the area you are zoomed into',
    },
    body: {
      ja: '推論タブに「表示中の範囲で実行」を足しました。絵巻のような横長の画像は、全体を読むと縮めすぎて文字や顔が潰れますが、拡大して見えている範囲だけを切り出して読めます。範囲を移してもう一度押すと、結果を足していきます。『福富草紙』の顔の検出では、全体では 0 件でしたが、2 か所の範囲で 14 件見つかりました。',
      en: 'The Inference tab has a new button, “Run on the visible area”. Reading a long image such as a handscroll as a whole shrinks it so much that text and faces are lost; now only the area you are zoomed into is cut out and read. Move to another area and press it again to add to the results. With face detection on the Tale of Fukutomi, the whole image gave no faces, while two zoomed-in areas gave 14.',
    },
    // 拡大した状態では開けない（/viewer は zoom・centerX・centerY を読まない）。開いたら拡大してから押してもらう
    action: { href: viewer(`${SITE_URL}/manifests/cma-fukutomi-story.json`, 'tab=inference') },
    usecases: ['cma-fukutomi-story'],
  },
  {
    id: 'story-ui',
    date: '2026-10-17',
    title: {
      ja: 'ストーリーの見せ方を新しくしました：絵巻の帯・解説の札・自動再生',
      en: 'A new look for stories: a scroll strip, captions on the image, and autoplay',
    },
    body: {
      ja: 'ストーリーを開くと、画面の上端に絵巻全体の細い帯が出て、今どこを見ているかが分かります。場面から場面へは横に滑るように移り、解説は絵の上の札に出ます。「再生」を押すと、場面を順に自動でめくります。',
      en: 'When a story is open, a thin strip of the whole scroll along the top shows where you are. Moving between scenes glides sideways, and the commentary appears on a card over the image. Press Play to step through the scenes automatically.',
    },
    action: { href: hrefOfUseCase('cma-fukutomi-story') },
    video: { ja: 'Na6Ta3zouM4', en: '2T5SDTOdcMg' },
    usecases: ['cma-fukutomi-story'],
  },
  {
    id: 'story-fukutomi',
    date: '2026-10-16',
    title: {
      ja: 'ストーリーの例を足しました：『福富草紙』を 1 巻の中でたどる',
      en: 'A new story example: the Tale of Fukutomi in one handscroll',
    },
    body: {
      ja: 'クリーブランド美術館の絵巻『福富草紙』を、13 の場面に分けて読み進めるストーリーです。1 枚の長い画像の中を、右から左へ場面ごとに寄っていきます。解説は日英の 2 か国語で、画面の言語に合わせて切り替わります。',
      en: 'A story that reads the Cleveland Museum of Art’s handscroll of the Tale of Fukutomi in thirteen scenes. It moves from right to left within one long image, zooming to each scene. The commentary is in Japanese and English and follows the interface language.',
    },
    action: { href: hrefOfUseCase('cma-fukutomi-story') },
    usecases: ['cma-fukutomi-story'],
  },
  {
    id: 'puzzle-tab',
    date: '2026-10-16',
    title: {
      ja: '表示中の画像でジグソーパズルができるようになりました',
      en: 'Turn the current image into a jigsaw puzzle',
    },
    body: {
      ja: '右のパネルに「パズル」タブを足しました。マスの数を選んで「はじめる」を押すと、表示中の画像が切り分けられて混ざります。2 つのピースを順に押す（またはドラッグする）と入れ替わり、元の絵に戻せば完成です。',
      en: 'A new Puzzle tab in the right-hand panel. Choose a grid and press Start, and the current image is cut up and shuffled. Click two pieces in turn (or drag one onto another) to swap them, and finish by putting the picture back together.',
    },
    action: {
      href: viewer('https://purl.stanford.edu/hs631zg4177/iiif/manifest', 'tab=puzzle'),
    },
    video: { ja: '-DT_kGvJOpU', en: 'zujWTk3s66U' },
    usecases: ['puzzle-kuniezu'],
  },
  {
    id: 'inference-ppocr-v6',
    date: '2026-10-16',
    title: {
      ja: '推論タブに PP-OCRv6 を足しました（活字の日本語の読み落としが減りました）',
      en: 'PP-OCRv6 in the Inference tab, with fewer missed characters in printed Japanese',
    },
    body: {
      ja: '活字の資料を行ごとに読み取る PP-OCRv6 を、推論タブで選べるようにしました。PP-OCRv5 で抜けがちだった片仮名も、ほぼ読めるようになりました。モデル（約 31MB）は初回にだけ読み込み、画像はどこにも送りません。',
      en: 'PP-OCRv6, which reads printed material line by line, is now available in the Inference tab. Katakana that PP-OCRv5 often missed is now read almost entirely. The model (about 31 MB) downloads once, and the image is never sent anywhere.',
    },
    // 推論タブを開いた状態の例（NDL「国立国会図書館年報」1952 の 24 コマ目。実験ノートで公式と突き合わせたページ）
    action: {
      href: viewer('https://dl.ndl.go.jp/api/iiif/3048008/manifest.json', 'tab=inference&canvas=24'),
    },
  },
  {
    id: 'annotation-marks-canvas',
    date: '2026-10-16',
    title: {
      ja: '注釈が数万件ある画像でも、拡大・縮小が軽くなりました',
      en: 'Zooming stays smooth on images with tens of thousands of annotations',
    },
    body: {
      ja: '画像の上の注釈の印は、見えている範囲に 500 個を超えるとき、1 枚の絵にまとめて描くようにしました。注釈が 2 万件ある地図で、拡大 1 段にかかる時間が約 330ms から、ほとんどの段で 15ms 以下になりました。まとめて描いている間も、印を押せば注釈を選べます。拡大して印が少なくなると、これまでどおりの印に戻ります。',
      en: 'When more than 500 annotation marks are in view, they are now drawn together as a single image. On a map with 20,000 annotations, most zoom steps went from about 330 ms to under 15 ms. You can still click a mark to select its annotation, and once you zoom in far enough the usual marks return.',
    },
    action: { href: hrefOfUseCase('suikeichuzu-annotations') },
    usecases: ['suikeichuzu-annotations'],
  },
  {
    id: 'annotation-list-search',
    date: '2026-10-16',
    title: {
      ja: '「注釈」タブに検索欄を付け、数万件の注釈でも軽く動くようにしました',
      en: 'Annotations tab: a search box, and smooth with tens of thousands of annotations',
    },
    body: {
      ja: '右の「注釈」タブは、見えている分だけを描くようにしました。注釈が 2 万件ある地図でも、一覧を軽く送れます。検索欄に語を入れると、一覧と画像の上の印が当たった注釈だけになります。「選んだ注釈へ画像を寄せる」を入れると、一覧で押した注釈の場所へ画像が拡大されます。',
      en: 'The Annotations tab now draws only the rows in view, so even a map with 20,000 annotations scrolls smoothly. Type in the new search box and both the list and the marks on the image narrow to the matches. With “Zoom to the chosen annotation” on, clicking an annotation in the list zooms the image to it.',
    },
    action: { href: hrefOfUseCase('suikeichuzu-annotations') },
    video: { ja: 'OUCUFk4GWM0', en: 'TQMXYxvUcDg' },
    usecases: ['suikeichuzu-annotations'],
  },
  {
    id: 'compare-curation-align',
    date: '2026-10-15',
    title: {
      ja: '比較画面で、キュレーション 2 本を組ごとに位置を合わせて重ねられるようにしました',
      en: 'Compare: overlay two curations pair by pair, aligned',
    },
    body: {
      ja: '同じ数の項目を持つ 2 つのキュレーションを比較画面で開くと、1 組ずつ送って見比べられます。位置合わせの JSON を URL の align= で渡すと、B の画像を A に合わせて曲げて重ねます。重ね方には「差」と「色分け」を足しました。同じ所は消え、違う所だけが浮かびます。源氏百人一首の 2 つの版（引目・開目）で試せます。',
      en: 'Open two curations with the same number of items in Compare and step through them pair by pair. Pass an alignment JSON as align= in the URL and image B is warped onto image A. The overlay gains Difference and Tint blends: what matches fades out and only what differs stands out. Try it with two editions of the Genji Hyakunin Isshu (hikime and kaimoku).',
    },
    action: { href: hrefOfUseCase('genji-hyakunin-diff') },
    usecases: ['genji-hyakunin-diff'],
  },
  {
    id: 'content-search',
    date: '2026-10-15',
    title: {
      ja: '資料の中の文字を探せる「文字の検索」タブを足しました',
      en: 'Search text: find words inside an item',
    },
    body: {
      ja: 'マニフェストに検索の窓口（IIIF Content Search API 1.0・2.0）が書かれた資料では、右の「文字の検索」タブから本文の語を探せます。当たった語は前後の文と一緒に一覧に出て、画像の上にも枠が付きます。押すとそのページへ移ります。行・語などの単位（Text Granularity）が書かれていれば、単位で絞り込めます。',
      en: 'When a manifest offers a search service (IIIF Content Search API 1.0 or 2.0), the new Search text tab finds words in the item. Each hit is listed with the words around it and framed on the image; click one to go to its page. Hits that state their unit (line, word …; Text Granularity) can be filtered by unit.',
    },
    action: {
      href: viewer('https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest', 'tab=contentSearch&q=petrus'),
    },
    usecases: ['mdz-content-search'],
  },
  {
    id: 'video-region-annotations',
    date: '2026-10-15',
    title: {
      ja: '動画の中の範囲に付いた注釈を、枠として重ねられるようにしました',
      en: 'Annotations on a region of a video now appear as boxes',
    },
    body: {
      ja: '時間と範囲を指す注釈（target が #t=…&xywh=… など）を、その時間のあいだだけ動画の上に枠で出します。注釈タブの一覧には時刻が付き、押すとその時刻へ移ります。AI で見つけた人物の枠を IIIF の注釈にした、信州デジタルコモンズの映像で試せます。',
      en: 'Annotations that point at a time and a region of a video (a target like #t=…&xywh=…) are drawn as boxes over the video while their time plays. The list in the Annotations tab shows each time, and clicking one goes there. Try it on a Shinshu Digital Commons film with boxes on people found by AI, written as IIIF annotations.',
    },
    action: { href: viewer('https://kasane.ldas.jp/manifests/sample-manifest-video-objects.json', 'tab=canvasAnnotations') },
    usecases: ['video-objects'],
  },
  {
    id: 'vr-gallery',
    date: '2026-10-14',
    title: {
      ja: 'IIIF を 3D の美術館として歩ける「ギャラリー」を足しました',
      en: 'Gallery: walk through IIIF as a 3D museum',
    },
    body: {
      ja: 'Curation・Collection・マニフェストの画像を、3D の美術館の壁に掛けて歩きながら見られます。見回す・一人称・三人称（アバター）の 3 つの歩き方があり、作品は近づいて拡大できます。これまで別のサイトだった IIIF VR Gallery を Kasane に移しました。',
      en: 'Hang the images of a Curation, Collection or manifest on the walls of a 3D museum and walk around them. Look around, walk in first person, or follow an avatar in third person, and zoom into any work. IIIF VR Gallery, formerly a separate site, now lives in Kasane.',
    },
    action: { href: '/gallery' },
    usecases: ['gallery-walk'],
    // 英語版の動画のみ（日本語のページでも英語版を出す）
    video: { en: '91AhCgI7TXY' },
  },
  {
    id: 'click-outline',
    date: '2026-10-14',
    title: {
      ja: '推論タブに「クリックで切り出す」を足しました',
      en: 'Click to outline, new in the Inference tab',
    },
    body: {
      ja: '画像の中の物をクリックすると、SAM 2.1 がその輪郭を多角形の注釈にします。Shift+クリックで範囲を足し、Alt+クリックで削れます。',
      en: 'Click a thing in the image and SAM 2.1 turns its outline into a polygon annotation. Shift+click adds to the shape, and Alt+click takes away from it.',
    },
    // 推論タブを開いた状態の例（face-detection と同じ花見のキュレーション。「クリックで切り出す」を選んで使う）
    action: {
      href: viewer('https://nakamura196.github.io/ndl-face-finder/curations/works/edonohanami.json', 'pos=2&tab=inference'),
    },
    video: { ja: 'RCZvHpaHSc8', en: 'rRyTJmxkckM' },
    usecases: ['click-outline-edonohanami'],
  },
  {
    id: 'cookbook-video',
    date: '2026-10-14',
    title: {
      ja: '「Cookbook のサンプル」の動画を作り直しました',
      en: 'A new video for the Cookbook samples',
    },
    body: {
      ja: 'IIIF Cookbook のレシピをカテゴリごとに Kasane で開き、声で説明する動画です。日本語版と英語版があります。サンプルの一覧の各レシピから、動画のその場面へ飛べます。',
      en: 'The video opens the IIIF Cookbook recipes in Kasane category by category, with narration. It comes in Japanese and English. Each recipe on the samples page links to its scene in the video.',
    },
    action: { href: '/samples' },
    video: COOKBOOK_VIDEO_ID,
  },
  {
    id: 'face-detection',
    date: '2026-10-14',
    title: {
      ja: '推論タブに「顔の検出（日本の絵画）」を足しました',
      en: 'Faces in Japanese art, a new model in the Inference tab',
    },
    body: {
      ja: '浮世絵・絵巻・近代の美人画などの顔を、ブラウザの中で探して枠で示します。画像を切り分けて調べるので、人混みの小さな顔も拾えます。画像はどこにも送りません。',
      en: 'It finds the faces in ukiyo-e, picture scrolls and modern bijin-ga in your browser and marks them with boxes. The image is scanned in parts, so small faces in a crowd are found too. The image is never sent anywhere.',
    },
    // 推論タブを開いた状態の例（NDL「江戸名所」、ndl-face-finder の花見のキュレーション）
    action: {
      href: viewer('https://nakamura196.github.io/ndl-face-finder/curations/works/edonohanami.json', 'pos=2&tab=inference'),
    },
    usecases: ['curation-search'],
    video: { ja: 'l2j9h0g8SLo', en: 'XX1Tdc4Sxss' },
  },
  {
    id: 'cookbook-all-recipes',
    date: '2026-10-14',
    title: {
      ja: 'IIIF Cookbook の全 76 レシピを並べました',
      en: 'All 76 IIIF Cookbook recipes in the samples',
    },
    body: {
      ja: '「Cookbook のサンプル」に、IIIF Cookbook の全 76 レシピを番号順に並べました。カテゴリで絞り込め、各レシピをそのまま Kasane で開けます。',
      en: 'The Cookbook samples page now lists all 76 IIIF Cookbook recipes in numbering order. Filter them by category and open each one in Kasane.',
    },
    action: { href: '/samples' },
    video: { ja: 'oYfYjzzFfrU', en: 'eh2za9P9LfY' },
  },
  {
    id: 'story-tab',
    date: '2026-10-14',
    title: {
      ja: '右パネルに「ストーリー」タブを足しました',
      en: 'A new Story tab',
    },
    body: {
      ja: 'マニフェストの注釈を順に送りながら、その場面に寄って説明を読めます。既にあるストーリー用のマニフェストも、そのまま開けます。',
      en: 'Step through the annotations of a manifest, gliding to each scene as you read. Existing tour manifests open as they are.',
    },
    action: { href: hrefOfUseCase('ndl-emaki-story') },
    usecases: ['ndl-emaki-story'],
  },
  {
    id: 'inference-ocr',
    date: '2026-10-14',
    title: {
      ja: '右パネルに「推論」タブを足しました（ブラウザの中で OCR）',
      en: 'A new Inference tab (OCR in your browser)',
    },
    body: {
      ja: 'NDL古典籍OCR-Lite と NDLOCR-Lite をブラウザの中で動かし、表示中の画像の文字を読み取ります。モデルは初回にだけ読み込みます。画像はどこにも送りません。',
      en: 'Kasane runs NDL Kotenseki OCR-Lite and NDLOCR-Lite in your browser to read the text of the image on screen. The model downloads once. The image is never sent anywhere.',
    },
    action: { href: hrefOfUseCase('meizukushi-ocr') },
    usecases: ['meizukushi-ocr'],
    video: { ja: 'IYhzoqRM7QY', en: 'dJS7uoeb-S0' },
  },
  {
    id: 'maps',
    date: '2026-10-14',
    title: {
      ja: '地図の表示を広げました',
      en: 'More maps',
    },
    body: {
      ja: '右パネルに「地図」タブを足しました。画像に地点の付いたマニフェストをジオリファレンス表示で開けます。地点の付いた絵図は、地図に重ねられます。',
      en: 'The side panel has a Map tab. Manifests whose points sit on the image open in the georeferencing view. Georeferenced pictures can be laid over the map.',
    },
    action: { href: hrefOfUseCase('iiif-geo') },
    usecases: ['iiif-geo', 'globe-georef'],
  },
  {
    id: 'auth2',
    date: '2026-10-14',
    title: {
      ja: 'ログインや同意が必要な画像（IIIF Auth 2.0）に対応しました',
      en: 'Images behind login or consent (IIIF Auth 2.0)',
    },
    body: {
      ja: '閲覧に同意やログインが要る画像は、許可が出るまでぼかして表示します。Wellcome Collection の例をユースケースに足しました。',
      en: 'Images that need consent or a login are blurred until access is granted. A Wellcome Collection example is in the use cases.',
    },
    action: { href: hrefOfUseCase('wellcome-auth') },
    usecases: ['wellcome-auth'],
    video: { ja: 'Trl4ksr5TBU', en: 'etqp6liTkFo' },
  },
  {
    id: 'cookbook-recipes',
    date: '2026-10-14',
    title: {
      ja: 'IIIF Cookbook のレシピへの対応を広げました',
      en: 'More IIIF Cookbook recipes',
    },
    body: {
      ja: 'v4 の字幕、注釈の画像・スタイル・Wikidata、音声・動画の形式の選択に対応しました。別々のマニフェストにまたがる content state と、Collection の年表表示にも対応しました。',
      en: 'Kasane now handles v4 captions, images, styles and Wikidata in annotations, and choosing a playable audio or video format. Content states spanning several manifests and a timeline view of Collections work too.',
    },
    action: { href: '/samples' },
    video: { ja: '8_0_pyBlAyc', en: 'lsKHqDCUBo4' },
  },
  {
    id: 'compare-video',
    date: '2026-10-13',
    title: {
      ja: '比較ページの紹介動画を公開しました',
      en: 'A video introducing the compare page',
    },
    body: {
      ja: '2 つのモデルを左右・スワイプ・スパイグラスで見比べる操作を動画で紹介します。URL での共有と、説明欄の開閉も扱っています。',
      en: 'The video shows how to compare two models side by side, with a swipe, or through a spyglass. It also covers sharing by URL and the collapsible side panel.',
    },
    action: { href: hrefOfUseCase('ueno') },
    video: { ja: 'Sb7m0J6pRTM', en: 'wOh2JiaHkS8' },
    usecases: ['ueno'],
  },
  {
    id: 'usecases-search',
    date: '2026-10-13',
    title: {
      ja: 'ユースケースと検索のページを公開しました',
      en: 'New use cases and search pages',
    },
    body: {
      ja: 'ユースケースのページでは、実際の資料で Kasane を使った例を紹介します。検索のページでは、コレクションやキュレーションを横断して探せます。IIIF Curation API にも対応しました。',
      en: 'The use cases page shows Kasane at work on real collections. The search page searches across collections and curations. Kasane also reads the IIIF Curation API.',
    },
    action: { href: '/usecases' },
    usecases: ['curation-search', 'curation'],
  },
  {
    id: 'layers',
    date: '2026-10-12',
    title: {
      ja: '重ねた画像をレイヤーとして扱えるようにしました',
      en: 'Image layers',
    },
    body: {
      ja: '重ねた画像を 1 枚ずつ表示・非表示にでき、不透明度と重ね順も変えられます。順に重ねていく・外していく再生もできます。画像の Choice は、比較ページで見比べられます。',
      en: 'Show or hide each painted image, and change its opacity and stacking order. The layers can also be played in or out one by one. Image Choices can be compared on the compare page.',
    },
    action: { href: hrefOfUseCase('kaishi') },
    usecases: ['kaishi'],
  },
  {
    id: 'compare-models',
    date: '2026-10-11',
    title: {
      ja: '2 つのモデルを見比べられるようにしました',
      en: 'Comparing two models',
    },
    body: {
      ja: '比較ページで、左右に並べる・スワイプ・スパイグラスの 3 通りで見比べられます。同じ場所に置いた複数のモデルの切り替えと、回転・全体表示・真上からの視点などの操作ボタンも足しました。説明欄は開閉できます。',
      en: 'The compare page shows two models side by side, with a swipe, or through a spyglass. You can also switch between models placed in the same scene, and use a view toolbar (rotate, fit, top view). The side panel can be collapsed.',
    },
    action: { href: hrefOfUseCase('ueno') },
    usecases: ['ueno', 'shelley'],
  },
  {
    id: 'pictures-viewpoints',
    date: '2026-10-01',
    title: {
      ja: '写真の表示と初期の視点に対応しました',
      en: 'Pictures and initial viewpoints',
    },
    body: {
      ja: 'アノテーションに添えた写真を表示し、マニフェストで指定した視点で開くようにしました。地図と並べる表示では、全部のピンが入るように地図を合わせ、「全体を表示」ボタンを足しました。注釈のカードは、どのページでも同じ見た目にそろえました。',
      en: 'Pictures attached to annotations are shown, and models open at the viewpoint given in the manifest. Beside a map, the map fits all pins, with a “Show all” button. Annotation cards look the same on every page.',
    },
    action: { href: hrefOfUseCase('globe-georef') },
    usecases: ['globe-georef'],
    video: { ja: 'NAVE09zRedo', en: 'b8qKqzuNNZY' },
  },
  // 同じ場所の注釈・キー付きタグ（研究段階、2026-09-28）の告知。掲載の了承が得られたら戻す
  {
    id: '3d-rendering',
    date: '2026-07-09',
    title: {
      ja: '3D モデルの表示を改善しました',
      en: 'Better 3D model rendering',
    },
    body: {
      ja: '環境光（IBL）で質感が出るようにしました。アノテーションへ移るときはその面に正対し、開いたときはモデル全体が収まるように合わせます。',
      en: 'Image-based lighting gives models a truer look. Moving to an annotation turns the view to face it, and models fit the screen when they open.',
    },
    action: { href: hrefOfUseCase('globe-annotations') },
    usecases: ['globe-annotations'],
  },
  {
    id: 'pa4-converter-article',
    date: '2026-05-25',
    title: {
      ja: '技術記事「IIIF 3D Viewer：Presentation API 4 コンバーターの実装」を公開しました',
      en: 'Article: “IIIF 3D Viewer: Implementing a Presentation API 4 Converter”',
    },
    body: {
      ja: 'IIIF Presentation API 4 のマニフェストを読み込むための変換の仕組みを、技術記事にまとめました。',
      en: 'A technical article on how the viewer converts IIIF Presentation API 4 manifests.',
    },
    action: {
      href: {
        ja: 'https://tech.ldas.jp/ja/posts/iiif-3d-viewer-presentation-api-4-converter/',
        en: 'https://tech.ldas.jp/en/posts/iiif-3d-viewer-presentation-api-4-converter/',
      },
      external: true,
      label: 'readArticle',
    },
  },
];

function hrefOfUseCase(id: string): string {
  const u = USE_CASES.find((x) => x.id === id);
  if (!u) throw new Error(`news: unknown use case ${id}`);
  return hrefOf(u.open);
}

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
