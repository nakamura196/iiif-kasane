@AGENTS.md

# Rules for working on Kasane

How to add a feature (where files go, rules for parallel work) is in `packages/iiif-viewer/EXTENDING.md`.

## Write in English

This is a public repository with users and contributors outside Japan. Write in English so that people who do not read Japanese can follow the history and join the work.

- Commit messages, PR titles and descriptions, and issues (since 2026-10-17). Outside contributors may write in Japanese (`CONTRIBUTING.md` says so), but write in English when you work here.
- Developer documents: this file, `EXTENDING.md`, the READMEs, `docs/` (since 2026-11-13).
- New code comments. Existing Japanese comments are translated when you touch that file; do not translate many files at once in an unrelated PR (large diffs collide with parallel PRs).
- The first line of a commit is a short imperative sentence (e.g. `Fix caption timing for multi-video canvases`). See `CONTRIBUTING.md`.
- A PR description says first what changes for users, then how it is built.
- Do not rewrite past commits or closed PRs (rewriting history breaks links).
- Text shown in the UI keeps both Japanese and English versions, as before (a separate rule).

### Japanese goes in its own files

Do not mix Japanese and English in one file. Japanese text goes only in files whose name marks the language: `*.ja.json`, `*.ja.md` (e.g. `README.ja.md`, `messages/ja.json`, `messages/features/<feature>.ja.json`). Every other file is in English. This keeps the rule simple and makes the remaining Japanese easy to find:

    git grep -l -P '[\p{Hiragana}\p{Katakana}]' -- ':!*.ja.*' ':!**/ja.json'

The English file links to its Japanese counterpart (as `README.md` links to `README.ja.md`). Files that still mix the two languages (news items, use cases, samples, older notes, code comments) are moved over step by step.

## Review and a reproduction test before merging (standard step)

Since 2026-11-13 Kasane has outside users: the `iiif-kasane` npm package and sites that embed the viewer. A bug breaks their sites, not only kasane.ldas.jp. This rule came from #334 (images of a Manifest opened from a Collection did not show), which an outside user reported.

- Run `/code-review` on a PR that changes code before merging it. Use `high` for small changes. Before a large change or an npm release, use `ultra` (several agents review in the cloud; the maintainer starts it).
- For each finding, write in the PR description or a comment whether it was fixed, and why if not.
- A bug fix comes with a reproduction test that was confirmed to fail before the fix.
- The public API (Web Component attributes, exported types such as `ViewerState` and `DisplayProps`, URL parameters) only grows. Renaming or removing needs the maintainer's agreement. If it must change, say so in the release notes.

## When you add a feature, decide whether to feature it (standard step)

Visitors do not notice a feature just because it exists. When you add a feature or a visible improvement, check each of these three before opening the PR, and **write in the PR description whether you added it and why**. Deciding not to is fine (small fixes, internal rework); skipping the check is not.

1. **Use case**: add one entry to `src/lib/usecases.ts`. It opens a real item in the way the feature shows best (`tab=` etc.). Take the thumbnail with `scripts/capture-thumbnails.mjs` (`public/thumbnails/usecases/<id>.webp`).
2. **News**: add one file `content/news/<id>.md` (a title in Japanese and English, a body of 2–3 sentences, where "Try it" goes, and related use case ids; see `content/news/README.md`). One item per file, so parallel PRs do not collide. The newest 5 appear on the top page, all of them at `/news`, and each at `/news/<id>`.
3. **Sample**: if a short manifest shows the feature, add it to `src/lib/samples.ts` (an IIIF Cookbook recipe, for example).

Also say whether a how-to video (a use case's `video`) would help. The maintainer decides whether to make one.

## When you add a page, check how it looks without arguments (standard step)

Opening `/georef` and similar pages without a manifest shows their entry screen. Feature checks easily miss it: in PR #180 a heading ran off the top of the screen, and a reference to a video that did not exist broke the export check in CI.

When you add a page or change an entry screen, run this before opening the PR. The page list is read from `src/app/[locale]/`, so no test needs to be added (dynamic pages such as `[id]` are not covered).

    npx next dev -p <port>   # in another terminal; in a worktree, avoid 3838
    E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/entryPages.spec.ts

It checks Japanese and English at desktop and phone widths for JS errors, failed loads of site files, headings that run off the screen, and horizontal scrolling. Even when the test passes, look at a new page on screen once.
