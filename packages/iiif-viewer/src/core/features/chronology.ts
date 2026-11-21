// chronology: Collection の項目を navDate（Cookbook 0230）で年代順に並べ、年ごとにまとめる。
// React に依存しない。この機能の担当だけがこのファイルを書く。
// navDate は xsd:dateTime。紀元前（"-0500-01-01T00:00:00Z"）や 5 桁以上の年は Date.parse が
// 読めないので、並べる鍵は先頭の年から自分で作る。
import type { CollectionEntry } from './structure';
import { uiLanguage } from '../services/contentLanguage';

export interface DatedEntry {
  entry: CollectionEntry;
  /** 元の navDate */
  iso: string;
  year: number;
}

export interface ChronologyYear {
  year: number;
  entries: DatedEntry[];
}

export interface Chronology {
  /** 年の古い順。同じ年の中は日時の古い順、同じ日時は元の順。 */
  years: ChronologyYear[];
  /** navDate が無いか読めない項目（元の順）。 */
  undated: CollectionEntry[];
}

const DATE_RE = /^\s*([+-]?\d{1,9})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?)?)?/;

/** navDate から年と、並べるための数値を取る。読めなければ null。 */
export function navDateKey(iso: string | undefined): { year: number; key: number } | null {
  if (!iso) return null;
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isFinite(year)) return null;
  const part = (s: string | undefined) => (s ? Number(s) : 0);
  // 年 × 1e10 に月日時分秒を足す（同じ年の中だけで順序が要る。タイムゾーンは無視）
  const rest = ((((part(m[2]) * 100 + part(m[3])) * 100 + part(m[4])) * 100 + part(m[5])) * 100) + part(m[6]);
  return { year, key: year * 1e10 + rest };
}

/** navDate を持つ項目が 2 件以上あるか（年代順に並べる意味があるか）。 */
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

/** 年の表示。紀元前は「前 500」/「500 BCE」。 */
export function yearText(year: number, locale: string): string {
  if (year > 0) return String(year);
  const bce = 1 - year; // 天文年 0 = 紀元前 1 年
  return uiLanguage(locale).startsWith('ja') ? `紀元前 ${bce}` : `${bce} BCE`;
}

/** 日付の表示。時刻が 0 時なら日付だけ。紀元前など Intl が扱えない値は年だけ。 */
export function navDateText(iso: string, locale: string): string {
  const k = navDateKey(iso);
  if (!k) return iso;
  if (k.year < 1 || k.year > 9999) return yearText(k.year, locale);
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return yearText(k.year, locale);
  const d = new Date(t);
  // 1 月 1 日 0 時は「年だけ」の意味で使われることが多い（0230 もそう）
  if (d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return yearText(k.year, locale);
  }
  try {
    return new Intl.DateTimeFormat(uiLanguage(locale), { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return iso;
  }
}
