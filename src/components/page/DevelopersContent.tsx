'use client';

import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { Link } from '@/i18n/routing';
import CommonLayout from '@/components/layout/Common';
import PageContainer from '@/components/layout/PageContainer';
import Example, { CodeBlock } from '@/components/developers/Example';
import { OwnLayoutDemo, TagDemo, ViewerDemo } from '@/components/developers/demos';
import { SITE_URL } from '@/lib/site';
import viewerPkg from '../../../packages/iiif-viewer/package.json';

// 開発者向けのページ。Kasane のビューア（@nakamura196/iiif-viewer）を自分のサイトに置く 3 つの方法を、
// 動くビューアとコードのタブで見せる。Clover IIIF の docs（https://samvera-labs.github.io/clover-iiif/docs）を参考にした。

type L = { ja: string; en: string };

const REPO = 'https://github.com/nakamura196/iiif-kasane';
const PKG_TREE = `${REPO}/tree/main/packages/iiif-viewer`;
const VERSION = viewerPkg.version;
/** <iiif-viewer> の配布先。npm run build の copy-element.mjs が out/element/v<版>/ に置く */
const ELEMENT_URL = `${SITE_URL}/element/v${VERSION}/iiif-viewer.js`;

const IMAGE_MANIFEST = 'https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json';
const ANNOTATED_MANIFEST = `${SITE_URL}/manifests/sample-manifest-with-annotations.json`;

const T = {
  title: { ja: '開発者向け', en: 'For developers' },
  lead: {
    ja: 'Kasane のビューアは、パッケージ @nakamura196/iiif-viewer として、ほかのサイトにも置けます（MIT ライセンス）。React の部品として使う方法、HTML のタグ <iiif-viewer> として使う方法、Astro で使う方法を、動く例とコードで示します。',
    en: 'The viewer of Kasane is available as the package @nakamura196/iiif-viewer, to put on your own site (MIT license). This page shows three ways to use it, each with a live viewer and its code: as React components, as the HTML tag <iiif-viewer>, and in Astro.',
  },
  tabsHint: {
    ja: '各例の上のタブで「プレビュー」（動くビューア）とコードを切り替えます。',
    en: 'In each example, the tabs switch between the preview (a live viewer) and the code.',
  },
  preview: { ja: 'プレビュー', en: 'Preview' },
  copy: { ja: 'コピー', en: 'Copy' },
  copied: { ja: 'コピーしました', en: 'Copied' },
  installHeading: { ja: 'インストール', en: 'Install' },
  installBody: {
    ja: 'npm のレジストリにはまだ載せていません。版ごとの tarball を GitHub Releases に置いています。3D 用の three.js などは、画像だけを見せる場合も入れてください（ブラウザが読むのは 3D を表示したときだけです）。タグだけを使う場合は、インストールは要りません。',
    en: 'The package is not on the npm registry yet; each version is attached to a GitHub Release. Install three.js and the other 3D packages even if you show only images: your bundler resolves them, but the browser fetches them only when a 3D Scene is shown. The tag needs no install.',
  },
  releases: { ja: 'GitHub Releases の一覧', en: 'All GitHub Releases' },
  reactHeading: { ja: 'React: Viewer', en: 'React: Viewer' },
  reactBody: {
    ja: 'いちばん簡単な使い方です。Viewer は親の要素いっぱいに広がるので、親に高さを付けて className="h-full" を渡します。iiifContent にはマニフェストの URL か IIIF Content State を渡します。',
    en: 'The simplest way. Viewer fills its parent: give the parent a height and pass className="h-full". iiifContent is a manifest URL or a IIIF Content State.',
  },
  reactProps: {
    ja: 'ほかに locale（ja / en）、theme（light / dark / auto）、表示する頁を外から指定する target、表示中の頁を知らせる onSelect などがあります。',
    en: 'Other props include locale (ja / en), theme (light / dark / auto), target to show a given Canvas from outside, and onSelect to hear which Canvas is shown.',
  },
  layoutHeading: { ja: 'React: 部品を自分のレイアウトに置く', en: 'React: the parts in your own layout' },
  layoutBody: {
    ja: 'ViewerProvider の中に、表示（CanvasView）・注釈の一覧（AnnotationList）・資料情報（Metadata）などの部品を好きな配置で置けます。部品どうしは同じ状態を共有します。一覧の注釈を選ぶと表示が動き、頁をめくると資料情報が追いかけます。useViewer() を使えば、自分の部品からも同じ状態を読めます（例の PageLabel）。',
    en: 'Inside ViewerProvider, place the parts (CanvasView for the display, AnnotationList, Metadata, …) in any layout. The parts share one state: choosing an annotation in the list moves the view, and the metadata follows the page turns. Your own components read the same state with useViewer() (PageLabel in the example).',
  },
  layoutCss: {
    ja: 'レイアウトはページ側の CSS で書きます。パッケージの style.css には部品が使うクラスしか無く、それもビューアの中だけに効きます。',
    en: 'Write the layout with your own CSS. The package’s style.css holds only the classes the parts use, and they apply only inside the viewer.',
  },
  tagHeading: { ja: 'タグ: <iiif-viewer>', en: 'The tag: <iiif-viewer>' },
  tagBody: {
    ja: 'フレームワークの無いページでも、スクリプトを 1 行読み込めばタグとして使えます。React はスクリプトの中に入っています。高さは CSS か --iiif-viewer-height で、色は --iiif-viewer-* の変数で変えられます。版ごとの URL は残し続けるので、版を固定して読み込めます。',
    en: 'A page without any framework can use the viewer as a tag by loading one script; React is inside it. Set the height with CSS or --iiif-viewer-height, and the colors with the --iiif-viewer-* variables. Each version stays at its own URL, so you can pin one.',
  },
  tagAttrs: {
    ja: '属性は iiif-content・locale・theme と、options（JSON。例: {"panelOpen":false,"pager":false}）です。属性を書き換えると、表示もそのとおりに変わります。',
    en: 'Its attributes are iiif-content, locale, theme and options (JSON, e.g. {"panelOpen":false,"pager":false}). Changing an attribute updates the viewer.',
  },
  tagEmbed: {
    ja: '資料ごとの埋め込みのコードは、ビューアの「共有」から作れます。',
    en: 'The share menu of the viewer writes the embed code for a given item.',
  },
  embedLink: { ja: '構造・共有・埋め込みの説明', en: 'About structure, sharing and embedding' },
  astroHeading: { ja: 'Astro', en: 'Astro' },
  astroBody: {
    ja: 'Astro では両方の方法が使えます。tag.astro はタグを素の HTML として送り、スクリプトがブラウザでビューアにします（プレビューはこの形）。parts.astro は上の「部品を自分のレイアウトに置く」の FreeLayout.tsx を React の island として置きます。ビューアはブラウザの機能（WebGL・画面の大きさ）を使うので、client:only="react" で描きます。',
    en: 'Both ways work in Astro. tag.astro sends the tag as plain HTML, and the script turns it into a viewer in the browser (the preview shows this). parts.astro puts FreeLayout.tsx from “the parts in your own layout” on the page as a React island; the viewer reads the browser (WebGL, the window size), so it is rendered with client:only="react".',
  },
  astroRun: {
    ja: '例の一式（動かし方は README）:',
    en: 'The whole example (how to run it is in its README):',
  },
  moreHeading: { ja: 'さらに詳しく', en: 'More' },
  moreReadme: { ja: 'パッケージの README（すべての props と、ページの CSS との関係）', en: 'The package README (all props, and how the styles meet the host page)' },
  moreVanilla: { ja: 'タグを素の JavaScript で操作する例（vanilla.html）', en: 'The tag driven by plain JavaScript (vanilla.html)' },
  moreSource: { ja: 'ソースコード', en: 'Source code' },
} satisfies Record<string, L>;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-xl font-semibold text-[var(--ds-fg)]">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm leading-relaxed text-[var(--ds-fg-muted)]">{children}</p>
);

const ExtLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
    {children}
  </a>
);

export type DeveloperFiles = { tagAstro: string; partsAstro: string; freeLayout: string; layoutCss: string };

export default function DevelopersContent({ files }: { files: DeveloperFiles }) {
  const locale: 'ja' | 'en' = useLocale() === 'en' ? 'en' : 'ja';
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const t = (k: keyof typeof T) => T[k][locale];
  const common = { previewLabel: t('preview'), copyLabel: t('copy'), copiedLabel: t('copied') };

  const install = [
    `npm install ${REPO}/releases/download/iiif-viewer-v${VERSION}/nakamura196-iiif-viewer-${VERSION}.tgz`,
    'npm install react react-dom jotai three three-stdlib @react-three/fiber @react-three/drei gsap',
  ].join('\n');

  const reactCode = `import { Viewer } from '@nakamura196/iiif-viewer';
import '@nakamura196/iiif-viewer/style.css';

export default function Page() {
  return (
    <div style={{ height: '32rem' }}>
      <Viewer
        iiifContent="${IMAGE_MANIFEST}"
        locale="${locale}"
        className="h-full"
      />
    </div>
  );
}`;

  const tagHtml = `<script type="module" src="${ELEMENT_URL}"></script>

<iiif-viewer
  iiif-content="${IMAGE_MANIFEST}"
  locale="${locale}"
  style="height: 32rem"
></iiif-viewer>`;

  return (
    <CommonLayout>
      <PageContainer className="space-y-12">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{t('title')}</h1>
          <P>{t('lead')}</P>
          <P>{t('tabsHint')}</P>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
            {(
              [
                ['install', t('installHeading')],
                ['react', t('reactHeading')],
                ['layout', t('layoutHeading')],
                ['tag', t('tagHeading')],
                ['astro', t('astroHeading')],
              ] as const
            ).map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-[var(--ds-fg)] underline">
                {label}
              </a>
            ))}
          </nav>
        </div>

        <Section id="install" title={t('installHeading')}>
          <P>{t('installBody')}</P>
          <div className="overflow-hidden rounded border border-[var(--ds-border)]">
            <CodeBlock code={install} copyLabel={t('copy')} copiedLabel={t('copied')} />
          </div>
          <P>
            <ExtLink href={`${REPO}/releases`}>{t('releases')}</ExtLink>
          </P>
        </Section>

        <Section id="react" title={t('reactHeading')}>
          <P>{t('reactBody')}</P>
          <Example
            {...common}
            preview={<ViewerDemo manifest={IMAGE_MANIFEST} locale={locale} theme={theme} />}
            tabs={[{ label: 'Page.tsx', code: reactCode }]}
          />
          <P>{t('reactProps')}</P>
        </Section>

        <Section id="layout" title={t('layoutHeading')}>
          <P>{t('layoutBody')}</P>
          <Example
            {...common}
            minHeight="38rem"
            preview={<OwnLayoutDemo manifest={ANNOTATED_MANIFEST} locale={locale} css={files.layoutCss} />}
            tabs={[
              { label: 'FreeLayout.tsx', code: files.freeLayout },
              { label: 'layout.css', code: files.layoutCss },
            ]}
          />
          <P>{t('layoutCss')}</P>
        </Section>

        <Section id="tag" title={t('tagHeading')}>
          <P>{t('tagBody')}</P>
          <Example
            {...common}
            preview={<TagDemo html={tagHtml} title={t('tagHeading')} />}
            tabs={[{ label: 'index.html', code: tagHtml }]}
          />
          <P>{t('tagAttrs')}</P>
          <P>
            {t('tagEmbed')} <Link href="/structure-share-embed" className="underline">{t('embedLink')}</Link>
          </P>
        </Section>

        <Section id="astro" title={t('astroHeading')}>
          <P>{t('astroBody')}</P>
          <Example
            {...common}
            preview={<TagDemo html={tagHtml} title={t('astroHeading')} />}
            tabs={[
              { label: 'src/pages/tag.astro', code: files.tagAstro },
              { label: 'src/pages/parts.astro', code: files.partsAstro },
              { label: 'src/components/FreeLayout.tsx', code: files.freeLayout },
            ]}
          />
          <P>
            {t('astroRun')} <ExtLink href={`${PKG_TREE}/examples/astro`}>packages/iiif-viewer/examples/astro</ExtLink>
          </P>
        </Section>

        <Section id="more" title={t('moreHeading')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ds-fg-muted)]">
            <li>
              <ExtLink href={`${PKG_TREE}#readme`}>{t('moreReadme')}</ExtLink>
            </li>
            <li>
              <ExtLink href={`${PKG_TREE}/examples/vanilla.html`}>{t('moreVanilla')}</ExtLink>
            </li>
            <li>
              <ExtLink href={REPO}>{t('moreSource')}</ExtLink>
            </li>
          </ul>
        </Section>
      </PageContainer>
    </CommonLayout>
  );
}
