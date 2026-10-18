---
date: 2026-10-15
order: 2
title.ja: 資料の中の文字を探せる「文字の検索」タブを足しました
title.en: Search text: find words inside an item
action.viewer: https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00026283/manifest
action.params: tab=contentSearch&q=petrus
usecases: mdz-content-search
---

## ja

マニフェストに検索の窓口（IIIF Content Search API 1.0・2.0）が書かれた資料では、右の「文字の検索」タブから本文の語を探せます。当たった語は前後の文と一緒に一覧に出て、画像の上にも枠が付きます。押すとそのページへ移ります。行・語などの単位（Text Granularity）が書かれていれば、単位で絞り込めます。

## en

When a manifest offers a search service (IIIF Content Search API 1.0 or 2.0), the new Search text tab finds words in the item. Each hit is listed with the words around it and framed on the image; click one to go to its page. Hits that state their unit (line, word …; Text Granularity) can be filtered by unit.
