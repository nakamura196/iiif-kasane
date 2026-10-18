---
date: 2026-10-15
order: 3
title.ja: 比較画面で、キュレーション 2 本を組ごとに位置を合わせて重ねられるようにしました
title.en: Compare: overlay two curations pair by pair, aligned
action.usecase: genji-hyakunin-diff
usecases: genji-hyakunin-diff
---

## ja

同じ数の項目を持つ 2 つのキュレーションを比較画面で開くと、1 組ずつ送って見比べられます。位置合わせの JSON を URL の align= で渡すと、B の画像を A に合わせて曲げて重ねます。重ね方には「差」と「色分け」を足しました。同じ所は消え、違う所だけが浮かびます。源氏百人一首の 2 つの版（引目・開目）で試せます。

## en

Open two curations with the same number of items in Compare and step through them pair by pair. Pass an alignment JSON as align= in the URL and image B is warped onto image A. The overlay gains Difference and Tint blends: what matches fades out and only what differs stands out. Try it with two editions of the Genji Hyakunin Isshu (hikime and kaimoku).
