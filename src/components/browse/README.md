# 3D で一覧する（/browse/）

任意の IIIF の Collection（資料の一覧）か Manifest（ページの一覧）を、サムネイルのカードにして
3D の空間に並べ、一覧するページ。元は [nakamura196/iiif-3d-gallery](https://github.com/nakamura196/iiif-3d-gallery)
（Next.js 製、2026-10-25 時点の main）で、2026-10 に Kasane へ統合した。
旧サイト（iiif-3d-gallery.vercel.app）は、ここへ移るように変えてある。

## 置き場所

- `engine.ts` — 3D の描画と操作。元の `src/lib/gallery.ts`（three.js の CSS3DRenderer）を TypeScript のまま移した。
  カードは HTML 要素なので、拡大しても文字が崩れない
- `defaultSource.ts` — 引数なしで開いたときに並べる、Kasane のユースケース
- `loadSource.ts` — 資料を取ってくる。Presentation 2 の変換・Curation・画像 1 枚の info.json は、
  ビューアと同じ手順（`fetchManifest`）に任せる。Collection がサムネイルを持たないときは、Manifest を取って補う
- `browse.css` — カードの見た目（元の `globals.css` の `.element` 系）。ダークテーマは `.dark` で切り替える
- `../../lib/browse.ts` — React にも three.js にも依存しない部分（カードへの直し方・URL・比較のリンク）と、`browse.test.ts`
- `../page/BrowseContent.tsx` — 画面（操作帯・サイドバー・拡大表示）。状態は React の `useState`

## 元からの主な変更

- 状態管理の zustand は `useState` に、アニメーションの @tweenjs/tween.js は gsap に変えた。依存は増やしていない
- IIIF Presentation 2 の変換は `@iiif/parser` ではなく、Kasane のビューアのもの（`upgradeToV3`）を使う
- Mirador は使わない。「詳細を見る」は Kasane のビューア（`/viewer/`）、「比較」は `/compare/` へ移る
- ダブルクリックで Keep した作品は、資料ごとに localStorage（`browse-keep:<URL>`）に覚える
- 狭い画面（スマートフォン）では、サイドバーを「一覧」ボタンで重ねて出す。回転・拡大はタッチでも動く
- ドラッグで回しただけのときは、離したときのクリックを選択として数えない
- グリッドは、元は「書名」というメタデータで束ねていた。いまは入れ子の Collection の名前（無ければ「書名」か Title）で束ね、
  束が 1 つしかないときは、奥行きに重ねた面にする
- 並べる数の上限（既定 60、`?limit=`、最大 500）を足した。サムネイルの無い Collection は Manifest を 1 件ずつ取るため
- 引数なしで開いたときの資料は、元の dcb-one.vercel.app（認証が掛かり 401 になった）をやめ、
  Kasane のユースケース（サイト内のサムネイル。`defaultSource.ts`）にした。外のサーバに頼らないので、入口が壊れない
- 資料を入れる欄（URL）をサイドバーに足した

捨てたもの: `?collection=<名前>`（元のリポジトリに入っていた錦絵の JSON）と、そのデータ・画像・Mirador 一式。

## URL で指定できること

- 資料: `?manifest=<URL>`（元のサイトと同じ。旧サイトからの転送はこの形のまま届く）、
  Kasane の `?iiif-content=<URL>`、キュレーションの `?curation=<URL>`、美術館と同じ `?u=<URL>`
- `?layout=table|sphere|helix|grid|flat`（既定 table）
- `?limit=<数>`（並べる数。既定 60）

ページが書き換える URL（共有用）は `?iiif-content=...&layout=...&limit=...`。

## 権利

- 3D は three.js（MIT）、動きは gsap（標準ライセンス。Kasane の他のページと同じ）
- 画像は Collection・Manifest が指す先のもの。権利は提供機関に帰属する
