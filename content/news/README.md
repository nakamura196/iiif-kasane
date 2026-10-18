# お知らせ（1 件 1 ファイル）

`content/news/<id>.md` を 1 つ置くと、トップの「お知らせ」（新しい 5 件）、`/news` の一覧、
`/news/<id>` の詳細ページに出る。一覧のファイルは書き換えなくてよい。
以前は `src/lib/news.ts` の配列の先頭に足していたが、並行する PR が毎回そこでぶつかったので分けた。

`npm run dev`・`build`・`test`・`lint` の前に `scripts/build-news.mjs` が全ファイルを読み、
`src/lib/news.generated.json`（git に入れない）にまとめる。`npx next dev` などを直接流すときは、先に `npm run news`。

## 書き方

```
---
date: 2026-10-18
title.ja: 3D モデルの 2 点間の距離を測れるようになりました
title.en: Measure distances on 3D models
action.usecase: ueno
usecases: ueno
---

## ja

本文（2〜3 文。何ができるようになったか）

## en

Body.
```

- ファイル名が id（`/news/<id>` の URL）。英小文字・数字・ハイフン。公開後は変えない
- 先頭の `---` の間は「key: value」の 1 行ずつ。`.` で入れ子になる（`title.ja` → `title: { ja }`）
- `date` は YYYY-MM-DD。新しい順に並ぶ。同じ日に複数あるときは `order:`（数字。大きいほど上）
- 「試す」の行き先（どれか 1 つ）
  - `action.usecase: <ユースケースの id>` … そのユースケースの開き方で開く
  - `action.viewer: <マニフェストの URL>` と、必要なら `action.params: tab=contentSearch&q=...`
  - `action.href: /samples`（サイト内のパス）。言語で違うときは `action.href.ja` と `action.href.en`
  - 外部の記事なら `action.external: true` と `action.label: readArticle`
- `video.ja` / `video.en` … YouTube の videoId。片方だけなら両方の言語でそれを出す。`video: cookbook` は Cookbook の動画
- `usecases: a, b` … 関連するユースケースの id（カンマ区切り）
- `note:` … 書き手向けの覚え書き。サイトには出ない（何行でも）

書き漏れ（片方の言語、存在しないユースケース、videoId の形）は `src/lib/news.test.ts` が見つける。

## 載せていないもの

- 同じ場所の注釈・キー付きタグ（研究段階、2026-09-28）の告知。掲載の了承が得られたら戻す
