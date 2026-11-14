// structure: 複数ページの資料の見せ方（ページ送り・開始位置・目次・content state）の読み取り。
// React に依存しない。この機能の担当だけがこのファイルを書く。

import type { ContainerInfo } from '../services/containers';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => asList(v).filter((x): x is string => typeof x === 'string');

// ---------------------------------------------------------------------------
// 断片（#xywh=... と #t=...）
// ---------------------------------------------------------------------------

/** Canvas 上の領域 [x, y, width, height]（Canvas 座標）。 */
export type Xywh = [number, number, number, number];
/** 時間の範囲 [開始, 終了]（秒）。終了が無いときは undefined。 */
export type TocTimeRange = [number, number | undefined];

export interface Fragment {
  xywh?: Xywh;
  t?: TocTimeRange;
}

const nums = (s: string): number[] => s.split(',').map((x) => Number(x.trim()));

/** `xywh=1,2,3,4&t=10,20` のような断片（# の後ろ）を読む。 */
export function parseFragment(fragment: string | undefined | null): Fragment {
  const out: Fragment = {};
  if (!fragment) return out;
  for (const part of fragment.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 'xywh') {
      const v = nums(value.replace(/^pixel:/, ''));
      if (v.length === 4 && v.every(Number.isFinite)) out.xywh = v as Xywh;
    } else if (key === 't') {
      const v = nums(value.replace(/^npt:/, ''));
      if (v.length >= 1 && Number.isFinite(v[0])) {
        out.t = [v[0], v.length > 1 && Number.isFinite(v[1]) ? v[1] : undefined];
      }
    }
  }
  return out;
}

/** `https://.../canvas/1#t=0,30` を、id と断片に分ける。 */
export function splitId(id: string): { id: string; fragment: Fragment } {
  const hash = id.indexOf('#');
  if (hash < 0) return { id, fragment: {} };
  return { id: id.slice(0, hash), fragment: parseFragment(id.slice(hash + 1)) };
}

// ---------------------------------------------------------------------------
// 見せ方（behavior・viewingDirection）
// ---------------------------------------------------------------------------

export type ViewingDirection = 'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top';
export type ViewingMode = 'individuals' | 'paged' | 'continuous' | 'unordered';

export interface ViewingInfo {
  direction: ViewingDirection;
  mode: ViewingMode;
  behavior: string[];
}

const DIRECTIONS: readonly string[] = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'];

/** マニフェストの behavior と viewingDirection から、ページの並べ方を決める。 */
export function viewingOf(manifest: unknown): ViewingInfo {
  const m = isObject(manifest) ? manifest : {};
  const behavior = strings(m.behavior);
  const mode: ViewingMode = behavior.includes('paged')
    ? 'paged'
    : behavior.includes('continuous')
      ? 'continuous'
      : behavior.includes('unordered')
        ? 'unordered'
        : 'individuals';
  const dir = str(m.viewingDirection);
  return {
    direction: dir && DIRECTIONS.includes(dir) ? (dir as ViewingDirection) : 'left-to-right',
    mode,
    behavior,
  };
}

export interface StepArrows {
  /** 「前へ」の矢印 */
  prev: string;
  /** 「次へ」の矢印 */
  next: string;
  /** 横に並べたボタンで「次へ」を先（左）に置くか。右から左・下から上で true */
  nextFirst: boolean;
  /** 上下に読む向きか */
  vertical: boolean;
}

/** 読む向きに合わせた、前へ／次へ の矢印と並べ方。 */
export function stepArrows(direction: ViewingDirection): StepArrows {
  switch (direction) {
    case 'right-to-left':
      return { prev: '→', next: '←', nextFirst: true, vertical: false };
    case 'top-to-bottom':
      return { prev: '↑', next: '↓', nextFirst: false, vertical: true };
    case 'bottom-to-top':
      return { prev: '↓', next: '↑', nextFirst: true, vertical: true };
    default:
      return { prev: '←', next: '→', nextFirst: false, vertical: false };
  }
}

/** Canvas ごとの behavior（Canvas の id から引く）。 */
export function canvasBehaviorsOf(manifest: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const items = isObject(manifest) ? asList(manifest.items) : [];
  for (const c of items) {
    if (isObject(c) && typeof c.id === 'string') out.set(c.id, strings(c.behavior));
  }
  return out;
}

/**
 * 見開きの組み分け。order は表示順の container の番号。
 * paged では先頭 1 枚を単独にし、あとは 2 枚ずつ組む。non-paged / facing-pages は単独。
 * paged 以外は 1 枚ずつ。
 */
export function groupSpreads(order: number[], mode: ViewingMode, standalone: (index: number) => boolean): number[][] {
  if (mode !== 'paged') return order.map((i) => [i]);
  const groups: number[][] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  order.forEach((idx, pos) => {
    if (pos === 0 || standalone(idx)) {
      flush();
      groups.push([idx]);
      return;
    }
    cur.push(idx);
    if (cur.length === 2) flush();
  });
  flush();
  return groups;
}

// ---------------------------------------------------------------------------
// 開始位置（start）
// ---------------------------------------------------------------------------

export interface CanvasTarget extends Fragment {
  /** 断片を除いた Canvas の id */
  canvasId: string;
}

// start・Range の項目・content state の target など、Canvas を指す書き方をすべて受ける。
//  - "canvasId#xywh=..." （文字列）
//  - { id, type: "Canvas" } （id に断片が付くこともある）
//  - { type: "SpecificResource", source: "canvasId" | { id }, selector: PointSelector | FragmentSelector }
// A '#' that does not start a media fragment (xywh, t) belongs to the id: Canvas ids such as `.../manifest#p1` exist.
function splitCanvasId(id: string): { id: string; fragment: Fragment } {
  const split = splitId(id);
  return id.includes('#') && Object.keys(split.fragment).length === 0 ? { id, fragment: {} } : split;
}

function canvasTargetOf(value: unknown): CanvasTarget | null {
  if (typeof value === 'string') {
    const { id, fragment } = splitCanvasId(value);
    return id ? { canvasId: id, ...fragment } : null;
  }
  if (!isObject(value)) return null;
  if (value.type === 'SpecificResource' || value.source !== undefined) {
    const source = value.source;
    const inner = Array.isArray(source) ? source[0] : source;
    const base = canvasTargetOf(inner);
    if (!base) return null;
    const out: CanvasTarget = { ...base };
    for (const sel of asList(value.selector)) {
      if (!isObject(sel)) continue;
      if (sel.type === 'FragmentSelector' && typeof sel.value === 'string') {
        Object.assign(out, parseFragment(sel.value));
      } else if (sel.type === 'PointSelector' && typeof sel.t === 'number') {
        out.t = [sel.t, undefined];
      }
    }
    return out;
  }
  const id = str(value.id);
  if (!id) return null;
  if (typeof value.type === 'string' && value.type !== 'Canvas' && value.type !== 'Scene' && value.type !== 'Timeline') {
    return null;
  }
  const { id: canvasId, fragment } = splitCanvasId(id);
  return { canvasId, ...fragment };
}

export interface StartInfo extends CanvasTarget {
  /** containers の中での番号。見つからなければ -1 */
  index: number;
}

const indexOfCanvas = (containers: ContainerInfo[], canvasId: string): number =>
  containers.findIndex((c) => c.id === canvasId);

/** マニフェストの start（開始 Canvas）。指定が無いか、Canvas が見つからなければ null。 */
export function startOf(manifest: unknown, containers: ContainerInfo[]): StartInfo | null {
  const start = isObject(manifest) ? manifest.start : undefined;
  const target = canvasTargetOf(start);
  if (!target) return null;
  const index = indexOfCanvas(containers, target.canvasId);
  return index < 0 ? null : { ...target, index };
}

/**
 * URL の `canvas` 引数で、最初に開く Canvas を決める。
 * 値は 1 から数えたコマの番号（`canvas=6`）か、Canvas の URI（`#xywh=` などの断片つきでもよい）。
 * 当たらなければ null。
 */
export function canvasParamTarget(
  value: string | null | undefined,
  containers: ContainerInfo[],
): (CanvasTarget & { index: number }) | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const index = Number(v) - 1;
    const c = containers[index];
    return c ? { canvasId: c.id, index } : null;
  }
  const { id, fragment } = splitId(v);
  const index = indexOfCanvas(containers, id);
  return index < 0 ? null : { canvasId: id, ...fragment, index };
}

// ---------------------------------------------------------------------------
// 目次（structures の Range）と代替のページ順
// ---------------------------------------------------------------------------

export interface TocNode {
  id: string;
  label: unknown;
  behavior: string[];
  /** no-nav: ナビゲーションには出さない（子は繰り上げて出す） */
  noNav: boolean;
  /** この Range が指す先頭の Canvas（断片つき）。無ければ null */
  target: CanvasTarget | null;
  /** この Range が直接指す Canvas（断片つき） */
  canvases: CanvasTarget[];
  thumbnail?: string;
  children: TocNode[];
}

export interface SequenceInfo {
  id: string;
  label: unknown;
  canvasIds: string[];
}

const firstThumbnail = (v: unknown): string | undefined => {
  for (const t of asList(v)) {
    if (isObject(t) && typeof t.id === 'string') return t.id;
  }
  return undefined;
};

const collectRanges = (list: unknown, into: Map<string, Json>, depth = 0): void => {
  if (depth > 32) return;
  for (const r of asList(list)) {
    if (!isObject(r) || r.type !== 'Range') continue;
    const id = str(r.id);
    if (id && asList(r.items).length > 0 && !into.has(id)) into.set(id, r);
    collectRanges(r.items, into, depth + 1);
  }
};

const rangeTree = (range: Json, known: Map<string, Json>, seen: Set<string>): TocNode | null => {
  const id = str(range.id) ?? '';
  // 参照だけの Range（items が無い）は、ほかの場所にある本体で置き換える
  const body = asList(range.items).length === 0 && id ? (known.get(id) ?? range) : range;
  if (id && seen.has(id)) return null;
  const nextSeen = new Set(seen);
  if (id) nextSeen.add(id);

  const behavior = strings(body.behavior);
  const node: TocNode = {
    id,
    label: body.label ?? range.label,
    behavior,
    noNav: behavior.includes('no-nav'),
    target: null,
    canvases: [],
    children: [],
  };
  const thumb = firstThumbnail(body.thumbnail);
  if (thumb) node.thumbnail = thumb;

  for (const item of asList(body.items)) {
    if (isObject(item) && item.type === 'Range') {
      const child = rangeTree(item, known, nextSeen);
      if (child) node.children.push(child);
      continue;
    }
    const t = canvasTargetOf(item);
    if (t) node.canvases.push(t);
  }

  const start = canvasTargetOf(body.start);
  node.target = start ?? node.canvases[0] ?? node.children.find((c) => c.target)?.target ?? null;
  return node;
};

/** structures の Range の木。sequence（代替のページ順）は含めない。 */
export function rangesOf(manifest: unknown): TocNode[] {
  if (!isObject(manifest)) return [];
  const known = new Map<string, Json>();
  collectRanges(manifest.structures, known);
  const out: TocNode[] = [];
  for (const r of asList(manifest.structures)) {
    if (!isObject(r) || r.type !== 'Range') continue;
    if (strings(r.behavior).includes('sequence')) continue;
    const node = rangeTree(r, known, new Set());
    if (node) out.push(node);
  }
  return out;
}

/** 目次に出す項目（no-nav を除き、その子を繰り上げた木）。 */
export function navigableTree(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = [];
  for (const n of nodes) {
    const children = navigableTree(n.children);
    if (n.noNav) out.push(...children);
    else out.push({ ...n, children });
  }
  return out;
}

/**
 * 目次の項目が「いま見ている所」か。Canvas が同じで、時間の範囲があるときは再生位置も範囲に入ること。
 * 自分で Canvas を指さない項目（章のまとまり）は、子のどれかが当たっていれば当たりとする。
 */
export function isTocNodeActive(node: TocNode, canvasId: string | undefined, time = 0): boolean {
  if (!canvasId) return false;
  const hit = (ref: CanvasTarget): boolean => {
    if (ref.canvasId !== canvasId) return false;
    if (!ref.t) return true;
    const [from, to] = ref.t;
    return time >= from && (to === undefined || time < to);
  };
  if (node.canvases.length > 0) return node.canvases.some(hit);
  if (node.children.length > 0) return node.children.some((c) => isTocNodeActive(c, canvasId, time));
  return node.target ? hit(node.target) : false;
}

/** 目次に何か出るか。 */
export function hasToc(manifest: unknown): boolean {
  return navigableTree(rangesOf(manifest)).length > 0;
}

/** behavior: sequence の Range（代替のページ順）。 */
export function sequencesOf(manifest: unknown): SequenceInfo[] {
  if (!isObject(manifest)) return [];
  const known = new Map<string, Json>();
  collectRanges(manifest.structures, known);
  const out: SequenceInfo[] = [];
  const visit = (list: unknown, depth: number) => {
    if (depth > 32) return;
    for (const r of asList(list)) {
      if (!isObject(r) || r.type !== 'Range') continue;
      if (strings(r.behavior).includes('sequence')) {
        const node = rangeTree(r, known, new Set());
        const canvasIds: string[] = [];
        const walk = (n: TocNode) => {
          n.canvases.forEach((c) => canvasIds.push(c.canvasId));
          n.children.forEach(walk);
        };
        if (node) walk(node);
        out.push({ id: str(r.id) ?? `sequence-${out.length}`, label: r.label, canvasIds });
      } else {
        visit(r.items, depth + 1);
      }
    }
  };
  visit(manifest.structures, 0);
  return out;
}

/**
 * 表示順の container の番号。sequence を渡すと、その順に並べる
 * （sequence に無い Canvas は、元の順で最後に付ける）。
 */
export function orderOf(containers: ContainerInfo[], sequence?: SequenceInfo | null): number[] {
  const natural = containers.map((_, i) => i);
  if (!sequence) return natural;
  const seen = new Set<number>();
  const order: number[] = [];
  for (const id of sequence.canvasIds) {
    const i = indexOfCanvas(containers, id);
    if (i >= 0 && !seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  }
  if (order.length === 0) return natural;
  for (const i of natural) if (!seen.has(i)) order.push(i);
  return order;
}

// ---------------------------------------------------------------------------
// content state（iiif-content）の target
// ---------------------------------------------------------------------------

export interface ContentStateTargets {
  /** マニフェストの URL（target の source・partOf・Manifest から）。無ければ null */
  manifestUrl: string | null;
  /** 指されている Canvas（領域・時間つき）。無ければ空 */
  targets: Array<CanvasTarget & { manifestUrl?: string }>;
}

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** content state の値（base64url・URL エンコードした JSON・JSON）を JSON に戻す。 */
function decodeJson(value: string): unknown {
  const v = value.trim();
  let text = v;
  if (!(v.startsWith('{') || v.startsWith('['))) {
    text = v.startsWith('%7B') || v.startsWith('%7b') ? v : fromBase64Url(v);
  }
  // Cookbook は encodeURIComponent した JSON を base64 にする（仕様どおり）
  if (text.startsWith('%')) text = decodeURIComponent(text);
  return JSON.parse(text);
}

const manifestUrlOfPartOf = (r: Json): string | undefined => {
  for (const p of asList(r.partOf)) {
    if (isObject(p) && p.type === 'Manifest' && typeof p.id === 'string') return p.id;
  }
  return undefined;
};

const targetsOf = (target: unknown, out: ContentStateTargets, inherited?: string): void => {
  if (Array.isArray(target)) {
    for (const t of target) targetsOf(t, out, inherited);
    return;
  }
  if (typeof target === 'string') {
    const t = canvasTargetOf(target);
    if (t) out.targets.push(inherited ? { ...t, manifestUrl: inherited } : t);
    return;
  }
  if (!isObject(target)) return;
  if (target.type === 'Manifest' && typeof target.id === 'string') {
    out.manifestUrl ??= target.id;
    return;
  }
  const source = isObject(target.source) ? target.source : undefined;
  const partOf = manifestUrlOfPartOf(target) ?? (source ? manifestUrlOfPartOf(source) : undefined) ?? inherited;
  if (source?.type === 'Manifest' && typeof source.id === 'string') {
    out.manifestUrl ??= source.id;
    return;
  }
  const t = canvasTargetOf(target);
  if (!t) return;
  if (partOf) out.manifestUrl ??= partOf;
  out.targets.push(partOf ? { ...t, manifestUrl: partOf } : t);
};

/**
 * `iiif-content` の値から、指されているマニフェストと Canvas・領域・時間を取り出す。
 * 今ある decodeContentState は URL だけを返す。こちらは Canvas の指定も返す。
 * 値が URL のときは、その URL を manifestUrl にして targets は空にする。読めなければ null。
 */
export function parseContentState(value: string | null | undefined): ContentStateTargets | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return { manifestUrl: v, targets: [] };
  try {
    return contentStateOf(decodeJson(v));
  } catch {
    return null;
  }
}

/** 読み込み済みの content state（JSON）から取り出す。Annotation（motivation: contentState）か、Canvas・Manifest そのもの。 */
export function contentStateOf(json: unknown): ContentStateTargets | null {
  if (!isObject(json)) return null;
  const out: ContentStateTargets = { manifestUrl: null, targets: [] };
  if (json.type === 'Annotation') targetsOf(json.target, out);
  else targetsOf(json, out);
  return out.manifestUrl || out.targets.length > 0 ? out : null;
}

/** ドロップされた文字列（URL・`?iiif-content=` つきの URL・JSON）から content state を読む。 */
export function parseDroppedText(text: string): ContentStateTargets | null {
  const t = text.trim();
  if (!t) return null;
  const m = /[?&#]iiif-content=([^&#\s]+)/.exec(t);
  if (m) {
    const raw = m[1];
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    return parseContentState(value) ?? parseContentState(raw);
  }
  return parseContentState(t.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? t);
}

/**
 * containers の中から、content state の target に当たる Canvas をすべて探す（target の並び順）。
 * 0540: 1 つの content state が複数の Canvas を指すとき、その全部。
 * 同じ Canvas・同じ領域・同じ時間の重複は 1 つにまとめる。見つからなければ空。
 */
export function matchTargets(
  targets: ContentStateTargets['targets'],
  containers: ContainerInfo[],
): Array<CanvasTarget & { index: number }> {
  const out: Array<CanvasTarget & { index: number }> = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const index = indexOfCanvas(containers, t.canvasId);
    if (index < 0) continue;
    const key = `${index}|${t.xywh?.join(',') ?? ''}|${t.t?.join(',') ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, index });
  }
  return out;
}

/** content state の target に当たる最初の Canvas。見つからなければ null。 */
export function matchTarget(
  targets: ContentStateTargets['targets'],
  containers: ContainerInfo[],
): (CanvasTarget & { index: number }) | null {
  return matchTargets(targets, containers)[0] ?? null;
}

/**
 * 0540: 開いたマニフェストには無い Canvas のうち、別のマニフェスト（partOf）にあると書かれたものを、
 * マニフェストごとにまとめる（target の並び順）。単一のマニフェストの content state では空になる。
 */
export function remoteGroupsOf(
  targets: ContentStateTargets['targets'],
  containers: ContainerInfo[],
): Array<{ manifestUrl: string; targets: CanvasTarget[] }> {
  const groups = new Map<string, CanvasTarget[]>();
  for (const t of targets) {
    if (!t.manifestUrl || indexOfCanvas(containers, t.canvasId) >= 0) continue;
    const list = groups.get(t.manifestUrl) ?? [];
    list.push(t);
    groups.set(t.manifestUrl, list);
  }
  return [...groups].map(([manifestUrl, ts]) => ({ manifestUrl, targets: ts }));
}

export interface CompareSource {
  /** このマニフェストの URL。開いているマニフェスト（最初の要素）は省略してよい */
  manifestUrl?: string;
  /** 見出しに使うマニフェストの名前 */
  label: string;
  containers: ContainerInfo[];
}

export interface CompareItem {
  container: ContainerInfo;
  /** どのマニフェストの Canvas か */
  manifestLabel: string;
  sourceIndex: number;
}

/**
 * 0540: target の並び順に、並べて見せる Canvas を決める。
 * sources[0] は開いているマニフェスト。Canvas の id がそこにあればそれを使い、
 * 無ければ target の manifestUrl が一致する他の source から探す。同じ Canvas の重複は 1 つにする。
 */
export function resolveCompareItems(
  targets: ContentStateTargets['targets'],
  sources: CompareSource[],
): CompareItem[] {
  const out: CompareItem[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    let found: CompareItem | null = null;
    const first = sources[0];
    const i0 = first ? indexOfCanvas(first.containers, t.canvasId) : -1;
    if (first && i0 >= 0) found = { container: first.containers[i0], manifestLabel: first.label, sourceIndex: 0 };
    else {
      for (let s = 1; s < sources.length; s++) {
        if (t.manifestUrl && sources[s].manifestUrl !== t.manifestUrl) continue;
        const i = indexOfCanvas(sources[s].containers, t.canvasId);
        if (i >= 0) {
          found = { container: sources[s].containers[i], manifestLabel: sources[s].label, sourceIndex: s };
          break;
        }
      }
    }
    if (!found) continue;
    const key = `${found.sourceIndex}|${found.container.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(found);
  }
  return out;
}

/** 並べて見せる Canvas の番号（重複なし）。2 つ未満なら空（並べる意味が無い）。 */
export function compareIndexesOf(matched: Array<{ index: number }>): number[] {
  const idx = [...new Set(matched.map((m) => m.index))];
  return idx.length >= 2 ? idx : [];
}

// ---------------------------------------------------------------------------
// Collection の項目
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  id: string;
  type: 'Manifest' | 'Collection';
  label: unknown;
  thumbnail?: string;
  /** 項目に書かれた navDate（Cookbook 0230）。Manifest の中までは見に行かない。 */
  navDate?: string;
}

/** Collection（読み込み前の JSON）の項目。Manifest と入れ子の Collection だけを拾う。 */
export function collectionEntriesOf(raw: unknown): CollectionEntry[] {
  if (!isObject(raw)) return [];
  const out: CollectionEntry[] = [];
  for (const item of asList(raw.items)) {
    if (!isObject(item)) continue;
    const id = str(item.id);
    if (!id || (item.type !== 'Manifest' && item.type !== 'Collection')) continue;
    const entry: CollectionEntry = { id, type: item.type, label: item.label };
    const thumb = firstThumbnail(item.thumbnail);
    if (thumb) entry.thumbnail = thumb;
    const navDate = str(item.navDate);
    if (navDate) entry.navDate = navDate;
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// サムネイル
// ---------------------------------------------------------------------------

/** 画像の本体（Choice なら最初の選択肢）から、小さい画像の URL を作る。Image API があればそれで縮める。 */
const imageBodyThumbnail = (body: unknown, height: number): string | undefined => {
  const b = isObject(body) && body.type === 'Choice' ? asList(body.items)[0] : body;
  if (!isObject(b) || b.type !== 'Image') return undefined;
  for (const s of asList(b.service)) {
    if (!isObject(s)) continue;
    const base = str(s.id) ?? str(s['@id']);
    const kind = str(s.type) ?? str(s['@type']) ?? 'ImageService3';
    if (base && /^ImageService[23]$/.test(kind)) return `${base.replace(/\/$/, '')}/full/,${height}/0/default.jpg`;
  }
  return str(b.id);
};

/**
 * Manifest（または Collection）本体から、一覧のカードに出す小さな画像の URL を選ぶ。
 * Collection の項目にサムネイルが無いとき（Cookbook 0230 など）に、Manifest を取ってきて使う。
 * 順に: 本体の thumbnail → 最初の Canvas の thumbnail → 最初の Canvas の画像（Image API なら縮めて）。
 */
export function manifestThumbnailOf(raw: unknown, height = 192): string | undefined {
  if (!isObject(raw)) return undefined;
  const own = firstThumbnail(raw.thumbnail);
  if (own) return own;
  const canvas = asList(raw.items).find(isObject);
  if (!canvas) return undefined;
  const t = firstThumbnail(canvas.thumbnail);
  if (t) return t;
  for (const page of asList(canvas.items)) {
    if (!isObject(page)) continue;
    for (const anno of asList(page.items)) {
      if (!isObject(anno) || anno.motivation !== 'painting') continue;
      const url = imageBodyThumbnail(anno.body, height);
      if (url) return url;
    }
  }
  return undefined;
}

/**
 * ページ送りの小さな画像の URL。Canvas の thumbnail があればそれを使う。
 * 無ければ、IIIF Image API の画像 URL（…/full/<size>/0/default.jpg）を小さい指定に直す。
 */
export function pageThumbnailUrl(container: ContainerInfo, rawCanvas?: unknown, height = 96): string | undefined {
  if (isObject(rawCanvas)) {
    const t = firstThumbnail(rawCanvas.thumbnail);
    if (t) return t;
  }
  for (const p of container.painting) {
    for (const o of p.options) {
      if (o.kind !== 'Image') continue;
      return o.url.replace(/\/full\/[^/]+\/(\d+)\/(default|native|color)\.(\w+)$/, `/full/,${height}/$1/$2.$3`);
    }
  }
  return undefined;
}
