import fs from 'fs';
import path from 'path';
import DevelopersContent from '@/components/page/DevelopersContent';
import { setRequestLocale } from 'next-intl/server';
import { alternatesFor } from '@/lib/site';
import type { Metadata } from 'next';

// 開発者向けのページ。Astro の例は packages/iiif-viewer/examples/astro/ の実物をそのまま見せる
// （コードを二重に持たない。例を直せばこのページも変わる）。

const ASTRO = path.join(process.cwd(), 'packages', 'iiif-viewer', 'examples', 'astro', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(ASTRO, ...p), 'utf8').trimEnd();

/** parts.astro の <style is:global> の中身（自前のレイアウトの CSS）。プレビューにもこれを使う */
function layoutCss(parts: string): string {
  const m = parts.match(/<style is:global>([\s\S]*?)<\/style>/);
  if (!m) return '';
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^ {4}/, ''))
    .join('\n')
    .trim();
}

export default async function DevelopersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const parts = read('pages', 'parts.astro');
  return (
    <DevelopersContent
      files={{
        tagAstro: read('pages', 'tag.astro'),
        partsAstro: parts,
        freeLayout: read('components', 'FreeLayout.tsx'),
        layoutCss: layoutCss(parts),
      }}
    />
  );
}

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'ja' }];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'en' ? 'For developers' : '開発者向け',
    alternates: alternatesFor(locale, 'developers/'),
  };
}
