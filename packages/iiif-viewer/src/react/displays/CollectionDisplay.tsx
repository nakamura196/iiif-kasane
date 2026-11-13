'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  chronologyOf,
  collectionEntriesOf,
  fetchManifest,
  hasChronology,
  labelIn,
  manifestThumbnailOf,
  navDateText,
  yearText,
  type CollectionEntry,
} from '../../core';
import { shownManifestAtom } from '../atoms';
import { useLocale, useTranslations } from '../env';
import { displayAfter } from './registry';
import { useManifestSwitch } from './structureState';
import type { Display, DisplayProps } from './types';

// Thumbnails read from the Manifests themselves, by Manifest id. Kept for the page's lifetime,
// so switching the order (or reopening the Collection) does not fetch them again.
const fetchedThumbnails = new Map<string, Promise<string | undefined>>();
const thumbnailFromManifest = (id: string) => {
  let p = fetchedThumbnails.get(id);
  if (!p) {
    p = fetchManifest(id).then((raw) => manifestThumbnailOf(raw));
    fetchedThumbnails.set(id, p);
  }
  return p;
};

// The picture of a card. When the Collection gives no thumbnail for the item (Cookbook 0230),
// the Manifest is fetched, but only once the card comes into view: a Collection may list hundreds.
function EntryThumbnail({ entry, className }: { entry: CollectionEntry; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fetched, setFetched] = useState<{ id: string; url?: string } | null>(null);
  const need = !entry.thumbnail;

  useEffect(() => {
    const el = ref.current;
    if (!need || !el) return;
    let cancelled = false;
    const load = () =>
      thumbnailFromManifest(entry.id).then((url) => {
        if (!cancelled) setFetched({ id: entry.id, url });
      });
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) {
        io.disconnect();
        load();
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [need, entry.id]);

  const url = entry.thumbnail ?? (fetched?.id === entry.id ? fetched.url : undefined);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" className={`object-contain bg-white/60 ${className}`} />;
  }
  // nothing yet (or nothing found): keep the place empty, so the card does not jump when the picture arrives
  return need && fetched?.id !== entry.id ? <span ref={ref} aria-hidden className={className} /> : null;
}

/**
 * The entries of a Collection, from the JSON kept with the shown manifest when it is this one, else read by the
 * Collection's id (a host page may set manifestAtom itself).
 */
export async function collectionEntriesFor(
  shown: { manifest: unknown; raw: unknown } | null,
  manifest: { id: string },
): Promise<CollectionEntry[]> {
  if (shown && shown.manifest === manifest) return collectionEntriesOf(shown.raw);
  const raw = await fetchManifest(manifest.id);
  return raw ? collectionEntriesOf(raw) : [];
}

// A Collection (a manifest whose items are Manifests): choose one to open.
// When two or more items carry a navDate (Cookbook 0230), they can also be shown by date, grouped by year.
// The converter turns the items into empty Scenes, so the Collection as served is read
// to know which entries are Manifests and which are Collections.
function CollectionDisplay(props: DisplayProps) {
  const { manifest, containers } = props;
  const t = useTranslations('Structure');
  const locale = useLocale();
  const { open } = useManifestSwitch();
  const isCollection = (manifest as { type?: string }).type === 'Collection';
  const [state, setState] = useState<{ id: string; kind: 'opening' | 'error' } | null>(null);
  const [order, setOrder] = useState<'collection' | 'date'>('collection');

  // the entries come from the Collection as served: kept with the shown one, or read by its id when a host page
  // put the manifest into the store itself (manifestAtom)
  const shown = useAtomValue(shownManifestAtom);
  const stored = shown?.manifest === manifest ? shown.raw : null;
  const [fetched, setFetched] = useState<{ id: string; entries: CollectionEntry[] } | null>(null);
  useEffect(() => {
    if (!isCollection || stored || !manifest.id) return;
    let cancelled = false;
    void collectionEntriesFor(null, manifest).then((entries) => {
      if (!cancelled) setFetched({ id: manifest.id, entries });
    });
    return () => {
      cancelled = true;
    };
  }, [isCollection, stored, manifest]);
  const read = useMemo(
    () => (!isCollection ? [] : stored ? collectionEntriesOf(stored) : fetched?.id === manifest.id ? fetched.entries : []),
    [isCollection, stored, fetched, manifest.id],
  );

  // not a Collection: an empty Scene is a Canvas that the converter turned into a Scene (a rotated image,
  // a Choice, a missing image). The displays after this one decide how it looks (imageCanvas, then scene).
  if (!isCollection) {
    const next = displayAfter(collectionDisplay.id, props.container);
    return next ? <next.Component {...props} /> : null;
  }

  const fromContainers: CollectionEntry[] = containers.map((c) => ({
    id: c.id,
    type: 'Manifest',
    label: c.label,
  }));
  const entries = read.length > 0 ? read : fromContainers;

  const openEntry = async (e: CollectionEntry) => {
    setState({ id: e.id, kind: 'opening' });
    const result = await open(e.id, true);
    if (result === 'failed') setState({ id: e.id, kind: 'error' });
    // dropped because something else was asked for: stop showing this entry as opening (unless another entry is)
    else if (result === 'stale') setState((s) => (s?.id === e.id ? null : s));
  };

  if (entries.length === 0) {
    return <div className="p-4 text-sm text-[var(--ds-fg)]">{t('collectionEmpty')}</div>;
  }

  // grid: a card in the grid (as listed). row: one wide row in the timeline (thumbnail left, text right).
  const card = (e: CollectionEntry, layout: 'grid' | 'row') => (
    <li key={e.id}>
      <button
        type="button"
        onClick={() => openEntry(e)}
        className={`w-full h-full text-left rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] hover:bg-[var(--ds-surface-2)] p-2 text-sm text-[var(--ds-fg)] flex gap-1 ${layout === 'row' ? 'flex-row gap-3 items-start' : 'flex-col'}`}
      >
        <EntryThumbnail entry={e} className={layout === 'row' ? 'h-24 w-24 shrink-0' : 'h-24 w-full'} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium break-words">{labelIn(e.label, locale) || e.id}</span>
          {e.navDate ? (
            <time dateTime={e.navDate} className="text-xs">
              {navDateText(e.navDate, locale)}
            </time>
          ) : null}
          <span className="text-xs opacity-70">
            {e.type === 'Collection' ? t('subCollection') : t('manifest')}
            {state?.id === e.id
              ? ` ・ ${t(state.kind === 'opening' ? 'opening' : 'openError')}`
              : ''}
          </span>
        </span>
      </button>
    </li>
  );
  const grid = (list: CollectionEntry[]) => (
    <ul
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}
    >
      {list.map((e) => card(e, 'grid'))}
    </ul>
  );
  const rows = (list: CollectionEntry[]) => (
    <ul className="flex flex-col gap-2">{list.map((e) => card(e, 'row'))}</ul>
  );

  const dated = hasChronology(entries);
  const byDate = dated && order === 'date';
  const chronology = byDate ? chronologyOf(entries) : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-auto p-3">
      {dated ? (
        <div
          role="group"
          aria-label={t('collectionOrder')}
          className="mb-3 flex items-center gap-2 text-xs text-[var(--ds-fg)]"
        >
          <span className="opacity-70">{t('collectionOrder')}</span>
          {(['collection', 'date'] as const).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={order === o}
              onClick={() => setOrder(o)}
              className={`rounded border border-[var(--ds-border)] px-2 py-1 ${order === o ? 'bg-[var(--ds-surface-2)] font-medium' : 'bg-[var(--ds-surface)] hover:bg-[var(--ds-surface-2)]'}`}
            >
              {t(o === 'collection' ? 'orderCollection' : 'orderDate')}
            </button>
          ))}
        </div>
      ) : null}
      {chronology ? (
        // a timeline is read top to bottom: one centred column, as wide as the text pages (max-w-3xl)
        <ol
          aria-label={t('timeline')}
          className="mx-auto max-w-3xl border-l-2 border-[var(--ds-border)] pl-0"
        >
          {chronology.years.map((y) => (
            <li key={y.year} className="relative pl-4 pb-4">
              <span
                aria-hidden
                className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-[var(--ds-fg)]"
              />
              <h3 className="mb-2 text-sm font-semibold text-[var(--ds-fg)]">
                {yearText(y.year, locale)}
                {y.entries.length > 1 ? (
                  <span className="ml-2 text-xs font-normal opacity-70">
                    {t('itemCount', { count: y.entries.length })}
                  </span>
                ) : null}
              </h3>
              {rows(y.entries.map((d) => d.entry))}
            </li>
          ))}
          {chronology.undated.length > 0 ? (
            <li className="relative pl-4 pb-4">
              <h3 className="mb-2 text-sm font-semibold text-[var(--ds-fg)] opacity-70">
                {t('undated')}
              </h3>
              {rows(chronology.undated)}
            </li>
          ) : null}
        </ol>
      ) : (
        grid(entries)
      )}
    </div>
  );
}

export const collectionDisplay: Display = {
  id: 'collection',
  // a Collection arrives as empty Scenes; the component checks the manifest type
  match: (c) => c.kind === 'Scene' && c.painting.length === 0,
  Component: CollectionDisplay,
};
