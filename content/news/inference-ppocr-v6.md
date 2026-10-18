---
date: 2026-10-16
order: 3
title.ja: 推論タブに PP-OCRv6 を足しました（活字の日本語の読み落としが減りました）
title.en: PP-OCRv6 in the Inference tab, with fewer missed characters in printed Japanese
action.viewer: https://dl.ndl.go.jp/api/iiif/3048008/manifest.json
action.params: tab=inference&canvas=24
note: 推論タブを開いた状態の例（NDL「国立国会図書館年報」1952 の 24 コマ目。実験ノートで公式と突き合わせたページ）
---

## ja

活字の資料を行ごとに読み取る PP-OCRv6 を、推論タブで選べるようにしました。PP-OCRv5 で抜けがちだった片仮名も、ほぼ読めるようになりました。モデル（約 31MB）は初回にだけ読み込み、画像はどこにも送りません。

## en

PP-OCRv6, which reads printed material line by line, is now available in the Inference tab. Katakana that PP-OCRv5 often missed is now read almost entirely. The model (about 31 MB) downloads once, and the image is never sent anywhere.
