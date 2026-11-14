---
date: 2026-11-13
order: 2
title.ja: 推論タブで PP-OCRv6 の medium も選べるようになりました（small より読み誤りが少なめ）
title.en: PP-OCRv6 medium in the Inference tab, with fewer misreadings than small
action.viewer: https://iiif.archive.org/iiif/3/alicesadventures00carruoft/manifest.json
action.params: tab=inference&canvas=20
note: The Internet Archive copy of Alice (1872), the page used for the browser timing (small 5.2 s, medium 20.5 s, WebGPU + wasm). Measurements are in docs/notes/browser-inference.md (2026-11-13). small is kept as it was. No use case: the model choice is a small addition to an existing tab.
---

## ja

PP-OCRv6 の大きい版（medium）を足しました。今までの small も残してあり、どちらかを選べます。誤字の割合は、英語の活字で small 1.43%・medium 1.35%、漢籍（嘉興蔵の 5,714 字）で small 1.65%・medium 1.45% でした。medium はファイルが約 139MB と大きく、読み取りに 4 倍ほどの時間がかかります。

## en

PP-OCRv6 now also comes in its larger version (medium). The small version is still there, so you can choose either. The character error rate was 1.43% (small) and 1.35% (medium) on English print, and 1.65% and 1.45% on a Chinese woodblock book (5,714 characters of the Jiaxing Canon). medium's files are larger (about 139 MB), and reading takes about 4 times as long.
