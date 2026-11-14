import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_EVENT,
  HISTORY_KEY,
  RECENT_LIMIT,
  addBookmark,
  clearRecent,
  hostOf,
  isViewerPath,
  isBookmarked,
  labelText,
  readHistory,
  recordOpened,
  removeBookmark,
  removeRecent,
  subscribeHistory,
} from './history';

// A tiny localStorage and window, so that the tests run in plain node
let store: Map<string, string>;
let events: EventTarget;
let throwOnSet = false;
let throwOnGet = false;

beforeEach(() => {
  store = new Map();
  events = new EventTarget();
  throwOnSet = false;
  throwOnGet = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (throwOnGet) throw new Error('blocked');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new Error('QuotaExceededError');
      store.set(k, v);
    },
  });
  vi.stubGlobal('window', {
    addEventListener: (t: string, f: EventListener) => events.addEventListener(t, f),
    removeEventListener: (t: string, f: EventListener) => events.removeEventListener(t, f),
    dispatchEvent: (e: Event) => events.dispatchEvent(e),
  });
});
afterEach(() => vi.unstubAllGlobals());

const entry = (n: number, extra = {}) => ({
  url: `https://example.org/m${n}.json`,
  label: `Item ${n}`,
  kind: 'manifest' as const,
  ...extra,
});

describe('recently opened', () => {
  it('puts the newest first', () => {
    recordOpened({ ...entry(1), at: 1 });
    recordOpened({ ...entry(2), at: 2 });
    expect(readHistory().recent.map((e) => e.url)).toEqual([entry(2).url, entry(1).url]);
  });

  it('keeps one entry per URL and moves it to the top', () => {
    recordOpened({ ...entry(1), at: 1 });
    recordOpened({ ...entry(2), at: 2 });
    recordOpened({ ...entry(1), at: 3 });
    const { recent } = readHistory();
    expect(recent.map((e) => e.url)).toEqual([entry(1).url, entry(2).url]);
    expect(recent[0].at).toBe(3);
  });

  it('keeps the old label and thumbnail when the new fetch found none', () => {
    recordOpened(entry(1, { thumbnail: 'https://example.org/t.jpg' }));
    recordOpened({ url: entry(1).url });
    const [e] = readHistory().recent;
    expect(e.label).toBe('Item 1');
    expect(e.thumbnail).toBe('https://example.org/t.jpg');
  });

  it('keeps at most RECENT_LIMIT, dropping the oldest', () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i++) recordOpened({ ...entry(i), at: i });
    const { recent } = readHistory();
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0].url).toBe(entry(RECENT_LIMIT + 4).url);
    expect(recent.at(-1)?.url).toBe(entry(5).url);
  });

  it('never keeps a blob: (local image) URL, nor other schemes', () => {
    recordOpened({ url: 'blob:http://localhost/abc', label: 'local', kind: 'manifest' });
    recordOpened({ url: 'javascript:alert(1)', label: 'x', kind: 'manifest' });
    recordOpened({ url: 'data:text/plain,hi', label: 'x', kind: 'manifest' });
    addBookmark({ url: 'blob:http://localhost/abc', label: 'local', kind: 'manifest' });
    expect(store.has(HISTORY_KEY)).toBe(false);
    expect(readHistory()).toEqual({ recent: [], bookmarks: [] });
  });

  it('removes one entry and clears the list without touching bookmarks', () => {
    recordOpened(entry(1));
    recordOpened(entry(2));
    addBookmark(entry(2));
    removeRecent(entry(1).url);
    expect(readHistory().recent.map((e) => e.url)).toEqual([entry(2).url]);
    clearRecent();
    const data = readHistory();
    expect(data.recent).toEqual([]);
    expect(data.bookmarks).toHaveLength(1);
  });
});

describe('bookmarks', () => {
  it('adds, deduplicates (keeping the first date) and removes', () => {
    addBookmark({ ...entry(1), at: 10 });
    addBookmark({ ...entry(2), at: 20 });
    addBookmark({ ...entry(1), at: 30 });
    const { bookmarks } = readHistory();
    expect(bookmarks.map((b) => b.url)).toEqual([entry(1).url, entry(2).url]);
    expect(bookmarks[0].at).toBe(10);
    expect(isBookmarked(readHistory(), entry(1).url)).toBe(true);
    removeBookmark(entry(1).url);
    expect(isBookmarked(readHistory(), entry(1).url)).toBe(false);
    expect(readHistory().bookmarks).toHaveLength(1);
  });

  it('never drops a bookmark silently (no cap, also when read back)', () => {
    for (let i = 0; i < 250; i++) addBookmark(entry(i));
    const { bookmarks } = readHistory();
    expect(bookmarks).toHaveLength(250);
    expect(bookmarks.at(-1)?.url).toBe(entry(0).url);
  });

  it('fills in label and thumbnail when a bookmarked item is opened later', () => {
    addBookmark({ url: entry(1).url });
    recordOpened(entry(1, { thumbnail: 'https://example.org/t.jpg' }));
    const [b] = readHistory().bookmarks;
    expect(b.label).toBe('Item 1');
    expect(b.thumbnail).toBe('https://example.org/t.jpg');
  });

  it('keeps kind, label and thumbnail of a known item when a later load fails (only the url is known)', () => {
    recordOpened(entry(1, { kind: 'collection', thumbnail: 'https://example.org/t.jpg' }));
    addBookmark(entry(1, { kind: 'collection', thumbnail: 'https://example.org/t.jpg' }));
    recordOpened({ url: entry(1).url });
    const data = readHistory();
    for (const e of [data.recent[0], data.bookmarks[0]]) {
      expect(e.kind).toBe('collection');
      expect(e.label).toBe('Item 1');
      expect(e.thumbnail).toBe('https://example.org/t.jpg');
    }
    // a bookmark made from an item opened earlier takes what the recent entry knew
    removeBookmark(entry(1).url);
    addBookmark({ url: entry(1).url });
    expect(readHistory().bookmarks[0].kind).toBe('collection');
  });

  it('reads once, writes once and fires one event when a bookmarked item is opened', () => {
    addBookmark(entry(1));
    const onChange = vi.fn();
    subscribeHistory(onChange);
    const setItem = vi.spyOn(localStorage, 'setItem');
    recordOpened(entry(1, { thumbnail: 'https://example.org/t.jpg' }));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a language map label', () => {
    addBookmark({ url: entry(1).url, label: { ja: ['日本語'], en: ['English'] }, kind: 'collection' });
    const [b] = readHistory().bookmarks;
    expect(labelText(b.label, 'ja')).toBe('日本語');
    expect(b.kind).toBe('collection');
  });
});

describe('storage that is missing, full or holds junk', () => {
  it('reads empty lists from junk', () => {
    for (const junk of ['not json', 'null', '"text"', '[]', '{"recent":5,"bookmarks":"x"}']) {
      store.set(HISTORY_KEY, junk);
      expect(readHistory()).toEqual({ recent: [], bookmarks: [] });
    }
  });

  it('drops bad entries but keeps good ones', () => {
    store.set(
      HISTORY_KEY,
      JSON.stringify({
        recent: [
          null,
          7,
          { url: 'blob:x', label: 'a' },
          { url: 'javascript:alert(1)' },
          { url: 'https://example.org/ok.json', label: 'OK', kind: 'weird', at: 'late', thumbnail: 'javascript:x' },
          { url: 'https://example.org/ok.json', label: 'duplicate' },
        ],
        bookmarks: [],
      }),
    );
    const { recent } = readHistory();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toEqual({ url: 'https://example.org/ok.json', label: 'OK', kind: 'manifest', at: 0 });
  });

  it('does not throw when reading is blocked', () => {
    throwOnGet = true;
    expect(readHistory()).toEqual({ recent: [], bookmarks: [] });
    expect(() => recordOpened(entry(1))).not.toThrow();
  });

  it('does not throw when writing fails (storage full), and sends no change event', () => {
    throwOnSet = true;
    const onChange = vi.fn();
    subscribeHistory(onChange);
    expect(() => recordOpened(entry(1))).not.toThrow();
    expect(() => addBookmark(entry(1))).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not throw when localStorage does not exist at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readHistory()).toEqual({ recent: [], bookmarks: [] });
    expect(() => recordOpened(entry(1))).not.toThrow();
  });
});

describe('change events', () => {
  it('tells subscribers after a write, and stops after unsubscribing', () => {
    const onChange = vi.fn();
    const off = subscribeHistory(onChange);
    recordOpened(entry(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
    recordOpened(entry(2));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(events.dispatchEvent(new Event(HISTORY_EVENT))).toBe(true);
  });
});

describe('isViewerPath', () => {
  it('is true only for the viewer page, with or without the trailing slash', () => {
    expect(isViewerPath('/en/viewer')).toBe(true);
    expect(isViewerPath('/ja/viewer/')).toBe(true);
    expect(isViewerPath('/en/compare')).toBe(false);
    expect(isViewerPath('/en/viewer/extra')).toBe(false);
    expect(isViewerPath(null)).toBe(false);
  });
});

describe('labelText and hostOf', () => {
  it('picks the reader language, then English, then the rest', () => {
    const map = { fr: ['Français'], en: ['English'] };
    expect(labelText(map, 'ja')).toBe('English');
    // the same rule as the viewer package: the language, then "none", then English
    expect(labelText({ en: ['English'], none: ['Plain'] }, 'ja')).toBe('Plain');
    expect(labelText({ none: ['Plain'] }, 'ja')).toBe('Plain');
    expect(labelText({ fr: ['Français'] }, 'ja')).toBe('Français');
    expect(labelText('Already text', 'ja')).toBe('Already text');
    expect(labelText({}, 'ja')).toBe('');
  });

  it('names the host, and is empty for a non-URL', () => {
    expect(hostOf('https://example.org/a/b.json')).toBe('example.org');
    expect(hostOf('nonsense')).toBe('');
  });
});
