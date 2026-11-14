---
date: 2026-11-14
title.ja: 表示中の資料を、ほかの IIIF ビューアで開けるようになりました
title.en: Open the shown item in other IIIF viewers
action.viewer: https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json
action.params: tab=views
note: 公開 URL で確かめたビューアだけを載せている（Universal Viewer・Mirador・IIIF Curation Viewer・Clover・Theseus）。手元の画像には出ない。
---

## ja

右パネルの「ほかの表示」タブに、Universal Viewer、Mirador、IIIF Curation Viewer、Clover、Theseus で開くリンクを足しました。表示中の資料（コレクションから開いた場合はその資料）を、新しいタブで開きます。Presentation のバージョンや、画像・音声・動画の違いで開けないビューアは出しません。

## en

The "Other views" tab of the right panel now links to Universal Viewer, Mirador, the IIIF Curation Viewer, Clover and Theseus. Each opens the item you are looking at (the entry itself when you came from a Collection) in a new tab. Viewers that cannot read the item's Presentation version or its images, audio or video are left out.
