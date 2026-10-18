'use client';

import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ManifestInput from '@/components/Input';
import PageContainer from '@/components/layout/PageContainer';
import { SectionHeading, News, VideoEmbed } from '@nakamura196/react-ui';
import { contentParam } from '@nakamura196/iiif-viewer/core';
import { NEWS, NEWS_ON_HOME } from '@/lib/news';

export default function HomeContent() {
  const router = useRouter();
  const t = useTranslations('Home');
  const tNews = useTranslations('News');
  const locale = useLocale();

  // お知らせは content/news/<id>.md（src/lib/news.ts が読む）。トップには新しいものから NEWS_ON_HOME 件
  const lang = locale === 'en' ? 'en' : 'ja';
  const newsItems = NEWS.slice(0, NEWS_ON_HOME).map((n) => ({
    date: n.date,
    title: n.title[lang],
    href: `/news/${n.id}`,
  }));

  const steps = ['step1', 'step2', 'step3', 'step4'] as const;

  // 対応している規格。note は、どう対応しているかの補足
  const specs = [
    { key: 'specP4', href: 'https://iiif.io/api/presentation/4.0/' },
    { key: 'specP3', href: 'https://iiif.io/api/presentation/3.0/' },
    { key: 'specP2', href: 'https://iiif.io/api/presentation/2.1/' },
    { key: 'specImage', href: 'https://iiif.io/api/image/3.0/' },
    { key: 'specPhysdim', href: 'https://iiif.io/api/annex/services/#physical-dimensions' },
    { key: 'specContentState', href: 'https://iiif.io/api/content-state/1.0/' },
    { key: 'specAuth', href: 'https://iiif.io/api/auth/2.0/' },
    { key: 'specGeoref', href: 'https://iiif.io/api/extension/georef/' },
    { key: 'specNavPlace', href: 'https://iiif.io/api/extension/navplace/' },
    { key: 'specCuration', href: 'https://codh.rois.ac.jp/iiif/curation/' },
    // 研究段階のため公開ページには出さない（掲載の了承が得られたら戻す）
    // { key: 'specRegionTag', href: 'https://github.com/nakamura196/iiif-region-tag-extension' },
  ] as const;

  // ロケール別のデモ動画（YouTube videoId）。日本語版 / 英語版を出し分ける。
  const demoVideoId = locale === 'en' ? 'Wbhqz5s6ahA' : '_thPJDU_hLA';

  const handleManifestSubmit = async (manifestUrl: string, tab?: string) => {
    const url = `/${locale}/viewer?${contentParam(manifestUrl)}`;
    router.push(tab ? `${url}&tab=${tab}` : url);
  };

  // アイコンは Heroicons (outline) のパス
  const featureCards = [
    {
      // 3D モデル (cube)
      titleKey: 'feature1Title',
      descKey: 'feature1Description',
      path: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    },
    {
      // 画像 (photo)
      titleKey: 'feature2Title',
      descKey: 'feature2Description',
      path: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    },
    {
      // 音声・動画 (film)
      titleKey: 'feature3Title',
      descKey: 'feature3Description',
      path: 'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z',
    },
    {
      // アノテーション (chat)
      titleKey: 'feature4Title',
      descKey: 'feature4Description',
      path: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    },
    {
      // 比較と地図 (map)
      titleKey: 'feature5Title',
      descKey: 'feature5Description',
      path: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
    },
    {
      // 構造・共有・埋め込み (code)
      titleKey: 'feature6Title',
      descKey: 'feature6Description',
      // 説明ページ（実例・URL の書き方・埋め込みのコード）へ
      href: '/structure-share-embed',
      path: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    },
  ] as const;

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1">
        <PageContainer>
          <section className="text-center mb-10 pt-10 md:pt-14">
            <h1
              className="text-4xl md:text-5xl font-bold text-[var(--ds-fg)] mb-4"
              style={{ fontFamily: 'var(--ds-font-serif)' }}
            >
              {t('title')}
            </h1>
            <p className="text-lg md:text-xl text-[var(--ds-fg-muted)]">{t('subtitle')}</p>
          </section>

          <section className="mb-16">
            <ManifestInput onSubmit={handleManifestSubmit} compact>
              <VideoEmbed videoId={demoVideoId} title={t('title')} />
            </ManifestInput>
          </section>

          <News
            heading={tNews('heading')}
            items={newsItems}
            emptyText={tNews('empty')}
            LinkComponent={Link}
            className="!px-0 !py-0"
          />
          <p className="mt-3 mb-16 text-right text-sm">
            <Link href="/news" className="text-[var(--ds-primary)] hover:underline">
              {tNews('viewAll')} →
            </Link>
          </p>

          <section className="mb-16">
            <SectionHeading>{t('features')}</SectionHeading>
            <div className="grid md:grid-cols-3 gap-8">
              {featureCards.map((card) => (
                <div
                  key={card.titleKey}
                  className="bg-[var(--ds-surface)] border border-[var(--ds-border)] p-6 rounded-lg shadow-md"
                >
                  <div className="text-[var(--ds-primary)] mb-4">
                    <svg
                      className="w-12 h-12"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={card.path}
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-[var(--ds-fg)]">
                    {t(card.titleKey)}
                  </h3>
                  <p className="text-[var(--ds-fg-muted)]">
                    {t(card.descKey)}
                  </p>
                  {'href' in card ? (
                    <Link href={card.href} className="mt-3 inline-block text-sm text-[var(--ds-primary)] hover:underline">
                      {t('featureMore')} →
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="mb-16">
            <SectionHeading>{t('specs')}</SectionHeading>
            <ul className="grid md:grid-cols-2 gap-3">
              {specs.map((spec) => (
                <li
                  key={spec.key}
                  className="bg-[var(--ds-surface)] border border-[var(--ds-border)] p-4 rounded-lg"
                >
                  <a
                    href={spec.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--ds-primary)] hover:underline"
                  >
                    {t(`${spec.key}Title`)}
                  </a>
                  <p className="mt-1 text-sm text-[var(--ds-fg-muted)]">{t(`${spec.key}Note`)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-16">
            <SectionHeading>{t('howToUse')}</SectionHeading>
            <div className="grid md:grid-cols-2 gap-8">
              {steps.map((step) => (
                <div
                  key={step}
                  className="bg-[var(--ds-surface)] border border-[var(--ds-border)] p-6 rounded-lg shadow-md text-[var(--ds-fg-muted)]"
                >
                  {t(step)}
                </div>
              ))}
            </div>
          </section>
        </PageContainer>
      </main>
      <Footer />
    </div>
  );
}
