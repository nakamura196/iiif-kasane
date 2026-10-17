'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { buttonClass } from '@nakamura196/react-ui';
import { Link } from '@/i18n/routing';
import CommonLayout from '@/components/layout/Common';
import PageContainer from '@/components/layout/PageContainer';
import CopyLinkButton from '@/components/page/CopyLinkButton';
import { cookbookVideoClip } from '@/lib/cookbookVideo';
import { COOKBOOK_RECIPES, recipeById, recipeHref, recipePage } from '@/lib/cookbookRecipes';

const linkClass = 'text-[var(--ds-primary)] hover:underline';

// /samples/<id>: Cookbook のレシピ 1 件。番号・題名・分類・確認状況・開くリンク・前後のレシピ
export default function RecipeDetailContent({ id }: { id: string }) {
  const t = useTranslations('Samples');
  const locale = useLocale() === 'en' ? 'en' : 'ja';
  // 押されるまで YouTube は読み込まない（開いただけでは YouTube に閲覧の情報が渡らない）
  const [playing, setPlaying] = useState(false);
  const r = recipeById(id);
  if (!r) return null;

  const clip = cookbookVideoClip(r.id, locale);
  // 同じ分類の中での前後（番号順）
  const same = COOKBOOK_RECIPES.filter((x) => x.category === r.category);
  const i = same.findIndex((x) => x.id === r.id);
  const prev = same[i - 1];
  const next = same[i + 1];
  const neighbor = (x: typeof r, label: string) => (
    <Link href={`/samples/${x.id}`} className={linkClass}>
      {label}: {x.id} {x.title[locale]}
    </Link>
  );

  return (
    <CommonLayout>
      <PageContainer width="text" className="space-y-8">
        <p className="text-sm">
          <Link href="/samples" className={linkClass}>
            ← {t('back')}
          </Link>
        </p>
        <header className="space-y-2">
          <p className="font-mono text-sm text-[var(--ds-fg-muted)]">{r.id}</p>
          <h1 className="text-2xl font-bold text-[var(--ds-fg)]">{r.title[locale]}</h1>
          {locale === 'ja' && <p className="text-sm text-[var(--ds-fg-muted)]">{r.title.en}</p>}
          <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--ds-fg-muted)]">
            <span>{t(`category.${r.category}`)}</span>
            <span className="px-2 py-0.5 rounded bg-[var(--ds-surface-2)]">{t(`status.${r.status}`)}</span>
          </p>
        </header>

        {clip && !playing && (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-[var(--ds-border)] bg-black text-white shadow-md hover:bg-neutral-900"
          >
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-3xl"
            >
              ▶
            </span>
            <span className="text-sm">
              {t('playClip', { time: `${Math.floor(clip.start / 60)}:${String(clip.start % 60).padStart(2, '0')}` })}
            </span>
          </button>
        )}
        {clip && playing && (
          // 紹介動画（全レシピを通した 1 本）のうち、このレシピの場面だけを再生する
          <div className="w-full overflow-hidden rounded-xl border border-[var(--ds-border)] bg-black shadow-md">
            <iframe
              className="aspect-video w-full"
              src={`https://www.youtube.com/embed/${clip.videoId}?autoplay=1&start=${clip.start}${clip.end ? `&end=${clip.end}` : ''}`}
              title={`${r.id} ${r.title[locale]}`}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        )}

        {r.note && <p className="leading-relaxed text-[var(--ds-fg)]">{r.note[locale]}</p>}

        {r.links.length === 0 ? (
          <p className="text-sm text-[var(--ds-fg-muted)]">{t('noManifest')}</p>
        ) : (
          <ul className="space-y-3">
            {r.links.map((link, k) => (
              <li key={k} className="flex flex-wrap items-center gap-3">
                <Link href={recipeHref(r, link)} className={buttonClass('primary', 'md')}>
                  {link.label ? t('openWith', { label: link.label }) : t('open')}
                </Link>
                {link.url && (
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} text-sm`}>
                    {t('manifest')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href={recipePage(r.id)} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t('recipe')}
          </a>
        </div>

        <CopyLinkButton label={t('copyLink')} done={t('copied')} />

        <nav aria-label={t('sameCategory')} className="space-y-1 border-t border-[var(--ds-border)] pt-4 text-sm">
          <p className="text-[var(--ds-fg-muted)]">{t(`category.${r.category}`)}</p>
          {prev && <p>{neighbor(prev, `← ${t('prev')}`)}</p>}
          {next && <p>{neighbor(next, `${t('next')} →`)}</p>}
        </nav>
      </PageContainer>
    </CommonLayout>
  );
}
