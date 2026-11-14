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
export const BOOKMARK_LIMIT = 200;

const EMPTY: HistoryData = { recent: [], bookmarks: [] };

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
    if (!e || seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Whatever is in storage, made into valid lists (junk is dropped). Never throws. */
export function readHistory(): HistoryData {
  try {
    const text = localStorage.getItem(HISTORY_KEY);
    if (!text) return EMPTY;
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return EMPTY;
    return { recent: cleanList(v.recent, RECENT_LIMIT), bookmarks: cleanList(v.bookmarks, BOOKMARK_LIMIT) };
  } catch {
    return EMPTY;
  }
}

function write(data: HistoryData): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch {
    // full or blocked: the lists just are not kept
    return;
  }
  try {
    window.dispatchEvent(new Event(HISTORY_EVENT));
  } catch {
    // no window (tests, server)
  }
}

export type NewEntry = Omit<HistoryEntry, 'at'> & { at?: number };

const stamp = (e: NewEntry): HistoryEntry | null => cleanEntry({ ...e, at: e.at ?? Date.now() });

/** Put the item at the top of "recently opened" (once per URL), keeping at most RECENT_LIMIT. */
export function recordOpened(entry: NewEntry): void {
  const e = stamp(entry);
  if (!e) return;
  const data = readHistory();
  const old = data.recent.find((x) => x.url === e.url);
  // keep what we knew when the new fetch gave nothing
  if (old) {
    if (!e.label && old.label) e.label = old.label;
    if (!e.thumbnail && old.thumbnail) e.thumbnail = old.thumbnail;
  }
  write({ ...data, recent: [e, ...data.recent.filter((x) => x.url !== e.url)].slice(0, RECENT_LIMIT) });
  // a bookmarked item learns its label and thumbnail too
  if (data.bookmarks.some((b) => b.url === e.url)) refreshBookmark(e);
}

function refreshBookmark(e: HistoryEntry): void {
  const data = readHistory();
  write({
    ...data,
    bookmarks: data.bookmarks.map((b) =>
      b.url === e.url ? { ...b, label: e.label || b.label, thumbnail: e.thumbnail ?? b.thumbnail, kind: e.kind } : b,
    ),
  });
}

/** Bookmark the item (newest first). Bookmarking again keeps the first date. */
export function addBookmark(entry: NewEntry): void {
  const e = stamp(entry);
  if (!e) return;
  const data = readHistory();
  const old = data.bookmarks.find((x) => x.url === e.url);
  const next = old ? { ...e, at: old.at } : e;
  write({ ...data, bookmarks: [next, ...data.bookmarks.filter((x) => x.url !== e.url)].slice(0, BOOKMARK_LIMIT) });
}

export function removeBookmark(url: string): void {
  const data = readHistory();
  write({ ...data, bookmarks: data.bookmarks.filter((x) => x.url !== url) });
}

export function removeRecent(url: string): void {
  const data = readHistory();
  write({ ...data, recent: data.recent.filter((x) => x.url !== url) });
}

export function clearRecent(): void {
  write({ ...readHistory(), recent: [] });
}

export const isBookmarked = (data: HistoryData, url: string | null | undefined): boolean =>
  !!url && data.bookmarks.some((b) => b.url === url);

/** The label in the reader's language: that language, then English, then no language, then the first one. */
export function labelText(label: HistoryLabel, locale: string): string {
  if (typeof label === 'string') return label;
  const pick = (k: string) => label[k]?.[0];
  return pick(locale) ?? pick('en') ?? pick('none') ?? pick('@none') ?? Object.values(label)[0]?.[0] ?? '';
}

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
