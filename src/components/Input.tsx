// 入力フォームコンポーネント
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
  // 手元の画像を開くボタンを出す（ビューアの入口だけ。画像はサーバに送らない）
  // 複数選んだときやフォルダを選んだときは、名前順に並べて 1 冊として開く
  onOpenFile?: (files: File[]) => void;
  // 手元の画像が開けなかったときの文言
  fileError?: string;
  // 読み込みの途中経過（何枚目か）
  fileStatus?: string;
  // トップページ用: 大きなアイコンを出さず、入力欄とボタンを 1 行に並べる
  compact?: boolean;
  // フォームとユースケース一覧のあいだに差し込む内容（トップページのデモ動画など）
  children?: React.ReactNode;
  // 見出しと説明を差し替える（地図と画像の画面など、ページ専用の入口にするとき）
  title?: string;
  description?: string;
  // 並べるユースケース。既定はトップと同じ featured の 6 件
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
    // 同じファイルを続けて選んでも change が起きるように空にする
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
              // フォルダを選ぶと、中のファイルがすべて渡る（画像でないものは開くときに除く）
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
            {/* ビューアで開くのとは別に、画像を置く場所を決めて、ほかでも使えるマニフェストにする */}
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
        {/* 開いたときの画面（短い動画）つきで並べ、何ができるかを見せる。6 件を 3 列 × 2 行（主な機能の 3 列とそろえる） */}
        <ul className={`grid grid-cols-2 ${useCases.length < 3 ? '' : 'sm:grid-cols-3'} gap-3 text-left`}>
          {useCases.map((u) => (
            <li key={u.id}>
              <Link
                href={hrefOf(u.open)}
                className="group block h-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] overflow-hidden hover:border-[var(--ds-primary)]"
              >
                {/* 開いて何をすると何が起きるかを、数秒の動画で見せる。動画を撮ってあるのは featured の例だけなので、ほかはサムネイルを出す */}
                {u.featured ? (
                  <UseCaseClip src={clipOf(u, locale)} poster={thumbnailOf(u, locale)} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- 静的書き出しなので next/image の最適化は使えない
                  <img
                    src={thumbnailOf(u, locale)}
                    alt=""
                    width={640}
                    height={400}
                    loading="lazy"
                    className="w-full aspect-[16/10] object-cover bg-[var(--ds-surface-2)]"
                  />
                )}
                {/* 見出しは「何ができるか」、その下に小さく資料の名前 */}
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
        {/* 一覧ページへの入口。ユースケースとサンプルはボタンで目立たせ、検索は文字のリンクのまま */}
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
