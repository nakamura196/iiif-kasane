// chronology: sorts the items of a Collection by navDate (Cookbook 0230) and groups them by year.
// No dependency on React. Only the owner of this feature writes this file.
// navDate is an xsd:dateTime. Date.parse cannot read a BCE date ("-0500-01-01T00:00:00Z") or a year of five or more digits,
// so the sort key is built here from the year at the front.
import type { CollectionEntry } from './structure';
import { uiLanguage } from '../services/contentLanguage';

export interface DatedEntry {
  entry: CollectionEntry;
  /** the original navDate */
  iso: string;
  year: number;
}

export interface ChronologyYear {
  year: number;
  entries: DatedEntry[];
}

export interface Chronology {
  /** Oldest year first. Within a year, the older date and time first; the same date and time keep their original order. */
  years: ChronologyYear[];
  /** Items without a navDate, or with one that cannot be read (in their original order). */
  undated: CollectionEntry[];
}

const DATE_RE = /^\s*([+-]?\d{1,9})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?)?)?/;

/** The year and a number to sort by, from a navDate. null if it cannot be read. */
export function navDateKey(iso: string | undefined): { year: number; key: number } | null {
  if (!iso) return null;
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isFinite(year)) return null;
  const part = (s: string | undefined) => (s ? Number(s) : 0);
  // year x 1e10 plus month, day, hour, minute and second (the order is only needed within one year; the time zone is ignored)
  const rest = ((((part(m[2]) * 100 + part(m[3])) * 100 + part(m[4])) * 100 + part(m[5])) * 100) + part(m[6]);
  return { year, key: year * 1e10 + rest };
}

/** Whether two or more items have a navDate (whether sorting by date means anything). */
export function hasChronology(entries: CollectionEntry[]): boolean {
  let n = 0;
  for (const e of entries) if (navDateKey(e.navDate) && ++n >= 2) return true;
  return false;
}

export function chronologyOf(entries: CollectionEntry[]): Chronology {
  const dated: Array<DatedEntry & { key: number; i: number }> = [];
  const undated: CollectionEntry[] = [];
  entries.forEach((entry, i) => {
    const k = navDateKey(entry.navDate);
    if (k) dated.push({ entry, iso: entry.navDate!, year: k.year, key: k.key, i });
    else undated.push(entry);
  });
  dated.sort((a, b) => a.key - b.key || a.i - b.i);
  const years: ChronologyYear[] = [];
  for (const { entry, iso, year } of dated) {
    const last = years[years.length - 1];
    if (last && last.year === year) last.entries.push({ entry, iso, year });
    else years.push({ year, entries: [{ entry, iso, year }] });
  }
  return { years, undated };
}

/** How a year is shown. A BCE year is "500 BCE" in English (and its Japanese form in Japanese). */
export function yearText(year: number, locale: string): string {
  if (year > 0) return String(year);
  const bce = 1 - year; // astronomical year 0 = 1 BCE
  return uiLanguage(locale).startsWith('ja') ? `紀元前 ${bce}` : `${bce} BCE`;
}

/** How a date is shown. Only the date when the time is midnight. For a value Intl cannot handle (BCE and the like), only the year. */
export function navDateText(iso: string, locale: string): string {
  const k = navDateKey(iso);
  if (!k) return iso;
  if (k.year < 1 || k.year > 9999) return yearText(k.year, locale);
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return yearText(k.year, locale);
  const d = new Date(t);
  // January 1 at 00:00 is often used to mean "the year only" (0230 does too)
  if (d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return yearText(k.year, locale);
  }
  try {
    return new Intl.DateTimeFormat(uiLanguage(locale), { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return iso;
  }
}
