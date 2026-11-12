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

## 2026-10-20 v0.1.3: 見開きのマニフェストで、範囲（xywh）へ寄せて枠を合わせる

- 症状（awase の異文の箇所の画像で見つけた）: 国文研 200003803（`viewingHint: paged`）を Canvas 3・範囲 2371,2100,117,532 で開くと、
  見開きの 2 枚のまま出て範囲へ寄らず、枠は範囲より下に、縦に伸びて描かれた
- 原因は 2 つ。(1) 見開きの表示はただの `<img>` を並べるだけで、拡大できない。(2) その `<img>` は object-contain で、
  要素（490×817）の中に絵（490×327）が上下の余白つきで描かれる。枠と画像の上の層は、要素の矩形を基準に置いていた
- 直し方: (1) 範囲を指して開いたとき（focus に xywh があり、その Canvas が選ばれているとき）は、見開きでもそのページ 1 枚を
  拡大できる表示で出す。ページを送ると focus が消えるので見開きに戻る。(2) 見開きの層と枠は、要素の中で絵が描かれた矩形
  （`pageBox.ts` の `containedBox`）に合わせる
- 確かめたこと: e2e 2 件（`e2e/pagedRegion.spec.ts`。直す前の版で 2 件とも落ちることも確かめた）、vitest 832 件、
  実データ（国文研）で範囲へ寄って枠が範囲の縦横比（117:532）になること
- 確かめていないこと: 実データの画像が表示された状態での目視。作業中に kokusho.nijl.ac.jp が接続を拒否していた
  （kotenseki.nijl.ac.jp の画像は kokusho へ 301 で転送される）

## 2026-10-20 v0.1.4: 頁送りを隠す（pager）

- 目的: awase の画像ペインに頁送りが 2 組あった（awase の「前の頁・次の頁」と、ビューアの「‹ 22/218 ›」）。
  awase の組は本文の頁の順に、別のマニフェストや画像にもまたがって移れる。ビューアの組は 1 つのマニフェストの中だけ。そこで awase の組だけを残す
- `pager`（false）: 画像の上の頁送り（前へ・次へ・何枚目か）を出さない。ContainerList は隠さずに置いたまま
  （目次の移動の依頼、Content State の開く頁、target をそこで受けているため）。矢印キー・PageDown でめくれて、onSelect も知らせる。
  `<iiif-viewer>` タグでは `options='{"pager":false}'`
- 確かめたこと: vitest 693 件。tgz を awase に入れ、頁送りが 1 組になること、PageDown でめくると本文が付いてくることを e2e で
- 確かめていないこと: タグの options 経由の動き

## 2026-11-12 v0.2.0: 名前を iiif-kasane に改め、npm に出す

- 名前: `@nakamura196/iiif-viewer` → `iiif-kasane`（頭に何も付けない）。表示名「IIIF Kasane」・リポジトリ名と揃えるため
- 却下した案:
  - `kasane` … npm で別のパッケージ（2022 年から更新なし）が使っている
  - `@nakamura196/kasane`・`@nakamura196/iiif-kasane` … 個人のアカウントに結び付き、研究室・団体に移すと名前ごと変わる。頭なしなら管理者を足すだけで済む（Mirador は `mirador`、Universal Viewer は `universalviewer`）
  - リポジトリ名を `kasane` に変える … `nakamura196.github.io/iiif-kasane/` の転送が止まる（前回 iiif-3d-viewer から変えたときに起きた）。表示名とも合っているので据え置き
- 版は 0.2.0。import の名前が変わるので、0.x の中の数字を上げた。0.1.6 のままにすると、同じ番号で中身（名前）の違うものが 2 つになる
- 置き場所 `packages/iiif-viewer/` とタグ `<iiif-viewer>`・`/element/v<版>/` は変えない（よそのページの埋め込みを壊さないため）
- 発行は npm の Trusted Publishing（GitHub Actions の OIDC。トークンを持たない、provenance が自動で付く）。`.github/workflows/publish-npm.yml` が、タグ `iiif-kasane-v<版>` の Release で動く
- 自明でなかった事実（docs.npmjs.com/trusted-publishers、2026-10-06 版）: trusted publisher は、npm にある既存のパッケージにしか設定できない。最初の 1 回は手元から `npm publish` する。設定してから 2 日以内に、workflow から 1 回出す必要がある。npm 11.5.1 以上・Node 22.14.0 以上。package.json の `repository.url` が GitHub のリポジトリと一致していること
- `copy-element.mjs` は、0.1.x を GitHub Release の tgz から、0.2.0 以降を npm の tgz から取る
- 確かめたこと: tsc、vitest 971 件、Astro の例のビルド、サイト全体のビルド（`out/element/` に v0.1.0〜v0.2.0）、`npm pack --dry-run`（名前 iiif-kasane、478 ファイル）
- 落とし穴: Astro の例で `npm ci` すると、`node_modules/iiif-kasane` が `../..`（パッケージ自身）を指す。そのまま `next build` すると、Turbopack がファイルを探してこの輪を回り、止まる。例のフォルダの `node_modules` を消せば通る

## 2026-11-12 v0.3.0: タグを <iiif-kasane> に、配布ファイルを iiif-kasane.js に

- 0.2.0 の節で「タグ `<iiif-viewer>` は変えない」としたのを改めた。理由: タグの名前は 1 つのページで 1 回しか登録できない。`iiif-viewer` はありふれた名前なので、別の IIIF のライブラリが同じ名前を使うと、同じページで片方が動かなくなる。パッケージ名・表示名とも揃う
- 古い名前は残す: `<iiif-viewer>` も登録する（同じクラスは 2 つの名前で登録できないので、中身の無いサブクラスで）。`dist/iiif-viewer.js` は `iiif-kasane.js` を読み込むだけの 1 行のファイルとして出す。Mahnke 氏のサイト（0.1.4、`<iiif-viewer>`）などの既存の埋め込みは、そのまま動く
- CSS は `iiif-kasane` と `iiif-viewer` の両方に効くようにした。`--iiif-viewer-*` の変数、`.iiif-viewer` の class、`data-iiif-viewer-style` は変えていない（変えると、色を指定しているよそのページが崩れる）
- `/element/v<版>/` のパスは変えない。`element` は決まった慣習ではないが、変えると既存の埋め込みが壊れる。案内の先頭は npm 経由の jsDelivr（`https://cdn.jsdelivr.net/npm/iiif-kasane@<版>/dist/iiif-kasane.js`）にした。0.2.0 の jsDelivr の URL で、ブラウザで表示できることを確かめた（後から読む部品も含めて）
- 確かめたこと: 組み立て（`dist/` に iiif-kasane.js・iiif-viewer.js・style.css）、Playwright で 4 通り（新しいタグ／古いファイルと古いタグ／両方を同じページに／jsDelivr の 0.2.0）とも表示され、エラー 0。tsc、vitest 971 件
