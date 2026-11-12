'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { contentParam } from 'iiif-kasane/core';
import CommonLayout from '@/components/layout/Common';
import PageContainer from '@/components/layout/PageContainer';
import { SITE_URL } from '@/lib/site';
import viewerPkg from '../../../packages/iiif-viewer/package.json';

// 「構造・共有・埋め込み」の説明ページ。トップの機能カード（feature6）から入る。
// 例はどれも本番で開けることを確かめた資料（2026-10-14）。

type L = { ja: string; en: string };

/** <iiif-viewer> の配布先。npm run build の copy-element.mjs が out/element/v<版>/ に置く */
const ELEMENT_URL = `${SITE_URL}/element/v${viewerPkg.version}/iiif-viewer.js`;

const WELLCOME_BOOK = 'https://iiif.wellcomecollection.org/presentation/v3/b18035723';
const WELLCOME_MULTIPART = 'https://iiif.wellcomecollection.org/presentation/v3/b2178081x';
const COOKBOOK_TOC = 'https://iiif.io/api/cookbook/recipe/0024-book-4-toc/manifest.json';
const CODH_CURATION = 'https://codh.rois.ac.jp/software/iiif-curation-viewer/sample/curation.json';
const SAMPLE_3D = `${SITE_URL}/manifests/sample-manifest.json`;

// Content State: Wellcome の本の 5 ページ目（挿絵の部分）を指す注釈
const CONTENT_STATE = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  type: 'Annotation',
  motivation: ['contentState'],
  target: {
    type: 'SpecificResource',
    source: {
      id: 'https://iiif.wellcomecollection.org/presentation/b18035723/canvases/b18035723_0008.JP2',
      type: 'Canvas',
      partOf: [{ id: WELLCOME_BOOK, type: 'Manifest' }],
    },
    selector: { type: 'FragmentSelector', value: 'xywh=883,82,1064,849' },
  },
};

const toBase64Url = (s: string): string => {
  let bin = '';
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const viewerHref = (manifest: string, extra = '') => `/viewer?${contentParam(manifest)}${extra}`;

const STRUCTURES: { title: L; body: L; href: string; source: L }[] = [
  {
    title: { ja: '目次（Range）', en: 'Table of contents (Range)' },
    body: {
      ja: 'マニフェストの structures に書かれた目次を、「目次」タブに入れ子のまま表示します。項目を選ぶと、その頁が開きます。',
      en: 'The table of contents in the manifest’s structures appears, nested as written, in the Contents tab. Choosing an entry opens that page.',
    },
    href: viewerHref(COOKBOOK_TOC, '&tab=structure'),
    source: { ja: 'IIIF Cookbook 0024（目次のある本）', en: 'IIIF Cookbook 0024 (a book with a table of contents)' },
  },
  {
    title: { ja: '見開き（behavior: paged）', en: 'Two-page spreads (behavior: paged)' },
    body: {
      ja: 'behavior が paged の資料は、表紙を 1 枚で、その後を左右 2 頁の見開きで表示します。viewingDirection が right-to-left なら、右から左へめくります。',
      en: 'A manifest with behavior "paged" shows the cover alone and the rest as two-page spreads. With viewingDirection right-to-left, the pages turn from right to left.',
    },
    href: viewerHref(WELLCOME_BOOK, '&canvas=6'),
    source: { ja: 'Wellcome Collection『Wunder der Vererbung』', en: 'Wellcome Collection, “Wunder der Vererbung”' },
  },
  {
    title: { ja: 'Collection', en: 'Collection' },
    body: {
      ja: 'Collection を開くと、中のマニフェスト（ここでは 2 巻）がサムネイルで並びます。選ぶとその巻を開きます。',
      en: 'Opening a Collection lists the manifests in it (here, two volumes) as thumbnails. Choose one to open it.',
    },
    href: viewerHref(WELLCOME_MULTIPART),
    source: {
      ja: 'Wellcome Collection、Richard Owen の化石爬虫類の論考（全 2 巻）',
      en: 'Wellcome Collection, Richard Owen’s monograph on fossil reptiles (2 volumes)',
    },
  },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded bg-[var(--ds-surface)] border border-[var(--ds-border)] p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded border border-[var(--ds-border)] px-3 py-1 text-sm hover:bg-[var(--ds-surface)]"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? done : label}
    </button>
  );
}

export default function StructureShareEmbedContent() {
  const t = useTranslations('StructureShareEmbed');
  const locale = useLocale() === 'en' ? 'en' : 'ja';
  const pick = (l: L) => l[locale];

  const stateParam = toBase64Url(JSON.stringify(CONTENT_STATE));
  const shareRows: { param: string; body: L; href: string }[] = [
    {
      param: 'iiif-content=<manifest URL>',
      body: { ja: '開く資料（マニフェストか Collection の URL）。', en: 'The resource to open (the URL of a manifest or Collection).' },
      href: viewerHref(WELLCOME_BOOK),
    },
    {
      param: 'canvas=<n>',
      body: { ja: '何枚目から開くか（1 から数える）。Canvas の URI も書けます。', en: 'Which canvas to open first (counting from 1). A canvas URI also works.' },
      href: viewerHref(WELLCOME_BOOK, '&canvas=6'),
    },
    {
      param: 'tab=<id>',
      body: {
        ja: '右側で最初に開くタブ（metadata・structure・annotations・inference など）。',
        en: 'The tab to open on the right (metadata, structure, annotations, inference and others).',
      },
      href: viewerHref(COOKBOOK_TOC, '&tab=structure'),
    },
    {
      param: 'pos=<n>',
      body: {
        ja: 'キュレーション（IIIF Curation Viewer の形式）の何件目を開くか（1 から数える）。',
        en: 'Which item of a curation (IIIF Curation Viewer format) to open (counting from 1).',
      },
      href: viewerHref(CODH_CURATION, '&pos=3&tab=structure'),
    },
    {
      param: 'iiif-content=<content state>',
      body: {
        ja: 'IIIF Content State API の注釈（base64url）。頁と、その中の領域まで指せます。開くと領域に枠が出ます。',
        en: 'An IIIF Content State annotation (base64url). It can point at a page and a region on it, which is outlined when the viewer opens.',
      },
      href: `/viewer?iiif-content=${stateParam}`,
    },
  ];

  const embedCode = `<script type="module" src="${ELEMENT_URL}"></script>

<iiif-viewer
  iiif-content="${SAMPLE_3D}"
  locale="${locale}"
  theme="auto"
  style="display: block; height: 32rem"
></iiif-viewer>`;
  const srcDoc = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${embedCode}</body></html>`;

  const attrs: { name: string; body: L }[] = [
    {
      name: 'iiif-content',
      body: {
        ja: 'マニフェストの URL、または Content State。Content State を渡しても、今は資料を開くだけで、頁や領域の指定は効きません。',
        en: 'A manifest URL, or a content state. With a content state, the tag only opens the resource for now; the page and region in it are not applied.',
      },
    },
    { name: 'locale', body: { ja: '表示の言語（ja / en）。', en: 'Display language (ja / en).' } },
    { name: 'theme', body: { ja: '色（light / dark / auto）。', en: 'Colour scheme (light / dark / auto).' } },
    {
      name: 'options',
      body: {
        ja: `JSON。今は最初に開くタブだけ指定できます（例: '{"tab":"metadata"}'。metadata か annotations）。`,
        en: `JSON. For now, only the tab to open first (e.g. '{"tab":"metadata"}'; metadata or annotations).`,
      },
    },
  ];

  const h2 = 'text-xl font-bold text-[var(--ds-fg)]';
  const muted = 'text-sm text-[var(--ds-fg-muted)]';
  const link = 'text-[var(--ds-primary)] hover:underline';

  return (
    <CommonLayout>
      <PageContainer className="space-y-12">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{t('title')}</h1>
          <p className={muted}>{t('lead')}</p>
          <ul className="flex flex-wrap gap-4 text-sm">
            <li><a href="#structure" className={link}>{t('structureHeading')}</a></li>
            <li><a href="#share" className={link}>{t('shareHeading')}</a></li>
            <li><a href="#embed" className={link}>{t('embedHeading')}</a></li>
          </ul>
        </div>

        <section id="structure" className="scroll-mt-20 space-y-4">
          <h2 className={h2}>{t('structureHeading')}</h2>
          <p className={muted}>{t('structureLead')}</p>
          <div className="grid gap-6 md:grid-cols-3">
            {STRUCTURES.map((s) => (
              <div key={s.title.en} className="flex flex-col rounded-lg border border-[var(--ds-border)] p-4">
                <h3 className="font-semibold text-[var(--ds-fg)]">{pick(s.title)}</h3>
                <p className="mt-2 flex-1 text-sm text-[var(--ds-fg)]">{pick(s.body)}</p>
                <p className="mt-2 text-xs text-[var(--ds-fg-muted)]">{t('example')}: {pick(s.source)}</p>
                <Link href={s.href} className={`mt-3 text-sm ${link}`}>
                  {t('open')} →
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section id="share" className="scroll-mt-20 space-y-4">
          <h2 className={h2}>{t('shareHeading')}</h2>
          <p className={muted}>{t('shareLead')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ds-border)] text-left text-[var(--ds-fg-muted)]">
                  <th className="py-2 pr-4 font-normal">{t('param')}</th>
                  <th className="py-2 pr-4 font-normal">{t('meaning')}</th>
                  <th className="py-2 font-normal">{t('try')}</th>
                </tr>
              </thead>
              <tbody>
                {shareRows.map((r) => (
                  <tr key={r.param} className="border-b border-[var(--ds-border)] align-top">
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{r.param}</td>
                    <td className="py-2 pr-4 text-[var(--ds-fg)]">{pick(r.body)}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Link href={r.href} className={link}>{t('open')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={muted}>{t('shareCombine')}</p>
          <Code>{`${SITE_URL}/${locale}/viewer/?${contentParam(WELLCOME_BOOK)}&canvas=6&tab=metadata`}</Code>
          <p className={muted}>{t('contentStateLead')}</p>
          <Code>{JSON.stringify(CONTENT_STATE, null, 2)}</Code>
          <p className={muted}>
            <a href="https://iiif.io/api/content-state/1.0/" target="_blank" rel="noopener noreferrer" className={link}>
              IIIF Content State API 1.0
            </a>
          </p>
        </section>

        <section id="embed" className="scroll-mt-20 space-y-4">
          <h2 className={h2}>{t('embedHeading')}</h2>
          <p className={muted}>{t('embedLead')}</p>
          <iframe
            title={t('embedFrameTitle')}
            srcDoc={srcDoc}
            className="block h-[calc(32rem+2px)] w-full rounded border border-[var(--ds-border)] bg-white"
          />
          <p className={muted}>{t('embedFrameNote')}</p>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-[var(--ds-fg)]">{t('embedCode')}</h3>
            <CopyButton text={embedCode} label={t('copy')} done={t('copied')} />
          </div>
          <Code>{embedCode}</Code>
          <h3 className="font-semibold text-[var(--ds-fg)]">{t('attributes')}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {attrs.map((a) => (
              <div key={a.name} className="contents">
                <dt className="font-mono text-xs pt-0.5">{a.name}</dt>
                <dd className="text-[var(--ds-fg)]">{pick(a.body)}</dd>
              </div>
            ))}
          </dl>
          <ul className={`list-disc space-y-1 pl-5 ${muted}`}>
            <li>{t('embedNoteHeight')}</li>
            <li>{t('embedNoteColor')}</li>
            <li>{t('embedNoteCors')}</li>
            <li>{t('embedNoteVersion', { version: viewerPkg.version })}</li>
          </ul>
        </section>
      </PageContainer>
    </CommonLayout>
  );
}
