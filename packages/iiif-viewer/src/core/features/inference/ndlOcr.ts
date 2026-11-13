// NDLOCR-Lite（国立国会図書館。レイアウト検出 DEIM ＋ 文字の読み取り PARSeq 3 本）の、モデルの外の手順。
// 原本 ndl-lab/ndlocr-lite（CC BY 4.0）の src/deim.py・ndl_parser.py（convert_to_xml_string3）・
// reading_order/（xy_cut/eval.py、order/reorder.py・warichu_block.py・smooth_order.py）・parseq.py・ocr.py（process_cascade）
// と同じにした。原本は途中で XML を組み立てて並べ替えるので、ここでも同じ形の木を作って同じ順に並べる。
// 原本の癖（行の候補の取り違えなど）も、結果を一致させるためにそのまま写している。
import { bgrTensor, resizeLinearCv, resizeRgba, rgbTensor, rotateLeft } from './pixels';
import { xyCutRanks } from './readingOrder';

/** Side of the square the layout detector takes (the input of ndlocr-lite-deim-s-layers.onnx is 800 x 800). */
export const NDL_DET_SIZE = 800;
/** Detections at or under this score are dropped (ocr.py --det-conf-threshold). */
export const NDL_DET_CONF = 0.25;
/** The 17 classes of src/config/ndl.yaml (the model's labels are these + 1). */
export const NDL_CLASSES = [
  'text_block',
  'line_main',
  'line_caption',
  'line_ad',
  'line_note',
  'line_note_tochu',
  'block_fig',
  'block_ad',
  'block_pillar',
  'block_folio',
  'block_rubi',
  'block_chart',
  'block_eqn',
  'block_cfm',
  'block_eng',
  'block_table',
  'line_title',
] as const;
const TB = 0;
const LINE_MAIN = 1;
const BLOCK_AD = 7;
const BLOCK_TABLE = 15;

/** The three PARSeq models: how many characters each reads, and its input width (the height is 16). */
export const NDL_REC = [
  { chars: 30, width: 256 },
  { chars: 50, width: 384 },
  { chars: 100, width: 768 },
] as const;
export const NDL_REC_H = 16;

/**
 * Detector input from the RGBA pixels of a square `side` x `side` (the page at the top left, black to the right or
 * below): resized to 800 as PIL does (BICUBIC), RGB, /255, ImageNet mean/std (deim.py).
 */
export const ndlDetTensor = (square: Uint8ClampedArray, side: number): Float32Array => {
  const S = NDL_DET_SIZE;
  const px = side === S ? square : resizeRgba(square, side, side, S, S);
  return rgbTensor(px, S, S, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
};

/**
 * Input for one line (parseq.py of NDLOCR-Lite): turned left when taller than 0.8 of its width, resized with
 * cv2.resize(INTER_LINEAR) to width x 16, BGR, -1..1.
 */
export const ndlParseqTensor = (px: Uint8ClampedArray, w: number, h: number, width: number): Float32Array => {
  let p = px;
  let cw = w;
  let ch = h;
  if (ch > cw * 0.8) {
    p = rotateLeft(p, cw, ch);
    [cw, ch] = [ch, cw];
  }
  p = resizeLinearCv(p, cw, ch, width, NDL_REC_H);
  return bgrTensor(p, width, NDL_REC_H, [127.5, 127.5, 127.5], [127.5, 127.5, 127.5]);
};

/** A line to read, in image pixels (integers), with the detector's estimate of its length (1, 2 or 3; 100 if none). */
export interface NdlLine {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detector confidence (0 for a line made from a text block without lines). */
  score: number;
  /** Class name (line_main, line_title ...). */
  type: string;
  charCount: number;
}

// ---- 検出の出力 → 原本の XML と同じ形の木 -------------------------------------------------------

interface Det {
  cls: number;
  /** x1, y1, x2, y2 as int32, as deim.py's postprocess leaves them */
  b: [number, number, number, number];
  conf: number;
  cnt: number;
}

type Tag = 'PAGE' | 'TEXTBLOCK' | 'BLOCK' | 'LINE' | 'WARICHUBLOCK';
interface El {
  tag: Tag;
  children: El[];
  x: number;
  y: number;
  w: number;
  h: number;
  type?: string;
  /** CONF as written to the XML (3 decimals); undefined when the original writes none */
  conf?: number;
  /** PRED_CHAR_CNT; undefined when the original writes none */
  cnt?: number;
  order?: number;
}

const el = (tag: Tag, x = 0, y = 0, w = 0, h = 0): El => ({ tag, children: [], x, y, w, h });
const conf3 = (v: number) => Number(v.toFixed(3));
const lineOf = (cls: number, d: Det): El => ({
  ...el('LINE', d.b[0], d.b[1], d.b[2] - d.b[0], d.b[3] - d.b[1]),
  type: NDL_CLASSES[cls],
  conf: conf3(d.conf),
  cnt: conf3(d.cnt),
});

/**
 * deim.py postprocess: scores > 0.25, boxes from the 800 square back to the padded square (float32, truncated to
 * int32), clipped to the square. The outputs are sorted by score, so the labels line up with the kept boxes.
 */
const detections = (
  labels: ArrayLike<number>,
  boxes: ArrayLike<number>,
  scores: ArrayLike<number>,
  charCount: ArrayLike<number>,
  side: number,
): Det[] => {
  const k = Math.fround(side / NDL_DET_SIZE);
  const kept: number[] = [];
  for (let i = 0; i < scores.length; i++) if (scores[i] > NDL_DET_CONF) kept.push(i);
  return kept.map((i, n) => {
    const v = (j: number) => Math.min(Math.max(Math.trunc(Math.fround(Math.fround(boxes[i * 4 + j]) * k)), 0), side);
    return { cls: Number(labels[n]) - 1, b: [v(0), v(1), v(2), v(3)], conf: scores[i], cnt: Number(charCount[n]) };
  });
};

/** ndl_parser.point_in_polygon on a rectangle given as its 4 corners (xmin,ymin)(xmin,ymax)(xmax,ymax)(xmax,ymin). */
const pointInPolygon = (px: number, py: number, poly: [number, number][], measureDist: boolean): number => {
  const seg = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
    const L = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (L === 0) return Math.hypot(x - x1, y - y1);
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
  };
  const n = poly.length;
  let inside = false;
  let minDist = Infinity;
  let [qx, qy] = poly[0];
  for (let i = 1; i <= n; i++) {
    const [sx, sy] = poly[i % n];
    if (Math.min(qy, sy) < py && py <= Math.max(qy, sy) && px <= Math.max(qx, sx)) {
      // the condition above already rules out a horizontal edge, so qy !== sy here
      if (qx === sx || px <= ((py - qy) * (sx - qx)) / (sy - qy) + qx) inside = !inside;
    }
    if (measureDist) minDist = Math.min(minDist, seg(px, py, qx, qy, sx, sy));
    [qx, qy] = [sx, sy];
  }
  for (let i = 0; i < n; i++) {
    const [sx, sy] = poly[i];
    const [ex, ey] = poly[(i + 1) % n];
    if ((sy === ey && sy === py && Math.min(sx, ex) <= px && px <= Math.max(sx, ex)) || (sx === ex && sx === px && Math.min(sy, ey) <= py && py <= Math.max(sy, ey)))
      return 0;
  }
  if (measureDist) return inside ? minDist : -minDist;
  return inside ? 1 : -1;
};
const inBox = (box: Det['b'], b: Det['b']) => {
  const cx = Math.floor((b[0] + b[2]) / 2);
  const cy = Math.floor((b[1] + b[3]) / 2);
  return box[0] <= cx && cx <= box[2] && box[1] <= cy && cy <= box[3];
};

/** convert_to_xml_string3 (score_thr 0.1, min_bbox_size 5, use_block_ad): the PAGE with its blocks and lines. */
const buildPage = (dets: Det[], W: number, H: number): El => {
  const byCls: Det[][] = NDL_CLASSES.map(() => []);
  for (const d of dets) byCls[d.cls]?.push(d);
  const page = el('PAGE', 0, 0, W, H);

  // textblock_to_rect（両辺とも 5 未満の塊は外す。外しても番号は詰めるので、後で byCls[TB][i] とずれる。原本どおり）
  const tbRects = byCls[TB].filter((d) => !(d.b[2] - d.b[0] < 5 && d.b[3] - d.b[1] < 5)).map((d) => d.b);
  const poly = (b: Det['b']): [number, number][] => [
    [b[0], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
    [b[2], b[1]],
  ];

  // get_relationship_rect
  let tbInfo: ([number, number][] | null)[] = tbRects.map(() => []);
  const adInfo: [number, number][][] = byCls[BLOCK_AD].map(() => []);
  const tableInfo: [number, number][][] = byCls[BLOCK_TABLE].map(() => []);
  const independ: [number, number][] = [];
  NDL_CLASSES.forEach((name, c) => {
    if (!name.startsWith('line_')) return;
    byCls[c].forEach((line, j) => {
      const cx = Math.floor((line.b[0] + line.b[2]) / 2);
      const cy = Math.floor((line.b[1] + line.b[3]) / 2);
      let i = tbRects.findIndex((r) => pointInPolygon(cx, cy, poly(r), false) >= 0);
      if (i >= 0) return void tbInfo[i]!.push([c, j]);
      i = byCls[BLOCK_AD].findIndex((a) => inBox(a.b, line.b));
      if (i >= 0) return void adInfo[i].push([c, j]);
      i = byCls[BLOCK_TABLE].findIndex((t) => inBox(t.b, line.b));
      if (i >= 0) return void tableInfo[i].push([c, j]);
      independ.push([c, j]);
    });
  });

  // refine_tb_relationship (margin 50)
  tbRects.forEach((child, ci) => {
    if (tbInfo[ci] === null) return;
    for (let pi = 0; pi < tbRects.length; pi++) {
      if (pi === ci || tbInfo[pi] === null) continue;
      const allIn = poly(child).every(([x, y]) => !(pointInPolygon(x, y, poly(tbRects[pi]), true) < -50));
      if (allIn) {
        if (tbInfo[ci]!.length === 0) tbInfo[pi]!.push([TB, ci]);
        else tbInfo[pi]!.push(...tbInfo[ci]!);
        tbInfo[ci] = null;
        break;
      }
    }
  });
  tbInfo = tbInfo.map((info) => (info && info.every(([c]) => c === TB) ? [] : info));

  const rectLine = (type: number, b: Det['b'], src?: Det): El | null => {
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    if (w < 5 || h < 5) return null;
    const l = el('LINE', b[0], b[1], w, h);
    l.type = NDL_CLASSES[type];
    if (src) {
      l.conf = conf3(src.conf);
      l.cnt = conf3(src.cnt);
    }
    return l;
  };
  const linesOf = (info: [number, number][], tbType: number): El[] =>
    info.flatMap(([c, i]) => {
      const l = c === TB ? rectLine(tbType, tbRects[i], byCls[TB][i]) : lineOf(c, byCls[c][i]);
      return l ? [l] : [];
    });

  // 表組の中（BLOCK の中に LINE。塊を通さない）
  byCls[BLOCK_TABLE].forEach((t, i) => {
    const b = el('BLOCK', t.b[0], t.b[1], t.b[2] - t.b[0], t.b[3] - t.b[1]);
    b.children = tableInfo[i].map(([c, j]) => lineOf(c, byCls[c][j]));
    page.children.push(b);
  });
  // 広告の中
  byCls[BLOCK_AD].forEach((a, i) => {
    const b = el('BLOCK', a.b[0], a.b[1], a.b[2] - a.b[0], a.b[3] - a.b[1]);
    b.children = adInfo[i].map(([c, j]) => lineOf(c, byCls[c][j]));
    page.children.push(b);
  });
  // 本文の塊と、その中の行（行の無い塊は、塊そのものを 1 行にする）
  tbInfo.forEach((info, j) => {
    if (info === null) return;
    const tb = el('TEXTBLOCK');
    if (info.length === 0) {
      const l = rectLine(LINE_MAIN, tbRects[j]);
      if (l) tb.children.push(l);
    } else tb.children = linesOf(info, LINE_MAIN);
    page.children.push(tb);
  });
  for (const [c, j] of independ) page.children.push(lineOf(c, byCls[c][j]));
  // ほかの BLOCK（図・柱など）は行を持たないので、並べ替えでは後ろに回るだけ。順を保つために置いておく
  NDL_CLASSES.forEach((name, c) => {
    if (name.startsWith('block_') && c !== BLOCK_TABLE) for (const d of byCls[c]) page.children.push(el('BLOCK', d.b[0], d.b[1]));
  });
  return page;
};

// ---- 読む順（eval_xml） ---------------------------------------------------------------------------

const allLines = (e: El, out: El[] = []): El[] => {
  for (const c of e.children) {
    if (c.tag === 'LINE') out.push(c);
    allLines(c, out);
  }
  return out;
};

const npMedian = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** reorder.remove_dup: of two consecutive lines overlapping by more than 80% of the smaller, keep the more confident. */
const removeDup = (list: El[]): El[] => {
  const out: El[] = [];
  const comp: number[][] = [];
  for (const e of list) {
    if (e.tag !== 'LINE' && e.tag !== 'WARICHUBLOCK') {
      out.push(e);
      continue;
    }
    const cur = [e.x, e.y, e.x + e.w, e.y + e.h, e.conf ?? -1];
    const last = out[out.length - 1];
    let dup = 0;
    if (last && (last.tag === 'LINE' || last.tag === 'WARICHUBLOCK')) {
      const a = comp[comp.length - 1];
      const aArea = (a[2] - a[0]) * (a[3] - a[1]);
      const bArea = (cur[2] - cur[0]) * (cur[3] - cur[1]);
      const inter = Math.max(0, Math.min(a[2], cur[2]) - Math.max(a[0], cur[0])) * Math.max(0, Math.min(a[3], cur[3]) - Math.max(a[1], cur[1]));
      const min = Math.min(aArea, bArea);
      if (min > 0 && inter / min > 0.8) dup = a[4] >= cur[4] ? 1 : 2;
    }
    if (dup === 1) continue;
    if (dup === 2) {
      out.pop();
      comp.pop();
    }
    out.push(e);
    comp.push(cur);
  }
  return out;
};

/** reorder.sort_lines_local: sort the LINE / WARICHUBLOCK children by position. Returns the median ORDER, or -1. */
const sortLocal = (root: El): number => {
  const lines: [number, number, number, El][] = [];
  const others: El[] = [];
  const ws: number[] = [];
  const hs: number[] = [];
  let nv = 0;
  for (const e of root.children) {
    if (e.tag === 'LINE' || e.tag === 'WARICHUBLOCK') {
      nv += e.w < e.h ? 1 : 0;
      ws.push(e.w);
      hs.push(e.h);
      lines.push([e.x + e.w / 2, e.y + e.h / 2, e.order ?? NaN, e]);
    } else others.push(e);
  }
  if (!ws.length) return -1;
  const vertical = lines.length < nv * 2;
  const margin = npMedian(vertical ? ws : hs) * 0.3;
  // 原本と同じく推移的でない比べ方。Python の sorted と V8 の sort はどちらも TimSort なので、同じ順になる
  lines.sort(([x0, y0], [x1, y1]) =>
    vertical ? (margin < x1 - x0 ? 1 : margin < x0 - x1 ? -1 : y0 - y1) : margin < y0 - y1 ? 1 : margin < y1 - y0 ? -1 : x0 - x1,
  );
  const valid = lines.map(([, , o]) => o).filter((o) => !Number.isNaN(o)).sort((a, b) => a - b);
  root.children = [...removeDup(lines.map(([, , , e]) => e)), ...others];
  return valid.length ? valid[valid.length >> 1] : NaN;
};

/** warichu_block.group_warichu: gather 割注 lines that touch (each box widened by 10% across) into WARICHUBLOCKs. */
const groupWarichu = (page: El) => {
  const parentOf = new Map<El, El>();
  const walk = (e: El) => e.children.forEach((c) => (parentOf.set(c, e), walk(c)));
  walk(page);
  const ws = allLines(page)
    .filter((l) => l.type === 'line_note')
    .map((l) => {
      const v = l.w < l.h;
      const s = (v ? l.w : l.h) * 0.1;
      const box = v ? [l.x - s / 2, l.y, l.x + l.w + s / 2, l.y + l.h] : [l.x, l.y - s / 2, l.x + l.w, l.y + l.h + s / 2];
      return { l, box, parent: parentOf.get(l)! };
    });
  const i1d = (x0: number, x1: number, y0: number, y1: number) =>
    y1 < x0 ? 0 : y0 < x0 ? y1 - x0 : y1 < x1 ? y1 - y0 : y0 < x1 ? x1 - y0 : 0;
  const grouped = new Set<El>();
  const groups: (typeof ws)[] = [];
  for (const w0 of ws) {
    if (grouped.has(w0.l)) continue;
    const g = [w0];
    grouped.add(w0.l);
    for (const w1 of ws) {
      if (grouped.has(w1.l)) continue;
      if (i1d(w0.box[0], w0.box[2], w1.box[0], w1.box[2]) * i1d(w0.box[1], w0.box[3], w1.box[1], w1.box[3]) > 0) {
        g.push(w1);
        grouped.add(w1.l);
      }
    }
    groups.push(g);
  }
  for (const g of groups) {
    const x0 = Math.min(...g.map((w) => w.l.x));
    const y0 = Math.min(...g.map((w) => w.l.y));
    const x1 = Math.max(...g.map((w) => w.l.x + w.l.w));
    const y1 = Math.max(...g.map((w) => w.l.y + w.l.h));
    const block = el('WARICHUBLOCK', x0, y0, x1 - x0, y1 - y0);
    block.order = npMedian(g.map((w) => w.l.order!));
    block.children = g.map((w) => w.l);
    const anchor = g.find((w) => w.parent.tag === 'TEXTBLOCK') ?? g[0];
    anchor.parent.children.splice(anchor.parent.children.indexOf(anchor.l), 0, block);
    for (const w of g) w.parent.children.splice(w.parent.children.indexOf(w.l), 1);
  }
};

const ungroupWarichu = (e: El) => {
  e.children = e.children.flatMap((c) => (ungroupWarichu(c), c.tag === 'WARICHUBLOCK' ? c.children : [c]));
};

/** reorder.sort_lines: blocks by the median order of their lines, lines in a block by position, then remove_dup. */
const sortLines = (e: El) => {
  const toSort: [number, El][] = [];
  const unsorted: El[] = [];
  for (const c of e.children) {
    if (c.tag === 'TEXTBLOCK') {
      for (const w of c.children) if (w.tag === 'WARICHUBLOCK') sortLocal(w);
      toSort.push([sortLocal(c), c]);
    } else if (c.tag === 'LINE') toSort.push([c.order ?? NaN, c]);
    else if (c.tag === 'WARICHUBLOCK') toSort.push([sortLocal(c), c]);
    else {
      if (c.tag === 'BLOCK' || c.tag === 'PAGE') sortLines(c);
      unsorted.push(c);
    }
  }
  toSort.sort((a, b) => a[0] - b[0]);
  e.children = [...removeDup(toSort.map(([, c]) => c)), ...unsorted];
};

/**
 * smooth_order: among the blocks and lines of a level, find the order (first and last fixed, each step at most 2 places
 * away, 1 when there are 20 or more) that minimises the jumps on the page plus the changes in ORDER.
 */
const smoothOrder = (page: El) => {
  const diam = Math.sqrt(page.w * page.w + page.h * page.h);
  const walk = (e: El) => {
    const items: { order: number; beg: [number, number]; end: [number, number]; e: El }[] = [];
    const unsorted: El[] = [];
    for (const c of e.children) {
      if (c.tag === 'TEXTBLOCK') {
        const ls = c.children.filter((l) => l.tag === 'LINE');
        if (!ls.length) continue; // 原本では、行の無い塊はここで落ちる
        // 原本は先頭の行の位置を取るつもりで、最後の行の位置を取っている（is_first が戻らない）
        const last = ls[ls.length - 1];
        items.push({ order: ls[ls.length >> 1].order ?? NaN, beg: [last.x + last.w / 2, last.y], end: [last.x + last.w / 2, last.y + last.h], e: c });
      } else if (c.tag === 'LINE') items.push({ order: c.order ?? NaN, beg: [c.x + c.w / 2, c.y], end: [c.x + c.w / 2, c.y + c.h], e: c });
      else {
        if (c.tag === 'BLOCK') walk(c);
        unsorted.push(c);
      }
    }
    const n = items.length;
    if (n < 2) {
      // 1 つなら道は無く、並べ替えない（原本も同じ）。落とした塊も、ここでは残す
      return;
    }
    const orders = items.map((t) => t.order);
    const range = Math.max(...orders) - Math.min(...orders);
    const weight = (i: number, j: number) =>
      Math.sqrt((items[j].beg[0] - items[i].end[0]) ** 2 + (items[j].beg[1] - items[i].end[1]) ** 2) / diam + Math.abs(items[i].order - items[j].order) / range;
    const maxStep = n < 20 ? 3 : 2;
    // networkx の隣の並び（辺を足した順）: i-1, i+1, i-2, i+2
    const adj = items.map((_, i) => {
      const a: number[] = [];
      for (let s = 1; s < maxStep; s++) {
        if (i - s >= 0) a.push(i - s);
        if (i + s < n) a.push(i + s);
      }
      return a;
    });
    let best: number[] | null = null;
    let bestW = 99999;
    const path = [0];
    const seen = new Set([0]);
    const dfs = (u: number) => {
      for (const v of adj[u]) {
        if (seen.has(v)) continue;
        path.push(v);
        if (v === n - 1) {
          if (path.length === n) {
            let w = 0;
            for (let k = 0; k + 1 < n; k++) w += weight(path[k], path[k + 1]);
            if (w < bestW) [bestW, best] = [w, [...path]];
          }
        } else {
          seen.add(v);
          dfs(v);
          seen.delete(v);
        }
        path.pop();
      }
    };
    dfs(0);
    if (best) e.children = [...(best as number[]).map((i) => items[i].e), ...unsorted];
  };
  walk(page);
};

/**
 * The lines to read, in reading order, from the detector output (labels 1-based, boxes x1,y1,x2,y2 on the 800 square,
 * scores sorted, char_count), for a W x H image. As ocr.py: the XML of convert_to_xml_string3, eval_xml (block XY-cut,
 * sort_lines with 割注 grouping, smoothing), then every LINE in document order. With no LINE at all, every detection
 * becomes a line, in detection order.
 */
/**
 * The detector's other regions (text blocks, figures, tables, folios ...: every class not a line), in image pixels,
 * clipped to the image. The lines are read and returned by ndlOcrLines; these are kept as found, nothing dropped
 * beyond the detector's own threshold (NDL_DET_CONF, as deim.py).
 */
export const ndlOcrRegions = (
  labels: ArrayLike<number>,
  boxes: ArrayLike<number>,
  scores: ArrayLike<number>,
  charCount: ArrayLike<number>,
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number; score: number; label: string }[] =>
  detections(labels, boxes, scores, charCount, Math.max(W, H))
    .filter((d) => NDL_CLASSES[d.cls] && !NDL_CLASSES[d.cls].startsWith('line_'))
    .map((d) => {
      const x1 = Math.min(d.b[0], W);
      const y1 = Math.min(d.b[1], H);
      const x2 = Math.min(d.b[2], W);
      const y2 = Math.min(d.b[3], H);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, score: d.conf, label: NDL_CLASSES[d.cls] };
    })
    .filter((r) => r.w > 0 && r.h > 0);

export const ndlOcrLines = (
  labels: ArrayLike<number>,
  boxes: ArrayLike<number>,
  scores: ArrayLike<number>,
  charCount: ArrayLike<number>,
  W: number,
  H: number,
): NdlLine[] => {
  const dets = detections(labels, boxes, scores, charCount, Math.max(W, H));
  const page = buildPage(dets, W, H);
  const lines = allLines(page);
  if (lines.length) {
    const ranks = xyCutRanks(lines.map((l) => [l.x, l.y, l.x + l.w, l.y + l.h]));
    lines.forEach((l, i) => (l.order = ranks[i]));
    groupWarichu(page);
    sortLines(page);
    ungroupWarichu(page);
    smoothOrder(page);
  }
  const out = allLines(page).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, score: l.conf ?? 0, type: l.type!, charCount: l.cnt ?? 100 }));
  if (out.length || !dets.length) return out;
  return dets
    .filter((d) => d.b[2] - d.b[0] > 0 && d.b[3] - d.b[1] > 0)
    .map((d) => ({ x: d.b[0], y: d.b[1], w: d.b[2] - d.b[0], h: d.b[3] - d.b[1], score: d.conf, type: 'line_main', charCount: d.cnt }));
};

/** Which PARSeq to start with (process_cascade): an estimate of 3 → 30 characters, 2 → 50, otherwise 100. */
export const ndlFirstRecognizer = (charCount: number): 0 | 1 | 2 => (charCount === 3 ? 0 : charCount === 2 ? 1 : 2);
/** Read again with the next PARSeq when this many characters came out (25 of 30, 45 of 50). */
export const NDL_REC_RETRY = [25, 45] as const;
/** A horizontal line that fills the 100-character model (98 or more) is read again as two halves. */
export const NDL_REC_SPLIT = 98;
