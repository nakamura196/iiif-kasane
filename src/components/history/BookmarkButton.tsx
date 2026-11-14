'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addBookmark, isBookmarked, isRecordable, removeBookmark } from '@/lib/history';
import { useHistory } from './useHistory';
import SaveNotice from './SaveNotice';

// A star in the viewer's header: bookmark the open item. Not shown for a local image (it cannot be opened again),
// nor until the item has loaded (a dead URL is not worth keeping); an item that is already bookmarked can always be un-starred.
export default function BookmarkButton({ url, loaded }: { url: string | null; loaded: boolean }) {
  const t = useTranslations('History');
  const data = useHistory();
  // the URL the last save failed for: the notice belongs to that item only
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const closeNotice = useCallback(() => setFailedFor(null), []);
  if (!url || !isRecordable(url)) return null;
  const on = isBookmarked(data, url);
  if (!loaded && !on) return null;
  const toggle = () => {
    // label, kind and thumbnail are filled in from the recent entry
    const saved = on ? removeBookmark(url) : addBookmark({ url });
    setFailedFor(saved ? null : url);
  };
  // one fixed name; the pressed state says whether it is on
  const text = t('bookmarkItem');
  return (
    <>
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
      {failedFor === url && (
        <SaveNotice
          onClose={closeNotice}
          className="fixed right-3 top-12 z-50 max-w-[16rem] rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-1.5 shadow"
        />
      )}
    </>
  );
}
