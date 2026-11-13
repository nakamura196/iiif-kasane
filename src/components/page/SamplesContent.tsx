'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import CommonLayout from '@/components/layout/Common';
import PageContainer from '@/components/layout/PageContainer';
import { SAMPLES, sampleHref, sampleThumbnail, type Sample } from '@/lib/samples';

// 3D（アノテーションつき）が Kasane の中心の機能なので先に出す
const MEDIA_ORDER: Sample['media'][] = ['3d', 'image', 'audio', 'video', 'mixed'];

// 一覧ページの置き場所。Cookbook のレシピ（CookbookSamplesContent）と Kasane 独自のマニフェスト（ここ）を別のページにする
export const SAMPLE_PAGES = {
  cookbook: '/samples',
  own: '/samples/kasane',
} as const;

// Kasane 独自のサンプル（/samples/kasane）
export default function SamplesContent() {
  const t = useTranslations('Samples');
  const locale = useLocale() === 'en' ? 'en' : 'ja';

  return (
    <CommonLayout>
      <PageContainer className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{t('own.title')}</h1>
          <p className="mt-2 text-sm text-[var(--ds-fg-muted)]">{t('own.lead')}</p>
          <p className="mt-2 text-sm">
            <Link href={SAMPLE_PAGES.cookbook} className="text-[var(--ds-primary)] hover:underline">
              {t('own.link')}
            </Link>
          </p>
        </div>
        {MEDIA_ORDER.map((media) => {
          const items = SAMPLES.filter((s) => s.media === media);
          if (items.length === 0) return null;
          return (
            <section key={media}>
              <h2 className="text-lg font-semibold text-[var(--ds-fg)] mb-3">{t(`media.${media}`)}</h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {items.map((s) => (
                  <li
                    key={s.id}
                    className="bg-[var(--ds-surface)] rounded-lg border border-[var(--ds-border)] p-4 flex flex-col sm:flex-row gap-4"
                  >
                    {/* 開いたときの画面。押すと詳細ページへ */}
                    <Link href={`/samples/kasane/${s.id}`} className="shrink-0 sm:w-48" tabIndex={-1} aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 静的書き出しのため next/image は使わない */}
                      <img
                        src={sampleThumbnail(s)}
                        alt=""
                        width={640}
                        height={400}
                        loading="lazy"
                        className="w-full aspect-[16/10] object-cover rounded border border-[var(--ds-border)] bg-[var(--ds-surface-2)]"
                      />
                    </Link>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Link href={`/samples/kasane/${s.id}`} className="font-medium text-[var(--ds-fg)] hover:text-[var(--ds-primary)] hover:underline">
                          {s.title[locale]}
                        </Link>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ds-fg-muted)]">{s.note[locale]}</p>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <Link href={sampleHref(s)} className="text-[var(--ds-primary)] hover:underline">
                          {t('open')}
                        </Link>
                        <Link href={`/samples/kasane/${s.id}`} className="text-[var(--ds-primary)] hover:underline">
                          {t('details')}
                        </Link>
                        <a
                          href={s.manifest}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--ds-primary)] hover:underline"
                        >
                          {t('manifest')}
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </PageContainer>
    </CommonLayout>
  );
}
