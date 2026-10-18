---
date: 2026-10-17
order: 2
title.ja: 大きな絵図は、拡大した範囲だけを推論にかけられるようになりました
title.en: Run inference on just the area you are zoomed into
action.viewer: https://kasane.ldas.jp/manifests/cma-fukutomi-story.json
action.params: tab=inference
usecases: cma-fukutomi-story
note: 拡大した状態では開けない（/viewer は zoom・centerX・centerY を読まない）。開いたら拡大してから押してもらう
---

## ja

推論タブに「表示中の範囲で実行」を足しました。絵巻のような横長の画像は、全体を読むと縮めすぎて文字や顔が潰れますが、拡大して見えている範囲だけを切り出して読めます。範囲を移してもう一度押すと、結果を足していきます。『福富草紙』の顔の検出では、全体では 0 件でしたが、2 か所の範囲で 14 件見つかりました。

## en

The Inference tab has a new button, “Run on the visible area”. Reading a long image such as a handscroll as a whole shrinks it so much that text and faces are lost; now only the area you are zoomed into is cut out and read. Move to another area and press it again to add to the results. With face detection on the Tale of Fukutomi, the whole image gave no faces, while two zoomed-in areas gave 14.
