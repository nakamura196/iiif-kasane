import { manifestThumbnailOf } from 'iiif-kasane/core';

// Recently opened items and bookmarks, kept only in this browser (localStorage).
// Both lists live under one versioned key, so the shape can change later without reading old junk.
// Every read and write is guarded: the site must work when storage is missing, full or holds something else.

export type HistoryKind = 'manifest' | 'collection';
/** A label already in one language, or a IIIF language map ({ ja: ['…'], en: ['…'] }). */
export type HistoryLabel = string | Record<string, string[]>;

export interface HistoryEntry {
  url: string;
  label: HistoryLabel;
  kind: HistoryKind;
  thumbnail?: string;
  /** ms since the epoch: when it was last opened (recent) or bookmarked (bookmarks) */
  at: number;
}

export interface HistoryData {
  recent: HistoryEntry[];
  bookmarks: HistoryEntry[];
}

export const HISTORY_KEY = 'kasane:history:v1';
export const HISTORY_EVENT = 'kasane:history-change';
export const RECENT_LIMIT = 30;
// Bookmarks have no cap: the user chose each one, so none is dropped silently.

export const EMPTY_HISTORY: HistoryData = { recent: [], bookmarks: [] };

/** http:// and https:// of the same address are one item (the loader retries http as https), so they compare equal. */
export const urlKey = (url: string): string => url.replace(/^http:/i, 'https:');
const same = (a: string, b: string): boolean => urlKey(a) === urlKey(b);

// The viewer page is the only place that records and bookmarks (the Header does it).
// TODO: move the recorder and the star into ViewerContent once #356 has landed (that file is being changed there),
// and drop this path check.
export const isViewerPath = (pathname: string | null | undefined): boolean => /\/viewer\/?$/.test(pathname ?? '');


/** A local image (blob:) cannot be opened again after a reload, so it is never kept. Only http(s) is. */
export const isRecordable = (url: unknown): url is string =>
  typeof url === 'string' && url.length <= 2000 && /^https?:\/\//i.test(url);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanLabel(v: unknown): HistoryLabel | undefined {
  if (typeof v === 'string') return v.trim() ? v.slice(0, 500) : undefined;
  if (!isObject(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [lang, values] of Object.entries(v)) {
    if (!Array.isArray(values)) continue;
    const strings = values.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.slice(0, 500));
    if (strings.length) out[lang] = strings.slice(0, 5);
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanEntry(v: unknown): HistoryEntry | null {
  if (!isObject(v) || !isRecordable(v.url)) return null;
  const label = cleanLabel(v.label) ?? '';
  const at = typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0;
  const entry: HistoryEntry = { url: v.url, label, kind: v.kind === 'collection' ? 'collection' : 'manifest', at };
  if (typeof v.thumbnail === 'string' && /^(https?:\/\/|\/)/i.test(v.thumbnail) && v.thumbnail.length <= 2000) {
    entry.thumbnail = v.thumbnail;
  }
  return entry;
}

function cleanList(v: unknown, limit: number): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const raw of v) {
    const e = cleanEntry(raw);
    if (!e || seen.has(urlKey(e.url))) continue;
    seen.add(urlKey(e.url));
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Whatever is in storage, made into valid lists (junk is dropped). Never throws. */
export function readHistory(): HistoryData {
  try {
    const text = localStorage.getItem(HISTORY_KEY);
    if (!text) return EMPTY_HISTORY;
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return EMPTY_HISTORY;
    return { recent: cleanList(v.recent, RECENT_LIMIT), bookmarks: cleanList(v.bookmarks, Infinity) };
  } catch {
    return EMPTY_HISTORY;
  }
}

/** Save both lists. False when storage is full or blocked: the change was not kept, and callers tell the user. */
function write(data: HistoryData): boolean {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(HISTORY_EVENT));
  } catch {
    // no window (tests, server)
  }
  return true;
}

/** What is known about an item. A missing field means "not known now" (for example the load failed): it never overwrites. */
export interface NewEntry {
  url: string;
  label?: HistoryLabel;
  kind?: HistoryKind;
  thumbnail?: string;
  at?: number;
}

/** Fields of `e` that are known, over what was known before. */
function merged(e: NewEntry, old: HistoryEntry | undefined, at: number): HistoryEntry | null {
  const label = cleanLabel(e.label);
  return cleanEntry({
    url: e.url,
    label: label ?? old?.label ?? '',
    kind: e.kind ?? old?.kind ?? 'manifest',
    thumbnail: e.thumbnail ?? old?.thumbnail,
    at,
  });
}

/**
 * Put the item at the top of "recently opened" (once per address), keeping at most RECENT_LIMIT.
 * A bookmarked copy learns the label, kind and thumbnail too. One read, one write, one event.
 * Returns false when it could not be saved.
 */
export function recordOpened(entry: NewEntry): boolean {
  const data = readHistory();
  const at = entry.at ?? Date.now();
  const e = merged(entry, data.recent.find((x) => same(x.url, entry.url)) ?? data.bookmarks.find((x) => same(x.url, entry.url)), at);
  if (!e) return false;
  return write({
    recent: [e, ...data.recent.filter((x) => !same(x.url, e.url))].slice(0, RECENT_LIMIT),
    // a bookmark keeps its own url and date; only what we learned about the item is updated
    bookmarks: data.bookmarks.map((b) => (same(b.url, e.url) ? { ...b, label: e.label || b.label, kind: e.kind, thumbnail: e.thumbnail ?? b.thumbnail } : b)),
  });
}

// Which item the viewer opened last, and how many times "Clear history" ran. A read that was started before either
// changed is out of date and must not be written (a slow earlier item would land above the later one, or come back after Clear).
let latestOpen: string | null = null;
let clearGeneration = 0;
export interface OpenTicket {
  url: string;
  generation: number;
}
/** Call when an item starts loading. Pass the ticket to recordLoaded. */
export function beginOpen(url: string): OpenTicket {
  latestOpen = url;
  return { url, generation: clearGeneration };
}

/**
 * Record an item whose manifest was just read. When it could not be read (`raw` is null: 404, typo, CORS, login),
 * nothing is recorded and nothing already kept is touched. The label may be passed raw: it is cleaned here.
 */
export function recordLoaded(url: string, raw: unknown, ticket?: OpenTicket): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (ticket && (ticket.generation !== clearGeneration || latestOpen !== ticket.url)) return false;
  const r = raw as { label?: unknown; type?: unknown };
  return recordOpened({
    url,
    label: r.label as HistoryLabel | undefined,
    kind: r.type === 'Collection' ? 'collection' : 'manifest',
    thumbnail: manifestThumbnailOf(raw),
  });
}

/** Bookmark the item (newest first). Bookmarking again keeps the first date. Returns false when it could not be saved. */
export function addBookmark(entry: NewEntry): boolean {
  const data = readHistory();
  const old = data.bookmarks.find((x) => same(x.url, entry.url));
  const e = merged(entry, old ?? data.recent.find((x) => same(x.url, entry.url)), old?.at ?? entry.at ?? Date.now());
  if (!e) return false;
  return write({ ...data, bookmarks: [e, ...data.bookmarks.filter((x) => !same(x.url, e.url))] });
}

export function removeBookmark(url: string): boolean {
  const data = readHistory();
  return write({ ...data, bookmarks: data.bookmarks.filter((x) => !same(x.url, url)) });
}

export function removeRecent(url: string): boolean {
  const data = readHistory();
  return write({ ...data, recent: data.recent.filter((x) => !same(x.url, url)) });
}

/** Empty "recently opened". Returns what was there (for an undo), or null when it could not be saved. */
export function clearRecent(): HistoryEntry[] | null {
  const data = readHistory();
  if (!write({ ...data, recent: [] })) return null;
  clearGeneration++;
  return data.recent;
}

/** Put back entries removed by clearRecent: merged with what was opened since, newest first. */
export function restoreRecent(entries: HistoryEntry[]): boolean {
  const data = readHistory();
  const seen = new Set(data.recent.map((e) => urlKey(e.url)));
  const back = entries.filter((e) => !seen.has(urlKey(e.url)));
  const recent = [...data.recent, ...back].sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT);
  return write({ ...data, recent });
}

export const isBookmarked = (data: HistoryData, url: string | null | undefined): boolean =>
  !!url && data.bookmarks.some((b) => same(b.url, url));

/** The site name of a URL ("example.org"), for the small line under a label. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Subscribe to changes made in this tab and in other tabs. Returns the unsubscribe function. */
export function subscribeHistory(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HISTORY_KEY) onChange();
  };
  window.addEventListener(HISTORY_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(HISTORY_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
