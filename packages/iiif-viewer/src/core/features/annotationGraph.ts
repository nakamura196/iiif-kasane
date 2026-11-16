// annotationGraph: how an annotation connects to its region resource (Shared Region extension), to the other
// annotations on that region, and to the resources it links to (Wikidata, Wikipedia, references, pictures).
// React-free. The 2D and the 3D annotation lists build the graph from their own annotations and show it with one component.
//
// The whole graph is never drawn at once: `visibleSubgraph` gives the start (a root and what touches it) and
// whatever the reader has expanded, and `layoutGraph` places those nodes on rings around the root.

import { localizedString } from './annotationBody';
import type { AnnotationResource } from './annotationResources';
import { wikidataIdOf } from './wikidataLabel';

export type GraphNodeKind = 'annotation' | 'region' | 'resource' | 'object';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** The full text of the node (the view shortens it). */
  label: string;
  /** annotation: the same number as in the list. */
  number?: number;
  /** annotation: the id given to the graph (to select it). */
  annotationId?: string;
  /** resource: what it is, and the page to open. */
  resourceKind?: AnnotationResource['kind'];
  url?: string;
}

export interface GraphEdge {
  a: string;
  b: string;
}

export interface AnnotationGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** node id → ids of the nodes it touches (in the order the edges were added). */
  adjacency: Map<string, string[]>;
}

export interface GraphItem {
  id: string;
  label?: string;
  number?: number;
  regionId?: string;
  resources?: AnnotationResource[];
}

export interface GraphObject {
  id: string;
  label?: string;
}

export const annotationNodeId = (id: string) => `a:${id}`;
export const regionNodeId = (regionId: string) => `r:${regionId}`;
export const OBJECT_NODE_ID = 'o:object';

const resourceLabel = (r: AnnotationResource, locale: string): string => {
  const text = localizedString(r.label, locale).trim();
  if (text) return text;
  const q = wikidataIdOf(r.url);
  if (q) return q;
  if (r.url) {
    try {
      return new URL(r.url).hostname;
    } catch {
      return r.url;
    }
  }
  return r.kind;
};

// The same address is one node; a reference without an address is one node per kind and text.
const resourceKey = (r: AnnotationResource, label: string): string => (r.url ? `x:${r.url}` : `x:${r.kind}|${label}`);

export const buildAnnotationGraph = (
  items: GraphItem[],
  object?: GraphObject,
  locale = 'en',
): AnnotationGraph => {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const adjacency = new Map<string, string[]>();
  const seenEdges = new Set<string>();
  const link = (a: string, b: string) => {
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    if (a === b || seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ a, b });
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  };
  if (object) nodes.set(OBJECT_NODE_ID, { id: OBJECT_NODE_ID, kind: 'object', label: object.label || object.id });
  for (const item of items) {
    const aid = annotationNodeId(item.id);
    nodes.set(aid, {
      id: aid,
      kind: 'annotation',
      label: item.label || (item.number !== undefined ? `#${item.number}` : item.id),
      annotationId: item.id,
      ...(item.number !== undefined ? { number: item.number } : {}),
    });
    if (item.regionId) {
      const rid = regionNodeId(item.regionId);
      if (!nodes.has(rid)) nodes.set(rid, { id: rid, kind: 'region', label: item.regionId });
      link(aid, rid);
      if (object) link(rid, OBJECT_NODE_ID);
    } else if (object) {
      link(aid, OBJECT_NODE_ID);
    }
    for (const r of item.resources ?? []) {
      const label = resourceLabel(r, locale);
      const xid = resourceKey(r, label);
      if (!nodes.has(xid)) {
        nodes.set(xid, {
          id: xid,
          kind: 'resource',
          label,
          resourceKind: r.kind,
          ...(r.url ? { url: r.url } : {}),
        });
      }
      link(aid, xid);
    }
  }
  return { nodes, edges, adjacency };
};

/** Whether an annotation has something to show besides the whole item: a region or a resource. */
export const hasConnections = (item: GraphItem): boolean => !!item.regionId || (item.resources?.length ?? 0) > 0;

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The root and its neighbours, plus the neighbours of each expanded node that is itself visible.
 * Nodes and the edges among them, in a stable order (the root first, then the order they were reached).
 */
export const visibleSubgraph = (graph: AnnotationGraph, rootId: string, expanded: ReadonlySet<string>): VisibleGraph => {
  if (!graph.nodes.has(rootId)) return { nodes: [], edges: [] };
  const visible: string[] = [rootId];
  const seen = new Set(visible);
  const reveal = (id: string) => {
    for (const n of graph.adjacency.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        visible.push(n);
      }
    }
  };
  reveal(rootId);
  // Expanding reveals the node's neighbours only when the node is shown. Repeat while a revealed node is expanded too.
  for (let i = 1; i < visible.length; i++) if (expanded.has(visible[i])) reveal(visible[i]);
  return {
    nodes: visible.map((id) => graph.nodes.get(id)!),
    edges: graph.edges.filter((e) => seen.has(e.a) && seen.has(e.b)),
  };
};

export const GRAPH_VIEW = { width: 480, height: 280 } as const;

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  /** Rings away from the root within the shown part. */
  ring: number;
}

const KIND_ORDER: Record<GraphNodeKind, number> = { region: 0, object: 1, annotation: 2, resource: 3 };

export type GraphPositions = ReadonlyMap<string, { x: number; y: number }>;

/**
 * Root in the centre, the rest placed by a force-directed layout started from concentric rings (by distance from
 * the root within the shown part). Deterministic.
 *
 * `previous`: where the nodes stood before this change (a node was expanded or collapsed). Nodes that were shown
 * start there and barely move; new nodes start next to the node they hang from, so the reader can follow what appeared.
 */
export const layoutGraph = (shown: VisibleGraph, rootId: string, previous?: GraphPositions): PlacedNode[] => {
  const cx = GRAPH_VIEW.width / 2;
  const cy = GRAPH_VIEW.height / 2;
  const adj = new Map<string, string[]>();
  for (const e of shown.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const dist = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const n of adj.get(queue[i]) ?? []) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(queue[i])! + 1);
        queue.push(n);
      }
    }
  }
  const maxRing = Math.max(0, ...dist.values());
  // radii: leave room at the edge for the labels
  const rx = maxRing === 0 ? 0 : (GRAPH_VIEW.width / 2 - MARGIN_X) / maxRing;
  const ry = maxRing === 0 ? 0 : (GRAPH_VIEW.height / 2 - MARGIN_Y - 12) / maxRing;
  const placed = new Map<string, PlacedNode>();
  const angleOf = new Map<string, number>();
  const rings: GraphNode[][] = [];
  for (const node of shown.nodes) {
    const d = dist.get(node.id);
    if (d === undefined) continue; // not reachable inside the shown part (cannot happen for a subgraph from the root)
    (rings[d] ??= []).push(node);
  }
  rings.forEach((ring, d) => {
    if (d === 0) {
      const root = ring[0];
      placed.set(root.id, { ...root, x: cx, y: cy, ring: 0 });
      angleOf.set(root.id, 0);
      return;
    }
    const parentAngle = (n: GraphNode) => {
      const inner = (adj.get(n.id) ?? []).filter((m) => dist.get(m) === d - 1);
      return inner.length ? Math.min(...inner.map((m) => angleOf.get(m) ?? 0)) : 0;
    };
    const sorted = [...ring].sort(
      (a, b) =>
        parentAngle(a) - parentAngle(b) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    // a half step of turn per ring keeps the rings from lining up
    const start = -Math.PI / 2 + (d % 2 === 0 ? Math.PI / sorted.length : 0);
    sorted.forEach((n, i) => {
      const angle = start + (2 * Math.PI * i) / sorted.length;
      angleOf.set(n.id, angle + Math.PI / 2); // 0 at the top, increasing clockwise, for the next ring's ordering
      placed.set(n.id, { ...n, x: cx + rx * d * Math.cos(angle), y: cy + ry * d * Math.sin(angle), ring: d });
    });
  });
  const all = [...placed.values()];
  const kept = previous ? all.filter((n) => previous.has(n.id)) : [];
  if (previous && kept.length > 1) {
    // Keep the drawing the reader already knows: old nodes stay where they were, new ones grow out of their neighbour.
    const fresh: PlacedNode[] = [];
    for (const n of all) {
      const p = previous.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
      } else fresh.push(n);
    }
    fresh.forEach((n, i) => {
      const from = (adj.get(n.id) ?? []).map((m) => previous.get(m)).find((p) => p !== undefined) ?? { x: cx, y: cy };
      // spread the new ones around their neighbour, away from the centre where possible
      const away = Math.atan2(from.y - cy, from.x - cx);
      const angle = (from.x === cx && from.y === cy ? 0 : away) + ((i - (fresh.length - 1) / 2) * Math.PI) / Math.max(4, fresh.length);
      n.x = from.x + 40 * Math.cos(angle);
      n.y = from.y + 28 * Math.sin(angle);
    });
    const mobility = all.map((n) => (previous.has(n.id) ? 0 : 1));
    spring(all, shown.edges, rootId, { mobility, steps: 150, heat: 15 });
    fitAroundRoot(all, rootId, true);
    // make room for the new labels by moving the new nodes first; the old ones give way only a little
    separateLabels(all, rootId, new Set(kept.map((n) => n.id)));
  } else {
    spring(all, shown.edges, rootId);
    fitAroundRoot(all, rootId);
    separateLabels(all, rootId);
  }
  return shown.nodes.flatMap((n) => {
    const p = placed.get(n.id);
    return p ? [p] : [];
  });
};

// Room a node and its label need (the label is wider than it is tall).
const GAP_X = 92;
const GAP_Y = 40;
const MARGIN_X = 50;
const MARGIN_Y = 22;
// The bottom margin also holds the label under the node.
const LABEL_BELOW = 12;

/**
 * A force-directed layout (Fruchterman–Reingold) started from the rings: linked nodes pull together, every
 * pair pushes apart, so groups that share a node (a region, a Wikidata item) gather and lines cross less.
 * The root is pinned at the centre. A fixed number of steps from fixed starting points keeps it deterministic.
 */
const spring = (
  nodes: PlacedNode[],
  edges: GraphEdge[],
  rootId: string,
  { mobility, steps = 300, heat = 40 }: { mobility?: number[]; steps?: number; heat?: number } = {},
) => {
  if (nodes.length < 3) return;
  const cx = GRAPH_VIEW.width / 2;
  const cy = GRAPH_VIEW.height / 2;
  // simulate in a space as tall as it is wide, then let the fit stretch it to the view
  const aspect = GRAPH_VIEW.width / GRAPH_VIEW.height;
  const pos = nodes.map((n) => ({ x: n.x - cx, y: (n.y - cy) * aspect }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges.flatMap((e) => {
    const a = index.get(e.a);
    const b = index.get(e.b);
    return a === undefined || b === undefined ? [] : [[a, b] as const];
  });
  const k = 70; // the preferred length of a line
  const rootIndex = index.get(rootId);
  for (let step = 0; step < steps; step++) {
    const temperature = heat * (1 - step / steps) + 0.5;
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        if (dx === 0 && dy === 0) {
          dx = 0.1 * (j - i);
          dy = 0.1;
        }
        const d2 = dx * dx + dy * dy;
        const f = (k * k) / d2; // k² / d, as a factor of the unit vector times d
        disp[i].x += dx * f;
        disp[i].y += dy * f;
        disp[j].x -= dx * f;
        disp[j].y -= dy * f;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = d / k; // d² / k, as a factor of the unit vector times d
      disp[a].x -= dx * f;
      disp[a].y -= dy * f;
      disp[b].x += dx * f;
      disp[b].y += dy * f;
    }
    for (let i = 0; i < pos.length; i++) {
      if (i === rootIndex) continue;
      // a light pull to the centre keeps loose nodes from drifting off
      disp[i].x -= pos[i].x * 0.05;
      disp[i].y -= pos[i].y * 0.05;
      const len = Math.hypot(disp[i].x, disp[i].y) || 1;
      const move = Math.min(len, temperature) * (mobility?.[i] ?? 1);
      pos[i].x += (disp[i].x / len) * move;
      pos[i].y += (disp[i].y / len) * move;
    }
  }
  nodes.forEach((n, i) => {
    n.x = cx + pos[i].x;
    n.y = cy + pos[i].y / aspect;
  });
};

/**
 * Stretches (or shrinks) the drawing about the root so that it fills the view, each axis on its own.
 * `shrinkOnly`: only shrink what no longer fits, so a drawing the reader already knows does not jump.
 */
const fitAroundRoot = (nodes: PlacedNode[], rootId: string, shrinkOnly = false) => {
  const root = nodes.find((n) => n.id === rootId);
  if (!root || nodes.length < 2) return;
  const cx = GRAPH_VIEW.width / 2;
  const cy = GRAPH_VIEW.height / 2;
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  for (const n of nodes) {
    left = Math.max(left, root.x - n.x);
    right = Math.max(right, n.x - root.x);
    up = Math.max(up, root.y - n.y);
    down = Math.max(down, n.y - root.y);
  }
  const halfW = cx - MARGIN_X;
  const halfUp = cy - MARGIN_Y;
  const halfDown = cy - MARGIN_Y - LABEL_BELOW;
  const fitX = Math.max(left, right) > 0 ? halfW / Math.max(left, right) : 1;
  const fitY = Math.max(up, down) > 0 ? Math.min(halfUp / (up || 1e-9), halfDown / (down || 1e-9)) : 1;
  const sx = shrinkOnly ? Math.min(1, fitX) : fitX;
  const sy = shrinkOnly ? Math.min(1, fitY) : fitY;
  for (const n of nodes) {
    const dx = n.x - root.x;
    const dy = n.y - root.y;
    n.x = cx + dx * sx;
    n.y = cy + dy * sy;
  }
};

/**
 * Pushes apart nodes whose labels would still overlap, keeping all inside the view. The root stays put.
 * A fixed number of steps, so the result stays deterministic.
 */
const separateLabels = (nodes: PlacedNode[], rootId: string, anchored?: ReadonlySet<string>) => {
  if (nodes.length < 2) return;
  for (let step = 0; step < 200; step++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = GAP_X - Math.abs(dx);
        const oy = GAP_Y - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // move along the axis that frees them sooner
        const alongX = ox < oy * (GAP_X / GAP_Y);
        const amount = (alongX ? ox : oy) / 2 + 0.5;
        const sx = alongX ? (dx === 0 ? (j % 2 ? 1 : -1) : Math.sign(dx)) : 0;
        const sy = alongX ? 0 : dy === 0 ? (j % 2 ? 1 : -1) : Math.sign(dy);
        // how much each gives way: the root never, a node the reader already knows a little, a new node the most
        const give = (n: PlacedNode) => (n.id === rootId ? 0 : anchored?.has(n.id) ? 0.2 : 1);
        const ga = give(a);
        const gb = give(b);
        const ka = ga + gb === 0 ? 0 : (2 * ga) / (ga + gb);
        const kb = ga + gb === 0 ? 0 : (2 * gb) / (ga + gb);
        a.x -= sx * amount * ka;
        a.y -= sy * amount * ka;
        b.x += sx * amount * kb;
        b.y += sy * amount * kb;
      }
    }
    for (const n of nodes) {
      if (n.id === rootId) continue;
      n.x = Math.min(GRAPH_VIEW.width - MARGIN_X, Math.max(MARGIN_X, n.x));
      n.y = Math.min(GRAPH_VIEW.height - MARGIN_Y - LABEL_BELOW, Math.max(MARGIN_Y, n.y));
    }
    if (!moved) break;
  }
};

/**
 * Whether selecting this annotation opens its detail view (in place of the list): it has something to connect to,
 * and it is not the hit of a Content Search (those keep the plain selection in the list).
 */
export const opensDetail = (item: GraphItem & { hitId?: string }): boolean => !item.hitId && hasConnections(item);

/** How many annotations touch a node (for a region: the annotations on it). */
export const annotationsTouching = (graph: AnnotationGraph, nodeId: string): number =>
  (graph.adjacency.get(nodeId) ?? []).filter((id) => graph.nodes.get(id)?.kind === 'annotation').length;

export interface PopoverPlacement {
  /** Position of the anchor in percent of the diagram box. */
  left: number;
  top: number;
  /** Which side of the node the popover opens on. */
  side: 'left' | 'right';
}

/**
 * Where a popover goes next to a node of the diagram: on the side with more room (so it stays inside the box),
 * and the anchor is kept off the top and bottom edges so a popover centred on it does not leave the box either.
 */
export const popoverPlacement = (x: number, y: number): PopoverPlacement => {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    left: clamp((x / GRAPH_VIEW.width) * 100, 0, 100),
    top: clamp((y / GRAPH_VIEW.height) * 100, 30, 70),
    side: x > GRAPH_VIEW.width / 2 ? 'left' : 'right',
  };
};

/** A region with more annotations than this is not opened at the start (the diagram would fill with points). */
export const REGION_OPEN_LIMIT = 12;

/**
 * What the diagram opens with besides the root's own neighbours: the root's region resources, so the other
 * annotations on the same region show at once — unless a region holds more than `limit` annotations.
 */
export const initialExpansion = (graph: AnnotationGraph, rootId: string, limit = REGION_OPEN_LIMIT): Set<string> =>
  new Set(
    (graph.adjacency.get(rootId) ?? []).filter((id) => {
      if (graph.nodes.get(id)?.kind !== 'region') return false;
      const annotations = (graph.adjacency.get(id) ?? []).filter((m) => graph.nodes.get(m)?.kind === 'annotation');
      return annotations.length <= limit;
    }),
  );
