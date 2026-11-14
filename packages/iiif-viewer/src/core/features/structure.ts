// structure: reading how a multi-page item is shown (paging, start position, table of contents, content state).
// No dependency on React. Only the owner of this feature writes this file.

import type { ContainerInfo } from '../services/containers';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => asList(v).filter((x): x is string => typeof x === 'string');

// ---------------------------------------------------------------------------
// Fragments (#xywh=... and #t=...)
// ---------------------------------------------------------------------------

/** A region of a Canvas [x, y, width, height] (Canvas coordinates). */
export type Xywh = [number, number, number, number];
/** A time range [start, end] in seconds. `end` is undefined when there is none. */
export type TocTimeRange = [number, number | undefined];

export interface Fragment {
  xywh?: Xywh;
  t?: TocTimeRange;
}

const nums = (s: string): number[] => s.split(',').map((x) => Number(x.trim()));

/** Reads a fragment such as `xywh=1,2,3,4&t=10,20` (the part after #). */
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

const MEDIA_KEY = /^(?:xywh|t)=/;

/**
 * Splits `https://.../canvas/1#t=0,30` into the id and the fragment. The split is at the last `#` that starts a
 * media fragment key (`xywh=`, `t=`), even when the values do not parse; a `#` that starts anything else belongs to
 * the id (ids such as `.../manifest#p1` exist).
 */
export function splitId(id: string): { id: string; fragment: Fragment } {
  for (let i = id.lastIndexOf('#'); i >= 0; i = i === 0 ? -1 : id.lastIndexOf('#', i - 1)) {
    if (MEDIA_KEY.test(id.slice(i + 1))) return { id: id.slice(0, i), fragment: parseFragment(id.slice(i + 1)) };
  }
  return { id, fragment: {} };
}

// ---------------------------------------------------------------------------
// How it is shown (behavior and viewingDirection)
// ---------------------------------------------------------------------------

export type ViewingDirection = 'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top';
export type ViewingMode = 'individuals' | 'paged' | 'continuous' | 'unordered';

export interface ViewingInfo {
  direction: ViewingDirection;
  mode: ViewingMode;
  behavior: string[];
}

const DIRECTIONS: readonly string[] = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'];

/** Decides how the pages are arranged, from the manifest's behavior and viewingDirection. */
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
  /** The "previous" arrow */
  prev: string;
  /** The "next" arrow */
  next: string;
  /** Whether "next" goes first (on the left) in a row of buttons. True for right-to-left and bottom-to-top */
  nextFirst: boolean;
  /** Whether the reading direction is vertical */
  vertical: boolean;
}

/** The previous/next arrows and the arrangement for a reading direction. */
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

/** The behavior of each Canvas (looked up by Canvas id). */
export function canvasBehaviorsOf(manifest: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const items = isObject(manifest) ? asList(manifest.items) : [];
  for (const c of items) {
    if (isObject(c) && typeof c.id === 'string') out.set(c.id, strings(c.behavior));
  }
  return out;
}

/**
 * Groups pages into spreads. `order` holds the indexes of the containers in display order.
 * In paged mode the first one stands alone and the rest are paired. Non-paged and facing-pages stand alone.
 * Anything other than paged shows one at a time.
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
// Start position (start)
// ---------------------------------------------------------------------------

export interface CanvasTarget extends Fragment {
  /** The Canvas id without the fragment */
  canvasId: string;
}

// Accepts every way of pointing at a Canvas: start, Range items, content state targets, and so on.
//  - "canvasId#xywh=..." (a string)
//  - { id, type: "Canvas" } (the id may carry a fragment)
//  - { type: "SpecificResource", source: "canvasId" | { id }, selector: PointSelector | FragmentSelector }
function canvasTargetOf(value: unknown): CanvasTarget | null {
  if (typeof value === 'string') {
    const { id, fragment } = splitId(value);
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
  const { id: canvasId, fragment } = splitId(id);
  return { canvasId, ...fragment };
}

export interface StartInfo extends CanvasTarget {
  /** The index in containers. -1 when not found */
  index: number;
}

const indexOfCanvas = (containers: ContainerInfo[], canvasId: string): number =>
  containers.findIndex((c) => c.id === canvasId);

/** The manifest's start (the first Canvas). Null when there is none or the Canvas is not found. */
export function startOf(manifest: unknown, containers: ContainerInfo[]): StartInfo | null {
  const start = isObject(manifest) ? manifest.start : undefined;
  const target = canvasTargetOf(start);
  if (!target) return null;
  const index = indexOfCanvas(containers, target.canvasId);
  return index < 0 ? null : { ...target, index };
}

/**
 * Decides the Canvas to open first from the `canvas` URL argument.
 * The value is a 1-based frame number (`canvas=6`) or a Canvas URI (a fragment such as `#xywh=` is allowed).
 * Null when nothing matches.
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
// Table of contents (Ranges in structures) and the alternative page order
// ---------------------------------------------------------------------------

export interface TocNode {
  id: string;
  label: unknown;
  behavior: string[];
  /** no-nav: not shown in navigation (its children are moved up) */
  noNav: boolean;
  /** The first Canvas this Range points at (with fragment). Null if none */
  target: CanvasTarget | null;
  /** The Canvases this Range points at directly (with fragment) */
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
  // A Range that only refers to another (it has no items) is replaced by the body found elsewhere
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

/** The tree of Ranges in structures. Does not include sequences (alternative page orders). */
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

/** The items shown in the table of contents (no-nav removed, their children moved up). */
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
 * Whether a table of contents item is "where the reader is now": the Canvas is the same and, if the item has a time range, the playback position is in it.
 * An item that does not point at a Canvas itself (a group of chapters) is active when any of its children is.
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

/** Whether anything is shown in the table of contents. */
export function hasToc(manifest: unknown): boolean {
  return navigableTree(rangesOf(manifest)).length > 0;
}

/** behavior: a Range of sequence (an alternative page order). */
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
 * The indexes of the containers in display order. With a sequence, they follow it
 * (Canvases not in the sequence are added at the end in their original order).
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
// Targets of a content state (iiif-content)
// ---------------------------------------------------------------------------

export interface ContentStateTargets {
  /** The manifest URL (from the target's source, partOf or Manifest). Null if none */
  manifestUrl: string | null;
  /** The Canvases pointed at (with region and time). Empty if none */
  targets: Array<CanvasTarget & { manifestUrl?: string }>;
}

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** Turns a content state value (base64url, URL-encoded JSON, or JSON) back into JSON. */
function decodeJson(value: string): unknown {
  const v = value.trim();
  let text = v;
  if (!(v.startsWith('{') || v.startsWith('['))) {
    text = v.startsWith('%7B') || v.startsWith('%7b') ? v : fromBase64Url(v);
  }
  // The Cookbook base64-encodes encodeURIComponent'ed JSON (as the spec says)
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
 * Reads the manifest and the Canvas, region and time pointed at from an `iiif-content` value.
 * decodeContentState returns only the URL; this one also returns the Canvas.
 * When the value is a URL, it becomes manifestUrl and targets is empty. Null when it cannot be read.
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

/** Reads from a content state (JSON) already loaded: an Annotation (motivation: contentState), or a Canvas or Manifest itself. */
export function contentStateOf(json: unknown): ContentStateTargets | null {
  if (!isObject(json)) return null;
  const out: ContentStateTargets = { manifestUrl: null, targets: [] };
  if (json.type === 'Annotation') targetsOf(json.target, out);
  else targetsOf(json, out);
  return out.manifestUrl || out.targets.length > 0 ? out : null;
}

/** Reads a content state from dropped text (a URL, a URL with `?iiif-content=`, or JSON). */
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
 * Finds every Canvas in containers that a content state target points at (in target order).
 * 0540: when one content state points at several Canvases, all of them.
 * The same Canvas with the same region and time is listed once. Empty when none is found.
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

/** The first Canvas in containers that a content state target points at. Null when none is found. */
export function matchTarget(
  targets: ContentStateTargets['targets'],
  containers: ContainerInfo[],
): (CanvasTarget & { index: number }) | null {
  return matchTargets(targets, containers)[0] ?? null;
}

/**
 * 0540: of the Canvases that the opened manifest does not have, groups those said to be in another manifest (partOf)
 * by manifest (in target order). Empty for the content state of a single manifest.
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
  /** The URL of this manifest. May be omitted for the opened manifest (the first element) */
  manifestUrl?: string;
  /** The manifest's name used in headings */
  label: string;
  containers: ContainerInfo[];
}

export interface CompareItem {
  container: ContainerInfo;
  /** Which manifest the Canvas belongs to */
  manifestLabel: string;
  sourceIndex: number;
}

/**
 * 0540: decides the Canvases to show side by side, in target order.
 * sources[0] is the opened manifest. A Canvas id found there is used; otherwise the other source whose manifestUrl matches the target is searched. The same Canvas is listed once.
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

/** The indexes of the Canvases to show side by side (no duplicates). Empty for fewer than two (nothing to compare). */
export function compareIndexesOf(matched: Array<{ index: number }>): number[] {
  const idx = [...new Set(matched.map((m) => m.index))];
  return idx.length >= 2 ? idx : [];
}

// ---------------------------------------------------------------------------
// Collection items
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  id: string;
  type: 'Manifest' | 'Collection';
  label: unknown;
  thumbnail?: string;
  /** The navDate written on the item (Cookbook 0230). The Manifest itself is not fetched. */
  navDate?: string;
}

/** The items of a Collection (JSON before loading). Only Manifests and nested Collections are picked up. */
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
// Thumbnails
// ---------------------------------------------------------------------------

/** From the body of an image (the first option of a Choice), makes the URL of a small image. Shrunk through the Image API when there is one. */
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
 * From the Manifest (or Collection) itself, chooses the URL of a small image for a list card.
 * Used when a Collection item has no thumbnail (Cookbook 0230 and others): the Manifest is fetched.
 * In order: the body's thumbnail, the first Canvas's thumbnail, the first Canvas's image (shrunk when it is an Image API one).
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
 * The URL of a small image for paging. Uses the Canvas's thumbnail when there is one.
 * Otherwise turns an IIIF Image API image URL (…/full/<size>/0/default.jpg) into a small size.
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
