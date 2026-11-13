# IIIF Manifests

This directory contains IIIF Presentation API 4.0 (3D TSG) manifests for the 3D viewer.

Legacy Presentation 3.0 manifests with the project's custom `3DSelector` /
`camPos` extension are accepted at runtime and converted to v4 in-memory by
`src/lib/services/manifestConverter.ts`. New manifests should be authored in
v4 form directly (Scene, PointSelector / WKTSelector, PerspectiveCamera).

## Sample Manifests

- `sample-manifest.json` - 石淵家地球儀 (Ishibuchi Family Globe)
- `sample-manifest-with-annotations.json` - 石淵家地球儀 (Ishibuchi Family Globe) - With Annotations
- `sample-manifest-viewpoints.json` - 石淵家地球儀 - 上の複製の Scene に視点（PerspectiveCamera）を 3 つ（日本・ヨーロッパ・真上）足したもの。
  最初の視点で開き、ビューアの視点ボタンで切り替わることを試す。注釈の視点（cameraAnnotation）とは別
- `sample-manifest-region-tags.json` - 石淵家地球儀 - Shared Region and Keyed Tag Extension の例。
  正本は [iiif-region-tag-extension](https://github.com/nakamura196/iiif-region-tag-extension) の
  `examples/manifest.json`。拡張の例を変えたら、ここにも複製し直す（試験がこのファイルを読む）
- `sample-manifest-region-tags-image.json` - 上の拡張を画像（2D）に使った例。東京大学附属図書館の絵図（IIIF Image API）に、同じ場所を指す注釈を 3 件・2 件・単独 1 件で付けた。画像でも同じ場所の注釈が枠 1 つにまとまることを確かめる用で、公開ページには載せない
- `geo-hongo-buildings.json` - 東京帝國大學本部構内及農學部建物鳥瞰圖（ジオリファレンス、対応点 27）。
  元は https://geo.ldas.jp/manifest.json（nakamura196/iiif_geo）。対応点に OpenStreetMap の現在の建物名を付けた。
  経緯は `docs/notes/georef-overlay.md`

- `physdim-hyakki.json` - 実寸の物差し（IIIF physdim service）の例。
  Canvas の service に `physicalScale`（1 ピクセルあたりの実寸）と `physicalUnits` を持つ画像。
  元は mirador-physical-ruler の `demo/`。画像は東京大学の IIIF サーバから読む。経緯は `docs/notes/physdim-ruler.md`

- `ndl-emaki-story.json` - 国立国会図書館の電子展示会「絵巻の世界」第2章第2節を、ストーリー（describing 注釈を順に読む）にしたもの。
  8 資料・10 段・2 章（Range）。本文と場面の領域は展示会のページのまま。`scripts/build-ndl-emaki-story.mjs` で作り直す。経緯は `docs/notes/storytelling.md`

- `sample-manifest-mixed.json` - 画像（Canvas）・3D（Scene）・動画（Canvas）・音声（Timeline）を 1 つにした IIIF Presentation 4 の見本。
  コンテンツは IIIF Cookbook の 0001・0608・0003・0002 から。件ごとに表示が切り替わることを見せる用（Issue #269 の返信がきっかけ）

- `youtube-tutorials/` - YouTube の動画を IIIF の Video として参照する例。`collection.json` に日本語版・英語版のマニフェスト 2 件、各 4 本（IIIF Kasane の使い方動画、作成は中村 覚）。
  字幕は動画を作ったときの WebVTT を複製した。YouTube 側は限定公開

## Adding New Manifests

To add a new manifest:

1. Create a new JSON file in this directory
2. Ensure the 3D model file is placed in `/public/models/`
3. Update the model URL in the manifest to use the local path (e.g., `/models/your-model.glb`)
4. Update internal IDs to use relative paths