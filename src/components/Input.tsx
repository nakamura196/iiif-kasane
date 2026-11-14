// The manifest input form
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { buttonClass } from '@nakamura196/react-ui';
import { FEATURED_USE_CASES, clipOf, hrefOf, thumbnailOf, type UseCase } from '@/lib/usecases';
import UseCaseClip from '@/components/usecases/UseCaseClip';
import HistoryLists from '@/components/history/HistoryLists';

const ManifestInput = ({
  onSubmit,
  children,
  compact = false,
  title,
  description,
  useCases = FEATURED_USE_CASES,
  history = !compact && !title,
  onOpenFile,
  fileError,
  fileStatus,
}: {
  onSubmit: (url: string, tab?: string) => void;
  // Show the buttons that open images from this computer (the viewer entry only; images are never sent to a server)
  // Several images, or a folder, are sorted by name and opened as one book
  onOpenFile?: (files: File[]) => void;
  // Message shown when a local image could not be opened
  fileError?: string;
  // Progress of reading (which image)
  fileStatus?: string;
  // For the top page: no large icon; the input and the button sit in one row
  compact?: boolean;
  // Content placed between the form and the use case list (the demo video on the top page, for example)
  children?: React.ReactNode;
  // Replace the heading and the description (for a page's own entry, such as the map and image page)
  title?: string;
  description?: string;
  // Use cases to list. The default is the same 6 featured ones as the top page
  useCases?: UseCase[];
  // Recently opened items and bookmarks. On by default for the viewer entry (not the top page's compact form, nor entries with their own title)
  history?: boolean;
}) => {
  const t = useTranslations('Input');
  const locale = useLocale() === 'en' ? 'en' : 'ja';
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Clear the value so that picking the same file again still fires change
    e.target.value = '';
    if (files.length) onOpenFile?.(files);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError(t('requiredUrl'));
      return;
    }
    try {
      new URL(url);
      setError('');
      onSubmit(url);
    } catch {
      setError(t('invalidUrl'));
    }
  };

  return (
    <div className="w-full">
      <div className={compact ? 'max-w-xl mx-auto' : 'max-w-md mx-auto'}>
        <div className={compact ? 'mb-4 text-center' : 'mb-8 text-center'}>
          {!compact && (
            <div className="inline-block p-4 bg-[var(--ds-surface-2)] rounded-full mb-4">
              <svg
                className="w-16 h-16 text-[var(--ds-primary)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
          )}
          <h2
            className={`${compact ? 'text-xl' : 'text-2xl'} font-bold text-[var(--ds-fg)] mb-2`}
            style={{ fontFamily: 'var(--ds-font-serif)' }}
          >
            {title ?? t('title')}
          </h2>
          <p className={`text-[var(--ds-fg-muted)] ${compact ? 'text-sm' : ''}`}>{description ?? t('description')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={compact ? 'flex flex-col gap-3 sm:flex-row sm:items-start' : 'space-y-4'}
        >
          <div className={compact ? 'flex-1' : undefined}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/manifest.json"
              className="w-full px-4 py-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]"
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>

          <button
            type="submit"
            className={buttonClass(
              'primary',
              'md',
              compact ? 'w-full sm:w-auto shrink-0' : 'w-full'
            )}
          >
            {t('submit')}
          </button>
        </form>

        {onOpenFile && (
          <div className="mt-6 pt-6 border-t border-[var(--ds-border)] text-center">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-testid="local-image-input"
              onChange={pick}
            />
            <input
              ref={folderInput}
              type="file"
              // Picking a folder passes every file in it (non-images are left out when opening)
              {...{ webkitdirectory: '', directory: '' }}
              className="hidden"
              data-testid="local-folder-input"
              onChange={pick}
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className={buttonClass('secondary', 'md', 'w-full sm:flex-1')}
              >
                {t('openLocalImage')}
              </button>
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                className={buttonClass('secondary', 'md', 'w-full sm:flex-1')}
              >
                {t('openLocalFolder')}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--ds-fg-muted)]">{t('openLocalImageNote')}</p>
            {/* Apart from opening in the viewer: decide where the images live and make a manifest that works elsewhere */}
            <p className="mt-2 text-xs">
              <Link href="/manifest-editor" className="underline text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]">
                {t('toManifestEditor')}
              </Link>
            </p>
            {fileStatus && (
              <p className="mt-2 text-sm text-[var(--ds-fg-muted)]" role="status">
                {fileStatus}
              </p>
            )}
            {fileError && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{fileError}</p>}
          </div>
        )}
      </div>

      {history && <HistoryLists />}

      {children ? <div className={compact ? 'mt-10' : 'mt-12'}>{children}</div> : null}

      <div className="mt-8 text-sm text-[var(--ds-fg-muted)]">
        <h3 className="font-medium mb-2">{t('sampleManifest')}:</h3>
        {/* Each with a short clip of the opened screen, to show what it can do. 6 items in 3 columns x 2 rows (matching the 3 main-feature columns) */}
        <ul className={`grid grid-cols-2 ${useCases.length < 3 ? '' : 'sm:grid-cols-3'} gap-3 text-left`}>
          {useCases.map((u) => (
            <li key={u.id}>
              <Link
                href={hrefOf(u.open)}
                className="group block h-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] overflow-hidden hover:border-[var(--ds-primary)]"
              >
                {/* A few seconds of video show what happens when you open it and act. Only the featured examples have a clip; the others show a thumbnail */}
                {u.featured ? (
                  <UseCaseClip src={clipOf(u, locale)} poster={thumbnailOf(u, locale)} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- the site is exported statically, so next/image optimisation is not available
                  <img
                    src={thumbnailOf(u, locale)}
                    alt=""
                    width={640}
                    height={400}
                    loading="lazy"
                    className="w-full aspect-[16/10] object-cover bg-[var(--ds-surface-2)]"
                  />
                )}
                {/* The heading says what you can do; the item's name is small below it */}
                <span className="block p-2">
                  <span className="block font-medium text-[var(--ds-primary)] group-hover:underline">
                    {u.headline?.[locale] ?? u.title[locale]}
                  </span>
                  {u.headline ? (
                    <span className="mt-0.5 block text-xs text-[var(--ds-fg-muted)]">
                      {u.title[locale]}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {/* Entrances to the list pages: use cases and samples as prominent buttons, search as a plain text link */}
        <div className="mt-6 grid sm:grid-cols-2 gap-3">
          <Link href="/usecases" className={buttonClass('primary', 'lg', 'w-full')}>
            {t('sampleUseCasesAll')}
          </Link>
          <Link href="/samples" className={buttonClass('secondary', 'lg', 'w-full')}>
            {t('sampleManifestAll')}
          </Link>
        </div>
        <p className="mt-4 text-left">
          <Link href="/search" className="text-[var(--ds-primary)] hover:underline">
            {t('searchCollection')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ManifestInput;
