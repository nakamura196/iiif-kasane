# 3D で一覧する（/browse/）

任意の IIIF の Collection（資料の一覧）か Manifest（ページの一覧）を、サムネイルのカードにして
3D の空間に並べ、一覧するページ。元は [nakamura196/iiif-3d-gallery](https://github.com/nakamura196/iiif-3d-gallery)
（Next.js 製、2026-10-25 時点の main）で、2026-10 に Kasane へ統合した。
旧サイト（iiif-3d-gallery.vercel.app）は、ここへ移るように変えてある。

## 置き場所

- `engine.ts` — 3D の描画と操作。元の `src/lib/gallery.ts`（three.js の CSS3DRenderer）を TypeScript のまま移した。
  カードは HTML 要素なので、拡大しても文字が崩れない
- `loadSource.ts` — 資料を取ってくる。Presentation 2 の変換・Curation・画像 1 枚の info.json は、
  ビューアと同じ手順（`fetchManifest`）に任せる。Collection がサムネイルを持たないときは、Manifest を取って補う
- `browse.css` — カード・グループの板・キューブの枠の見た目。色はサイト共通のトークン（`--ds-*`）から取る。
  three.js はカードの外側の箱の transform を毎フレーム書くので、持ち上がる動きは内側（`.bw-card-inner`）に付ける
- `icons.tsx` — 並べ方などのアイコン（依存を足さず SVG を直に書く）
- `../../lib/browse.ts` — React にも three.js にも依存しない部分（カードへの直し方・URL・比較のリンク）と、`browse.test.ts`
- `../page/BrowseContent.tsx` — 画面。状態は React の `useState`。組み方はビューア・地図と画像のページに合わせた:
  上に細い帯（題名・点数・並べ方の切り替え）、右（狭い画面では下）にビューアと同じ `SidePanel` とタブ（一覧・Keep・設定）、
  空間の上に丸い操作の帯（前後・正面・視点を戻す）。操作のしかたの案内は一度閉じたら出さない（`browse-hint-dismissed`）

## 元からの主な変更

- 状態管理の zustand は `useState` に、アニメーションの @tweenjs/tween.js は gsap に変えた。依存は増やしていない
- IIIF Presentation 2 の変換は `@iiif/parser` ではなく、Kasane のビューアのもの（`upgradeToV3`）を使う
- Mirador は使わない。「詳細を見る」は Kasane のビューア（`/viewer/`）、「比較」は `/compare/` へ移る
- ダブルクリックで Keep した作品は、資料ごとに localStorage（`browse-keep:<URL>`）に覚える
- 狭い画面（スマートフォン）では、右の欄は下に畳める欄（ビューアと同じ `SidePanel`）になる。回転・拡大はタッチでも動く
- ドラッグで回しただけのときは、離したときのクリックを選択として数えない
- 元の「グリッド」は「グループ」に作り替えた。分け方（資料ごと、または metadata の項目）を選ぶと、束ごとに見出し（名前と枚数）付きの
  板を作り、壁に掛けた掲示板のように詰めて並べる。右の一覧の束を押すと、その板へ寄ってほかを薄くする。
  分け方に使える項目は `groupableFields`（カードの 3 割以上が値を持ち、値の種類が 2〜40 のもの。ほぼ 1 件ずつ違う項目・長い文・URL は除く）。
  値が数（年など）なら小さい順、ほかは大きい束から。値が複数あるカードは最初の値の束に入れる。値の無いカードは最後の「（なし）」
- 元の「2D」は table と同じ並びで回転を止めるだけだったので、並べ方から外し、設定の「回さない（ずらす・拡大のみ）」にした
- 初めて並べるときは遠く斜めから寄り、球・らせんは 4 秒触らなければゆっくり横に回る。
  動きを減らす設定（prefers-reduced-motion）のときは、どちらもしない
- 「視点を戻す」は、回して傾いたカメラの上の向きもまっすぐに戻す（TrackballControls は回すと上の向きごと転がすため）
- metadata は Curation の member・Manifest の Canvas・Collection の中の Manifest が持っていれば使う。
  Collection の Manifest を後から取ったとき（サムネイルを補うとき）の metadata は、まだ使っていない
- 並べる数の上限（既定 60、`?limit=`、最大 500）を足した。サムネイルの無い Collection は Manifest を 1 件ずつ取るため
- 引数なしで開いたときは、元の既定の資料（dcb-one.vercel.app。認証が掛かり 401 になった）を並べず、
  入口の画面（URL の入力欄と見本 3 件）を出す
- 資料を入れる欄（URL）をサイドバーに足した。入口とサイドバーの欄、ページの引数のどれでも、
  Kasane の検索やビューアのページの URL（`?u=`・`?iiif-content=` などに資料の URL を持つもの）を渡せば、
  中の資料の URL を取り出して開く（`unwrapIiifUrl`）
- Curation（CODH の Curation API）は、検索のページと同じ読み手（`curationReader`）で、member（顔などの範囲）ごとに
  1 枚のカードにする。画像は元の Manifest の画像サービスから範囲を切り出したもの。カードからは `pos=` でビューアを開く。
  元の Manifest を全部取ってから切り出すので、並べる数の上限（`?limit=`）は掛けず、500 件までにする。
  範囲のカードは比較のページに渡す形が無いので、比較は出さない

捨てたもの: `?collection=<名前>`（元のリポジトリに入っていた錦絵の JSON）と、そのデータ・画像・Mirador 一式。

## URL で指定できること

- 資料: `?manifest=<URL>`（元のサイトと同じ。旧サイトからの転送はこの形のまま届く）、
  Kasane の `?iiif-content=<URL>`、キュレーションの `?curation=<URL>`、美術館と同じ `?u=<URL>`
- `?layout=table|sphere|helix|grid`（既定 table。grid は画面では「グループ」）。
  古いリンクの `?layout=flat` は table と「回さない」で開く
- `?lock=1`（回さない）
- `?group=<項目名>`（グループの分け方。既定は `manifest` ＝資料ごと）
- `?x=<項目名>&y=<項目名>&z=<項目名>`（キューブの軸。無ければ資料から選ぶ）
- `?limit=<数>`（並べる数。既定 60）

ページが書き換える URL（共有用）は `?iiif-content=...&layout=...&limit=...`（グループ・キューブのときは分け方・軸も）。

## 権利

- 3D は three.js（MIT）、動きは gsap（標準ライセンス。Kasane の他のページと同じ）
- 画像は Collection・Manifest が指す先のもの。権利は提供機関に帰属する
