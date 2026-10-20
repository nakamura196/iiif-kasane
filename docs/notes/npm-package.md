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
