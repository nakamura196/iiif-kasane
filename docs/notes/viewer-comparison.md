# 既存の IIIF ビューアとの比較

公開・移行の記事（zenn）で「既存のツールとの差」を書くための記録。推測で「できない」と書かないよう、
実際に読ませた結果と、ソースを読んだ結果を分けて残す。

## 2026-10-18 公式デモに Kasane の見本を読ませた

Chrome で各ビューアの公式デモを開き、`?iiif-content=` などで manifest を渡した。

上野（Presentation 4 草案、Scene・Choice・SearchService2・navPlace・Georeference 入り）:
https://nakamura196.github.io/hongo-campus-iiif/ueno.json

- Mirador 公式デモ（projectmirador.org/embed/）: label と Scene の名前「1 of 1 · Around Ueno station」は出る。描画域は空白。
- Universal Viewer v4 デモ（uv-v4.netlify.app）: 何も出ない（目録欄も出ない）。
- Clover デモ（samvera-labs.github.io/clover-iiif/docs/viewer/demo）: 日本語の label・summary・requiredStatement・
  thumbnail・Choice のプルダウン「PLATEAU LOD2（写真つき）」・Search タブまで出る。3D は描かない。
  Search タブで「駅」を検索すると「Something went wrong / Cannot read properties of null (reading 'id')」で
  ビューア全体が落ちる。検索サービス自体は 2 件返している。当たり先が Scene + PointSelector なので、
  Canvas を前提にした処理で null になると見ている（Clover のコードは未確認）。

認証の見本（Presentation 3、Auth 2.0 の active / 利用条件への同意）:
https://iiif-auth-demo.ldas.jp/manifest/terms/hyakki.json

- Mirador 公式デモ: タイトルは出るが描画域は白紙、同意の画面は出ない。console に
  `TypeError: Cannot read properties of undefined (reading 'match')`（Array.filter の中）。
  Mirador の main は auth/1 と auth/0 の profile しか持たない（下のソース調査）ので、
  profile を持たない AuthProbeService2 を profile で絞り込もうとして落ちていると見ている（未検証）。
- Universal Viewer v4 デモ: 目録情報は出る。画像域は黒のまま、同意の画面は出ない。

## 2026-10-18 ソースと公式の対応表を読んだ

各リポジトリを clone して grep した。grep で見つからなかったものは「コードに無し」とし、「非対応」より弱い扱い。
GitHub API の回数上限で issue の検索が一部できていないので、そのセルは不明のまま。

| ツール | 版 | 公開日 | ライセンス |
|---|---|---|---|
| Mirador | v4.3.0 | 2026-10-12 | Apache-2.0 |
| Universal Viewer | v4.4.4 | 2026-08-19 | MIT |
| Clover | v3.16.2（main は 3.17.0） | 2026-09-29 | MIT |
| Smithsonian Voyager | v0.67.0 | 2026-10-02 | Apache-2.0 |
| Kompakkt Viewer | リリース無し | — | AGPL-3.0 |
| Triiiceratops | 1.2.2 | 2026-10-07 | MIT |

- IIIF Cookbook の Presentation 4 対応表（https://iiif.io/api/cookbook/recipe/matrix-v4/）は 10 のビューアを載せる。
  「Single 3D Model」が Yes なのは Voyager と Kompakkt だけ。Mirador・UV・Annona・Clover・Theseus・TIFY・Triiiceratops は No。
  表に Scene の複数物体・認証・検索・navPlace・実寸の行は無い。
- Voyager の IIIF 対応は `dev-iiif` ブランチだけ（最終コミット 2026-07-22）で、リリースには入っていない。
  `source/client/io/IIIFManifestReader.ts` が Scene・模型・カメラ・光、Scene 内の 2D Canvas、PointSelector の注釈、
  Scene の `spatialScale` を読む。Choice・認証・検索は読まない。書き出し（IIIFManifestWriter.ts）もある。
- UV は glb / gltf / usdz を model-viewer の拡張に、DICOM を Aleph の拡張に回す。媒体ごとの拡張で、Scene ではない。
- IIIF 3D グループの草案 manifest のビューア一覧（IIIF/3d の `_data/viewers.yml`）: MorphoSource（UV ベース）、
  Voyager、UV 4、X3DOM のビューア、Kompakkt。

軸ごと（Kasane の機能に対応させた軸）:

- 3D と画像を同じ画面: Voyager（dev-iiif のみ）。UV は媒体ごとの拡張で一部。Mirador・Clover はコードに無し。
- Auth 2.0: Mirador の main は auth/1 まで（Auth 2.0 は作業中、issue #4384）。UV・Clover・Voyager はコードに無し。
- Content Search: Mirador は v0/v1、Clover は v1・v2、UV は v2 が不明。3D の当たりを扱うものは無い。
- 実寸で測る: Voyager が独自の計測道具を持ち、dev-iiif で Scene の spatialScale を読む。Mirador・UV・Clover はコードに無し。
- 2 つを並べて比べる: Mirador は複数ウィンドウ（2D）。3D の 2 模型を同期して比べるものは見当たらない。
- 地図: Clover の Map（MapLibre）が navPlace と Georeference（@allmaps/maplibre で重ね合わせ）を扱う。Mirador・UV はコードに無し。
- 美術館に掛ける: 見当たらない（IIIF 3D の README が Mozilla Hubs のギャラリーの試作に触れるが、生きているかは未確認）。
- 3D の注釈: Voyager（dev-iiif、PointSelector）。Kompakkt は独自の注釈。Sketchfab は独自（IIIF ではない）。
- Choice: Mirador（2D）・Clover は対応。UV は open issue（#119・#749・#1756）。Voyager はコードに無し。

記事で書くときの前提: Kasane の 3D は Presentation 4 草案で、ほかのビューアの多くは Presentation 3 が中心。
「草案に早く追いついている」とは書けるが、「ほかが劣る」とは書かない。地図は Clover にもあるので Kasane だけの強みにしない。

確かめていないこと:

- Voyager の dev-iiif を実際に動かして上野を読ませること（次にやる）
- Kompakkt・Triiiceratops の認証・検索・地図
- Mirador の白紙が本当に profile の絞り込みで落ちているのか

出典:

- https://github.com/ProjectMirador/mirador（src/config/settings.js、src/state/sagas/auth.js、src/lib/MiradorCanvas.js）、issue #4384
- https://github.com/UniversalViewer/universalviewer（src/content-handlers/iiif/IIIFContentHandler.ts）
- https://github.com/samvera-labs/clover-iiif（src/components/Map、src/components/Viewer/Viewer/Viewer.tsx）
- https://github.com/smithsonian/dpo-voyager（dev-iiif: source/client/io/IIIFManifestReader.ts）
- https://github.com/Kompakkt/Viewer（src/app/helpers/iiif-data-helper.ts）
- https://github.com/IIIF/3d（_data/viewers.yml、temp-draft-4.md）
- https://iiif.io/api/presentation/4.0/
- https://iiif.io/api/cookbook/recipe/matrix-v4/
- https://www.web3d.org/new/node/2830
- https://glenrobson.github.io/iiif_stuff/3d_prototypes/
