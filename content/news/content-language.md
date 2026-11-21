---
date: 2026-11-20
title.ja: 資料のことばを、画面の言語とは別に選べるようになりました
title.en: Choose the language of a resource, apart from the screen language
action.viewer: https://iiif.io/api/cookbook/recipe/0006-text-language/manifest.json
action.params: content-lang=fr
---

## ja

題名・説明・メタデータ・注釈が複数の言語で書かれた資料では、右の欄の上に「資料の言語」の選択が出ます。画面は日本語のまま、資料だけ英語やフランス語などで読めます。選んだ言語は URL の content-lang で共有でき、埋め込みでは content-language 属性で指定できます。

## en

When a resource has its title, summary, metadata or annotations in more than one language, a "Content language" menu appears above the side panel. Keep the screen in Japanese and read the resource in English, French or another language. The choice can be shared with the content-lang URL parameter, and an embed can set it with the content-language attribute.
