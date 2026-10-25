import BrowseContent from '@/components/page/BrowseContent';
import { setRequestLocale } from 'next-intl/server';
import { alternatesFor } from '@/lib/site';
import type { Metadata } from 'next';

export default async function BrowsePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BrowseContent />;
}

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'ja' }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'en' ? 'Browse in 3D' : '3D で一覧する',
    description:
      locale === 'en'
        ? 'Lay out the items of any IIIF Collection, or the pages of a Manifest, in 3D as a table, sphere, helix or grid, and open the ones you like.'
        : '任意の IIIF の Collection（や Manifest の各ページ）を、テーブル・球・らせん・グリッドの 3D 空間に並べて一覧し、気になる資料を開けます。',
    alternates: alternatesFor(locale, 'browse/'),
  };
}
