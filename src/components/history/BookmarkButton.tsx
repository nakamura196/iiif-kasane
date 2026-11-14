'use client';

import { useTranslations } from 'next-intl';
import { addBookmark, isBookmarked, isRecordable, removeBookmark } from '@/lib/history';
import { useHistory } from './useHistory';

// A star in the viewer's header: bookmark the open item (not shown for a local image, which cannot be opened again).
export default function BookmarkButton({ url }: { url: string | null }) {
  const t = useTranslations('History');
  const data = useHistory();
  if (!url || !isRecordable(url)) return null;
  const on = isBookmarked(data, url);
  // the label and thumbnail were put in "recent" when the item was opened
  const known = data.recent.find((e) => e.url === url) ?? data.bookmarks.find((e) => e.url === url);
  const toggle = () => {
    if (on) removeBookmark(url);
    else addBookmark({ url, label: known?.label ?? '', kind: known?.kind ?? 'manifest', thumbnail: known?.thumbnail });
  };
  const text = on ? t('removeBookmark') : t('addBookmark');
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={text}
      title={text}
      data-testid="bookmark-toggle"
      className={`p-1.5 rounded-md transition-colors hover:text-[var(--ds-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)] ${on ? 'text-[var(--ds-primary)]' : 'text-[var(--ds-fg-muted)]'}`}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.8l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85L12 3.5z" />
      </svg>
    </button>
  );
}
