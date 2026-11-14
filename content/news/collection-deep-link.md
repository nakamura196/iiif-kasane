---
date: 2026-11-14
title.ja: コレクション内のマニフェストに直接リンクできるようになりました
title.en: Link straight to a manifest inside a Collection
action.viewer: https://iiif.io/api/cookbook/recipe/0032-collection/manifest-01.json
action.params: collection=https%3A%2F%2Fiiif.io%2Fapi%2Fcookbook%2Frecipe%2F0032-collection%2Fcollection.json
note: Closes #335. URL form ?iiif-content=<manifest>&collection=<top>&collection=<sub>.
---

## ja

コレクションからマニフェストを開くと、アドレスバーにその場所が書かれます。そのリンクを開くと、マニフェストが表示され、「戻る」でコレクションに戻れます。入れ子のコレクションも、たどった順に戻れます。

## en

Opening a manifest from a Collection now writes its location into the address bar. Open that link and the manifest shows, with Back leading to the Collection. Nested Collections are written too, and Back goes through them in order.
