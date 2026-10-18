---
date: 2026-10-18
order: 1
title.ja: 3D シーンの注釈も「テキスト検索」で探せるようになりました
title.en: Text search now works on 3D scenes
action.viewer: https://nakamura196.github.io/hongo-campus-iiif/ueno.json
action.params: tab=contentSearch
action.label: tryIt
---

## ja

3D シーンのマニフェストに検索サービス（IIIF Content Search 2.0）が書かれていれば、「テキスト検索」タブでシーン上の注釈を探せます。当たりを押すと、注釈の一覧で選んだときと同じように、カメラがその注釈へ寄り、ラベルが開きます。検索サービスが無い資料でも、読み込んだ注釈の見出しと本文から探せます。

## en

When a 3D scene manifest declares a IIIF Content Search 2.0 service, the Text search tab can now find annotations placed in the scene. Clicking a hit does the same as choosing it in the annotation list: the camera flies to the annotation and its label opens. Without a search service, the tab searches the titles and texts of the loaded annotations.
