'use client';

import { useAtom } from 'jotai';
import { manifestUrlAtom } from 'iiif-kasane';
import { isLocalManifestUrl } from '@/lib/localImage';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { ThemeToggle, LanguageSwitcher, buttonClass } from '@nakamura196/react-ui';

// compact: ビューアのように表示領域を広く取りたいページでは、帯を細くする
const Header = ({ compact = false }: { compact?: boolean }) => {
  const [manifestUrl, setManifestUrl] = useAtom(manifestUrlAtom);
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('Header');

  const handleHomeClick = () => {
    setManifestUrl(null);
  };

  const changeLanguage = (newLocale: string) => {
    // 現在のパスから言語部分を除去
    const currentPath = pathname.replace(/^\/[^\/]+/, '');

    // クエリパラメータを維持
    const searchParams = new URLSearchParams(window.location.search);
    const queryString = searchParams.toString();

    // 新しいパスを構築
    const newPath = `/${newLocale}${currentPath}`;
    const fullPath = queryString ? `${newPath}?${queryString}` : newPath;

    router.push(fullPath);
  };

  return (
    <header className={`${compact ? 'h-10' : 'h-14'} shrink-0 bg-[var(--ds-bg)] border-b border-[var(--ds-border)] flex items-center px-3 sm:px-6 justify-between`}>
      <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
        <Link
          href="/"
          onClick={handleHomeClick}
          className="hover:opacity-80 transition-opacity shrink-0 flex items-center"
        >
          <h1
            className={`${compact ? 'text-base sm:text-lg' : 'text-lg sm:text-xl'} font-semibold text-[var(--ds-primary)] leading-none`}
            style={{ fontFamily: 'var(--ds-font-serif)' }}
          >
            {t('title')}
          </h1>
        </Link>
      </div>
      <div className="flex items-center space-x-2 sm:space-x-3 ml-2 shrink-0">
        <a
          href="https://github.com/nakamura196/iiif-kasane"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('source')}
          title={t('source')}
          className="p-1.5 rounded-md text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)] transition-colors"
        >
          <svg viewBox="0 0 16 16" className="w-5 h-5" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        <ThemeToggle />

        <LanguageSwitcher
          current={locale}
          onChange={changeLanguage}
          locales={[
            { code: 'ja', label: '日本語' },
            { code: 'en', label: 'English' },
          ]}
        />

        {manifestUrl && !isLocalManifestUrl(manifestUrl) && (
          // The manifest URL is a static asset / external URL already carrying
          // the basePath, not an in-app route. Use a plain <a> so next/link
          // does not prepend basePath a second time (which 404s on GH Pages).
          <a
            href={manifestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('primary', 'sm', 'whitespace-nowrap')}
          >
            <span className="hidden sm:inline">{t('download')}</span>
            <span className="sm:hidden">{t('downloadShort')}</span>
          </a>
        )}
      </div>
    </header>
  );
};

export default Header;
