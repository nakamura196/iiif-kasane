# @nakamura196/iiif-viewer を npm に公開する

## 2026-10-20 公開できる形にした（ブランチ viewer-npm）

- それまで: `exports` が TypeScript の元のファイル（`./src/react/index.ts`）を指していた。このリポジトリの中（Next.js の `transpilePackages`）でしか動かない。npm には未公開（`npm view` で 404）
- いま: `npm run build -w @nakamura196/iiif-viewer` で次を書き出す
  - `dist/iiif-viewer.js` と `style.css`: `<iiif-viewer>` タグ（これまでどおり `vite.config.ts`）
  - `dist/lib`: 入口 `.` と `./core`。元のファイル 1 つにつき 1 つ、依存する部品は import のまま残す（`vite.lib.config.ts`）。
    `src/react/` の下のファイルには `'use client'` を付ける。`core` には付けないので、サーバ側でも使える
  - `dist/types`: 型の定義（`tsc -p tsconfig.build.json`）
- サイトはこれまでどおり元のファイルを読む。`tsconfig.json` の `paths`（Next.js と tsc）と `vitest.config.ts` の別名で、
  `@nakamura196/iiif-viewer` と `/core` を `src/` に向けた。`copy-element.mjs` は `dist/lib`・`dist/types` を `out/element/` に写さない
- 推論の worker（`new Worker(new URL('./worker.ts', import.meta.url))`）の落とし穴: 既定の設定では、ライブラリのビルドが
  `"/assets/worker-….js"`（サイトの根からの絶対パス。使う側では壊れる）と書き、さらにファイルを別の場所に置いた。
  `base: './'` と `worker.rollupOptions.output.entryFileNames: 'assets/[name]-[hash].js'` で、
  `new URL("../../assets/worker-….js", import.meta.url)` とファイルの場所が合った
- 試してやめた案: three.js を入れなくても使えるようにする（入口 `./three` に分け、`peerDependenciesMeta` で optional にする）。
  3D の部分は遅れて読み込む作りだが、使う側のビルドの道具は、それでも three を探しに行く。Vite では
  `"Canvas" is not exported by "__vite-optional-peer-dep:@react-three/fiber…"` で失敗した。
  そこで three・three-stdlib・@react-three/fiber・@react-three/drei・gsap は必須のままにした。ブラウザが取りに行くのは Scene を出すときだけ
- 確かめたこと: `npm pack` で作った tgz を、リポジトリの外の空のプロジェクト 2 つに入れた
  - Vite + React 19: `skipLibCheck: false` で `tsc` が通る（`@types/three` が要る）。Cookbook 0001 の画像が出る。
    コンソールのエラーなし。3D の部分は取りに行かない
  - Next.js 16.4.0（`output: 'export'`）: サーバ側の部品で `/core` の `labelIn` を使い（HTML に出る）、`<Viewer>` を置いた。
    Chromium で画像が出る。エラーなし
  - `<Viewer>` は `className="h-full"` を渡さないと親の高さに広がらず、画像の欄の高さが 0 になる。README に書いた
- tgz: 458 ファイル、1.5 MB（展開後 5.1 MB）。テストや見本データは入っていない
- 確かめていないこと: npm 版の文字認識（推論の worker）を使う側のアプリで動かすこと。CDN（jsDelivr）の URL からタグを読むこと
- 2026-10-20 追記: npm にはログインできず（ロックアウト）、当面は GitHub Release（タグ `iiif-viewer-v<版>`）に tgz を添付して配る。README の入れ方もそれに合わせた

## 2026-10-20 v0.1.1: 外から Canvas と範囲を指定する（target・onSelect）

- 目的: awase（TEI の本文と画像を並べる）で、本文の pb@facs から画像の頁を選び、画像側の頁送りを本文に返す。
  v0.1.0 の `Viewer` は、最初の Canvas を `window.location` の `?canvas=`・`?iiif-content=` からしか選べず、頁が替わったことも知らせなかった
- `target`（canvasId・xywh・highlight）: マニフェストが読めてから、値が変わったときだけ、中の移動の頼み（`navRequestAtom`）に入れる。
  同じ値の新しいオブジェクトでは動かない（`targetKey` で比べる）。知らない canvasId は無視する
- `onSelect`（canvasId・index）: 表示中の Canvas が替わったときに呼ぶ。最初の頁、頁送り、`target` への移動のあと
- 落とし穴: マニフェストを読んだ直後、中は先に `start`（なければ 1 頁目）を開く。それをそのまま知らせると、
  知らせを `target` に書き戻す使い方（いちばんありそうな使い方）では、指定した頁に着かず `start` に戻ってしまう。
  そこで `target` の頁に着くまでは、途中の頁を知らせない
- 確かめたこと: tgz をリポジトリの外の Vite + React 19 に入れ、Cookbook 0009（5 頁の本）で、知らせを target に書き戻す作りにして Playwright で操作した。
  最初に p3 を指定 → p3 が出て、知らせは「2:p3」の 1 回だけ。矢印キーで p4 → 「3:p4」。外から p1・p4 → それぞれ 1 回ずつ。
  同じ値・知らない id では何も起きない。範囲の指定は、見開きの表示では拡大せず黄色い枠で示される（もとからの動き）。コンソールのエラーなし
- 版を上げると、配信中の `<iiif-viewer>` の `element/v0.1.0/` が次の配布で消えるところだった（`out/` を毎回作り直すため）。
  共有のページの埋め込みコードは版付きの URL を出すので、よそのページが壊れる。`copy-element.mjs` が、前の版を GitHub Release の tgz から取り出して残すようにした（`PREVIOUS` に版を足す）

## 2026-10-20 v0.1.2: 資料情報の欄を閉じて始める（panelOpen）

- 目的: awase の画像ペインでは、右の資料情報の欄が画像の半分近くを取る。閉じられるが、最初から閉じる指定が無かった
- `panelOpen`（true / false）: 始めの開閉を使う側が決める。ブラウザに保存した前回の開閉より優先する（保存は書き換えない。開け閉めすれば保存される）。
  省くとこれまでどおり（保存した値、無ければ広い画面で開く）。`<iiif-viewer>` タグでは `options='{"panelOpen":false}'`
- 確かめたこと: tgz をリポジトリの外の Vite + React 19 に入れ、Playwright で 5 通り。指定なし → 開く／false → 閉じ、押すと開く／
  false で保存が「開」→ 閉じる／指定なしで保存が「閉」→ 閉じる／true で保存が「閉」→ 開く。コンソールのエラーなし
- 確かめていないこと: タグの options 経由の動き（読み取りの処理は単純）
