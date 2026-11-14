'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SaveNotice from './SaveNotice';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { contentParam, labelIn } from 'iiif-kasane/core';
import {
  clearRecent,
  restoreRecent,
  hostOf,
  removeBookmark,
  removeRecent,
  type HistoryEntry,
} from '@/lib/history';
import { useHistory } from './useHistory';

const SHOWN = 6;

function Item({ entry, onRemove, removeLabel }: { entry: HistoryEntry; onRemove: () => boolean; removeLabel: string }) {
  const locale = useLocale();
  const t = useTranslations('History');
  const host = hostOf(entry.url);
  const label = labelIn(entry.label, locale) || host || entry.url;
  return (
    <li className="relative flex min-w-0 items-center gap-3 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 pr-9 hover:border-[var(--ds-primary)]">
      <span className="shrink-0 w-12 h-12 rounded overflow-hidden bg-[var(--ds-surface-2)]">
        {entry.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- an outside IIIF image; the site is exported statically, so next/image cannot be used
          <img src={entry.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
        )}
      </span>
      <Link href={`/viewer?${contentParam(entry.url)}`} className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']">
        <span className="block truncate font-medium text-[var(--ds-primary)]">{label}</span>
        <span className="block truncate text-xs text-[var(--ds-fg-muted)]">
          {entry.kind === 'collection' ? `${t('collection')} · ` : ''}
          {host}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => void onRemove()}
        aria-label={`${removeLabel}: ${label}`}
        title={removeLabel}
        className="absolute right-1.5 top-1.5 z-10 p-1 rounded text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-ring)]"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

// "Bookmarks" and "Recently opened" on an entry screen. Draws nothing while both are empty.
export default function HistoryLists() {
  const t = useTranslations('History');
  const { recent, bookmarks } = useHistory();
  const [allRecent, setAllRecent] = useState(false);
  const [allBookmarks, setAllBookmarks] = useState(false);
  // what "Clear history" removed, offered back for a few seconds
  const [cleared, setCleared] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const closeNotice = useCallback(() => setFailed(false), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const check = (saved: boolean) => {
    setFailed(!saved);
    return saved;
  };
  const clear = () => {
    const before = clearRecent();
    if (!check(before !== null) || !before?.length) return;
    setCleared(before);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCleared(null), 8000);
  };
  const undo = () => {
    if (cleared && check(restoreRecent(cleared))) setCleared(null);
  };
  if (recent.length === 0 && bookmarks.length === 0 && !cleared) return null;
  const shownRecent = allRecent ? recent : recent.slice(0, SHOWN);
  const shownBookmarks = allBookmarks ? bookmarks : bookmarks.slice(0, SHOWN);
  return (
    <div className="mt-8 space-y-6 text-left" data-testid="history-lists">
      {/* right after "Clear history": say so, with an undo (also when bookmarks remain) */}
      {cleared && (
        <p className="text-sm text-[var(--ds-fg-muted)]" role="status">
          {t('cleared')}{' '}
          <button type="button" onClick={undo} className="underline text-[var(--ds-primary)]">{t('undo')}</button>
        </p>
      )}
      {bookmarks.length > 0 && (
        <section aria-labelledby="history-bookmarks">
          <h3 id="history-bookmarks" className="mb-2 text-sm font-medium text-[var(--ds-fg-muted)]">
            {t('bookmarks')}
          </h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="bookmark-list">
            {shownBookmarks.map((e) => (
              <Item key={e.url} entry={e} removeLabel={t('removeBookmark')} onRemove={() => check(removeBookmark(e.url))} />
            ))}
          </ul>
          {bookmarks.length > SHOWN && (
            <button type="button" onClick={() => setAllBookmarks(!allBookmarks)} className="mt-2 text-xs underline text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]">
              {allBookmarks ? t('showFewer') : t('showAll', { count: bookmarks.length })}
            </button>
          )}
        </section>
      )}
      {recent.length > 0 && (
        <section aria-labelledby="history-recent">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="history-recent" className="text-sm font-medium text-[var(--ds-fg-muted)]">
              {t('recent')}
            </h3>
            <button type="button" onClick={clear} className="text-xs underline text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]">
              {t('clear')}
            </button>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="recent-list">
            {shownRecent.map((e) => (
              <Item key={e.url} entry={e} removeLabel={t('removeRecent')} onRemove={() => check(removeRecent(e.url))} />
            ))}
          </ul>
          {recent.length > SHOWN && (
            <button type="button" onClick={() => setAllRecent(!allRecent)} className="mt-2 text-xs underline text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)]">
              {allRecent ? t('showFewer') : t('showAll', { count: recent.length })}
            </button>
          )}
        </section>
      )}
      <p className="text-xs text-[var(--ds-fg-muted)]">{t('note')}</p>
      {failed && <SaveNotice onClose={closeNotice} />}
    </div>
  );
}
