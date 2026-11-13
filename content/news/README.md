# News (one item per file)

Add one file `content/news/<id>.md` and it appears in "News" on the top page (the newest 5), in the list at `/news`, and on its own page at `/news/<id>`. You do not need to edit any list file. News used to be added at the top of an array in `src/lib/news.ts`, but parallel PRs collided there every time, so it was split.

Before `npm run dev`, `build`, `test` and `lint`, `scripts/build-news.mjs` reads all files and writes `src/lib/news.generated.json` (not in git). When you run `npx next dev` or similar directly, run `npm run news` first.

## Format

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

Body (2–3 sentences: what you can do now).
```

- The file name is the id (the URL `/news/<id>`): lowercase letters, digits and hyphens. Do not change it after publishing.
- Between the `---` lines, one `key: value` per line. A `.` nests (`title.ja` → `title: { ja }`).
- `date` is YYYY-MM-DD. Newest first. For several items on the same day, use `order:` (a number; larger goes higher).
- Where "Try it" goes (one of these):
  - `action.usecase: <use case id>` opens the item as that use case does.
  - `action.viewer: <manifest URL>`, plus `action.params: tab=contentSearch&q=...` if needed.
  - `action.href: /samples` (a path on the site). If it differs by language, `action.href.ja` and `action.href.en`.
  - For an outside article, `action.external: true` and `action.label: readArticle`.
- `video.ja` / `video.en`: a YouTube videoId. If only one is given, it is shown for both languages. `video: cookbook` is the Cookbook video.
- `usecases: a, b`: ids of related use cases (comma-separated).
- `note:`: a note for writers. Not shown on the site (any number of lines).

`src/lib/news.test.ts` catches omissions (a missing language, a use case that does not exist, a malformed videoId).

## Not published

- The announcement of shared-region annotations and keyed tags (at the research stage, 2026-09-28). Add it back once publication is agreed.
