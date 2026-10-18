---
date: 2026-10-16
order: 2
title.ja: 注釈が数万件ある画像でも、拡大・縮小が軽くなりました
title.en: Zooming stays smooth on images with tens of thousands of annotations
action.usecase: suikeichuzu-annotations
usecases: suikeichuzu-annotations
---

## ja

画像の上の注釈の印は、見えている範囲に 500 個を超えるとき、1 枚の絵にまとめて描くようにしました。注釈が 2 万件ある地図で、拡大 1 段にかかる時間が約 330ms から、ほとんどの段で 15ms 以下になりました。まとめて描いている間も、印を押せば注釈を選べます。拡大して印が少なくなると、これまでどおりの印に戻ります。

## en

When more than 500 annotation marks are in view, they are now drawn together as a single image. On a map with 20,000 annotations, most zoom steps went from about 330 ms to under 15 ms. You can still click a mark to select its annotation, and once you zoom in far enough the usual marks return.
