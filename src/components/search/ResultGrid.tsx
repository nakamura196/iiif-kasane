'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@nakamura196/react-ui';
import type { SearchItem } from '@nakamura196/iiif-viewer/core';
import { Link } from '@/i18n/routing';
import { viewerHref } from './links';

const PAGE = 60; // 一度に並べる件数
const META_SHOWN = 3; // カードに出すメタデータの数

function ResultCard({ item }: { item: SearchItem }) {
  const href = viewerHref(item.target);
  return (
    <li className="bg-[var(--ds-surface)] rounded-lg border border-[var(--ds-border)] overflow-hidden flex flex-col">
      <Link href={href} className="block aspect-square bg-[var(--ds-surface-2)] hover:opacity-90">
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- 外部の IIIF 画像サーバの画像
          <img src={item.thumbnail} alt="" loading="lazy" className="w-full h-full object-contain" />
        ) : null}
      </Link>
      <div className="p-2 text-xs space-y-1 min-w-0">
        <Link
          href={href}
          className="block font-medium text-sm text-[var(--ds-fg)] hover:underline truncate"
          title={item.label}
        >
          {item.label}
        </Link>
        {Object.entries(item.metadata)
          .slice(0, META_SHOWN)
          .map(([k, vs]) => (
            <p key={k} className="text-[var(--ds-fg-muted)] truncate" title={`${k}: ${vs.join(' / ')}`}>
              {k}: {vs.join(' / ')}
            </p>
          ))}
      </div>
    </li>
  );
}

/**
 * 結果のカードの並び。PAGE 件ずつ「さらに表示」で足す。
 * 絞り込みが変わったら、親が key を変えて作り直す（件数が最初に戻る）。
 * 読み込みの途中は、まだ読めていない分に該当があるかもしれないので「該当なし」と言わない。
 */
export default function ResultGrid({ items, loading = false }: { items: SearchItem[]; loading?: boolean }) {
  const t = useTranslations('Search');
  const [shown, setShown] = useState(PAGE);
  if (items.length === 0 && loading) return null;
  if (items.length === 0) return <p className="text-sm text-[var(--ds-fg-muted)]">{t('noHits')}</p>;
  return (
    <>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {items.slice(0, shown).map((item) => (
          <ResultCard key={item.key} item={item} />
        ))}
      </ul>
      {items.length > shown && (
        <div className="mt-4 text-center">
          <button onClick={() => setShown((n) => n + PAGE)} className={buttonClass('secondary', 'sm')}>
            {t('showMore', { count: Math.min(PAGE, items.length - shown) })}
          </button>
        </div>
      )}
    </>
  );
}
