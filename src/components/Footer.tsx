'use client';

import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Footer as DsFooter } from '@nakamura196/react-ui';

// 共有デザインシステム (@nakamura196/react-ui) の4列フッター。
// 左ブロック (title + description) ＋ columns (最大3列) = 計4列。
// next-intl の Link を LinkComponent に渡してロケール付きリンクを描画する。
// 個々の資料へのリンクは置かず、例の一覧（/usecases）・Cookbook の対応表（/samples）への入口だけを置く。
// Shared Region and Keyed Tag Extension の例（public/manifests/sample-manifest-region-tags.json）は
// 研究段階のため公開ページには出さない（掲載の了承が得られたら /usecases に足す）

export default function Footer() {
  const t = useTranslations('Footer');

  return (
    <DsFooter
      title={t('title')}
      description={t('description')}
      LinkComponent={Link}
      copyright={`© ${new Date().getFullYear()} ${t('developers')}`}
      columns={[
        // 2列目: 説明系（ヘルプ・規約）
        {
          heading: t('guideHeading'),
          links: [
            { label: t('help'), href: '/help' },
            { label: t('inferenceModels'), href: '/inference-models' },
            { label: t('privacy'), href: '/privacy' },
            { label: t('terms'), href: '/terms' },
          ],
        },
        // 3列目: サンプル（ユースケース・Cookbook のサンプル一覧）。検索は道具なので、トップページの入力欄の下から入る
        {
          heading: t('samplesHeading'),
          links: [
            { label: t('useCasesAll'), href: '/usecases' },
            { label: t('gallery'), href: '/gallery' },
            { label: t('browse'), href: '/browse' },
            { label: t('samplesAll'), href: '/samples' },
            { label: t('samplesOwn'), href: '/samples/kasane' },
          ],
        },
        // 4列目: 関連サイト（IIIF の入口・Kasane が読む仕様・ソースコード）
        {
          heading: t('relatedHeading'),
          links: [
            { label: t('relatedIiif'), href: 'https://iiif.io/', external: true },
            {
              label: t('relatedPresentation'),
              href: 'https://iiif.io/api/presentation/3.0/',
              external: true,
            },
            { label: t('relatedCookbook'), href: 'https://iiif.io/api/cookbook/', external: true },
            {
              label: t('relatedSpec'),
              href: 'https://iiif.io/api/extension/3d/',
              external: true,
            },
            {
              label: t('relatedSource'),
              href: 'https://github.com/nakamura196/iiif-kasane',
              external: true,
            },
          ],
        },
      ]}
    />
  );
}
