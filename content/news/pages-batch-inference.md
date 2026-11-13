---
date: 2026-11-13
order: 1
title.ja: ページ一覧から、モデルを全ページにかけられるようになりました
title.en: Run a model on every page from the pages list
action.viewer: https://dl.ndl.go.jp/api/iiif/1877025/manifest.json
action.params: tab=pages
note: PR #331. The model must be downloaded in the Inference tab first; the grid view shows the run bar. Results stay in the browser only (no saving or export yet), so no use case for now.
---

## ja

ページ一覧のグリッド表示で、ダウンロード済みのモデルを選び、全ページに順にかけられます。読み終えたページのサムネイルには、区分ごとの色で枠が付きます。区分のボタンを押すと、その区分（図版など）があるページだけが目立ちます。途中で止めても、続きから再開できます。

## en

In the grid view of the pages list, choose a downloaded model and run it on every page in turn. Thumbnails of finished pages get boxes colored by class. Press a class button and only the pages with that class (such as figures) stand out. You can stop the run and continue from where it left off.
