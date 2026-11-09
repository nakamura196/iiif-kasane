# 共有デザインシステム（@nakamura196/react-ui）への移行ガイド

このドキュメントは、`iiif-3d-viewer` で実施した「共有デザインシステム（DS）への統一」作業を、**同様の対応を進める他アプリが参照・再現できる**ようにまとめたものです。Next.js（App Router）+ Tailwind v4 + next-intl 構成を前提とします。

DS リポジトリ: `github:nakamura196/react-ui`（ソース: `/Users/nakamura/git/nakamura196/react-ui`）

---

## 0. 基本方針

1. **UI は DS から消費する。** Footer / Header / News / VideoEmbed / SectionHeading / Prose(MarkdownContent) / Button / ThemeToggle / LanguageSwitcher などは各アプリで作らず DS のものを使う。
2. **DS に不足があれば、アプリ側で再実装せず DS を成長させる。** 必要なコンポーネント／機能は DS 本体（`react-ui`）に追加し、バージョンを上げて全アプリで共有する。アプリ内のローカル実装（例: 自作 Markdown レンダラ）は DS に同等物ができたら撤去する。
3. **デザイントークンは CSS 変数（`--ds-*`）で参照する。** 色・書体は `var(--ds-primary)` 等を使い、生のカラー値をハードコードしない。

---

## 1. DS の導入と更新

### 依存の張り方（GitHub タグ固定）

```jsonc
// package.json
"dependencies": {
  "@nakamura196/react-ui": "github:nakamura196/react-ui#v0.2.0"
}
```

- DS は **ビルド済み成果物ではなくソース（`src/*.tsx`）をそのまま配布**している（`package.json` の `"exports": { ".": "./src/index.ts" }`、`"files": ["src"]`）。Next 側がトランスパイルするのでそのまま import できる。
- DS の依存（`react-markdown` 等）は github インストール時に transitive で入る。

### バージョンを上げるときの注意（npm のキャッシュ）

`package.json` の `#vX.Y.Z` を書き換えて `npm install` しても、**github 依存はキャッシュされて再解決されないことがある**（`up to date` と出て更新されない）。タグを明示して強制再解決する:

```
npm install "@nakamura196/react-ui@github:nakamura196/react-ui#v0.2.0"
```

更新後は必ず確認:

```
grep '"version"' node_modules/@nakamura196/react-ui/package.json
```

### バージョン履歴（参考）

- **v0.1.0**: Footer / Header / ThemeToggle / LanguageSwitcher / News / SectionHeading / VideoEmbed / Button
- **v0.2.0**: 上記 + `Prose` / `MarkdownContent` / `proseClass`（react-markdown ベース。privacy/help/terms 等のドキュメントページ用）

---

## 2. Tailwind v4（configレス）のセットアップ

`src/app/globals.css` 冒頭:

```css
@import 'tailwindcss';
@import '@nakamura196/react-ui/styles.css';      /* DS のトークン (--ds-*) */

/* DS の Prose / MarkdownContent が使う prose-* を生成（v4 は @plugin で登録） */
@plugin "@tailwindcss/typography";

/* DS のソースを scan して、DS 内で使われる utility (md:grid-cols-4 等) を生成 */
@source '../../node_modules/@nakamura196/react-ui/src';

@custom-variant dark (&:where(.dark, .dark *));

/* 書体トークンを端末の書体で上書き（Web フォントは読み込まない） */
:root {
  --ds-font-sans: system-ui, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', Meiryo, 'Noto Sans CJK JP', sans-serif;
  --ds-font-serif: 'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif CJK JP', ui-serif, Georgia, serif;
}
```

ポイント:
- **`@source` を忘れると DS 内の utility クラスが purge され、レイアウトが崩れる**（DS はアプリの content スキャン対象外のため）。
- `MarkdownContent`（prose）を使うなら **`@tailwindcss/typography` を devDep に追加**して `@plugin` 登録が必須:
  ```
  npm install -D @tailwindcss/typography
  ```

---

## 3. next-intl との連携（ロケール対応リンク）

DS のリンクを持つコンポーネント（Footer / News 等）は `LinkComponent` prop に next-intl の `Link` を渡すと、内部リンクにロケール接頭辞が付く。外部リンクは `external: true` で `target="_blank"` の素の `<a>` になる。

```tsx
import { Link } from '@/i18n/routing';
import { Footer } from '@nakamura196/react-ui';

<Footer LinkComponent={Link} columns={[...]} />
```

---

## 4. コンポーネント別の使い方

### Footer（4列）

構造は **左ブロック（`title` + `description`）＋ `columns`（最大3列）= 計4列**。

```tsx
<Footer
  title={t('title')}
  description={t('description')}              // ← サイト説明（開発者名ではない）
  LinkComponent={Link}
  copyright={`© ${new Date().getFullYear()} ${t('developers')}`}  // 開発者名はここ
  columns={[
    { heading: t('guideHeading'), links: [/* help/privacy/terms */] },
    { heading: t('samplesHeading'), links: [/* アプリ固有のサンプル */] },
    { heading: t('relatedHeading'), links: [/* external: true の関連サイト */] },
  ]}
/>
```

- `description` は**サイトの説明文**。開発者クレジットを description に入れるのは誤用（`copyright` 行へ）。
- 内部リンクは `{ label, href }`、外部リンクは `{ label, href, external: true }`、リンクでない項目は `{ label }` のみ。

### News（お知らせ）

```tsx
<News
  heading={tNews('heading')}
  items={[{ date: '2026-05-25', title: '...', href: 'https://...', external: true }]}
  emptyText={tNews('empty')}
  LinkComponent={Link}
/>
```

- News は内部に `container mx-auto px-4 py-12` を持つ。`max-w-*` の中に置くと二重余白になるので、必要なら `className="!px-0 !py-0"` 等で打ち消す。
- 見出しは `SectionHeading`（左揃え + 左アクセントバー）。

### VideoEmbed（YouTube 埋め込み）

```tsx
const demoVideoId = locale === 'en' ? 'EN_ID' : 'JA_ID';
<VideoEmbed videoId={demoVideoId} title={t('title')} />
```

- `youtube.com` の埋め込み（`youtube-nocookie.com` は 2026-10 時点で再生できなかった）・16:9・lazy。ロケールで動画を出し分ける場合は `videoId` を切り替える。

### SectionHeading

- **既定は左揃え + 左アクセントバー**。`justify-center` で中央寄せにすると、左バーの意味が崩れ、左揃えの News 見出しと不揃いになる。**セクション見出しは左揃えで統一**するのが原則（ヒーローの h1 は中央でよい）。

### Prose / MarkdownContent（ドキュメントページ）

privacy / help / terms / about のような Markdown ページ用。

```tsx
import { MarkdownContent } from '@nakamura196/react-ui';
<MarkdownContent content={content} />   // content は Markdown 文字列
```

- react-markdown ベースなので **リンク `[text](url)` / 太字 `**...**` / 見出し / リスト**を正しく描画。外部リンクは自動で新規タブ。
- **アプリ内に自作の簡易 Markdown レンダラがある場合は撤去する**（自作実装はインライン記法＝リンク等を取りこぼしやすい）。
- 利用には `@tailwindcss/typography` の `@plugin` 登録が必要（§2）。

#### ドキュメントページの定型

```
src/content/{locale}/{page}.md          ← 本文（locale ごと）
src/lib/markdown.ts: getMarkdownContent(locale, page)  ← fs で読み込み（ja フォールバック）
src/app/[locale]/{page}/page.tsx        ← server component で content を読み MarkdownContent に渡す
```

---

## 5. ありがちな落とし穴

- **github 依存が更新されない** → タグ明示で `npm install`（§1）。
- **DS の utility が効かない／レイアウト崩れ** → `globals.css` の `@source` 漏れ（§2）。
- **prose が素のテキストで出る** → `@tailwindcss/typography` 未導入 or `@plugin` 未登録（§2）。
- **description に開発者名** → サイト説明に直し、開発者は `copyright` へ（§4 Footer）。
- **見出しの中央寄せ** → 左揃えに統一（§4 SectionHeading）。
- **News の二重余白** → `!px-0 !py-0` 等で打ち消し（§4 News）。

---

## 6. 検証

```
rm -rf .next/types     # 削除したルートの stale な生成型を消す
npm run build          # 型チェック + 静的生成まで通ることを確認
npm audit              # high 以上は対処（CLAUDE.md 方針）
```

ページ削除（例: references ページ）をしたときは、`.next/types` の古い validator が消えたルートを参照してエラーになることがある。`rm -rf .next/types` して再ビルドすれば解消する。

---

## 7. このアプリ（iiif-3d-viewer）で実施した具体例

参考までに、本アプリで行った変更の要約:

| 項目 | 内容 |
|---|---|
| Footer | 2列 → DS の4列（ヘルプ・規約 / サンプル / 関連サイト）。description をサイト説明に修正、開発者名は copyright へ |
| 参考リンクページ | 削除し、外部リンクを Footer 4列目「関連サイト」に集約 |
| トップページ | 「主な機能」「使い方」を両方カード並べに統一、セクション見出しを左揃えに統一 |
| お知らせ | DS `News` を追加（記事公開を1件） |
| デモ動画 | DS `VideoEmbed` で日本語/英語を出し分け |
| privacy/help/terms | 自作 `MarkdownRenderer` を撤去し DS `MarkdownContent` に置換（DS を v0.1.0 → v0.2.0 に更新、typography プラグイン導入） |
| プライバシーポリシー | プレースホルダから、GA4・YouTube・Vercel・外部マニフェスト取得などの実態に即した内容へ全面改稿 |

> 注: Footer の列構成・サンプル・関連サイトの中身、プライバシーポリシーの本文はアプリ固有。仕組み（DS の使い方）が他アプリへの再利用ポイント。
