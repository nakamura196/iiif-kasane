'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  GRAPH_VIEW,
  annotationNodeId,
  annotationsTouching,
  initialExpansion,
  popoverPlacement,
  layoutGraph,
  visibleSubgraph,
  type AnnotationGraph,
  type GraphNode,
  type GraphPositions,
  type PlacedNode,
} from '../../core';
import { useTranslations } from '../env';

const MAX_LABEL = 14;
const shorten = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

// Fill colours by kind (Tailwind classes, with dark-mode variants).
const FILL: Record<string, string> = {
  annotation: 'fill-blue-500 dark:fill-blue-400',
  region: 'fill-violet-500 dark:fill-violet-400',
  object: 'fill-slate-500 dark:fill-slate-400',
  wikidata: 'fill-emerald-600 dark:fill-emerald-400',
  wikipedia: 'fill-teal-600 dark:fill-teal-400',
  web: 'fill-sky-600 dark:fill-sky-400',
  citation: 'fill-lime-600 dark:fill-lime-400', // not orange: orange is the annotation the diagram is about
  image: 'fill-pink-600 dark:fill-pink-400',
};
// The annotation the diagram is about is orange, as its number is in the list.
const ROOT_FILL = 'fill-orange-500 dark:fill-orange-400';
const fillOf = (n: GraphNode, isRoot: boolean) =>
  isRoot ? ROOT_FILL : FILL[n.kind === 'resource' ? (n.resourceKind ?? 'web') : n.kind];

function useKindName() {
  const t = useTranslations('AnnotationConnections');
  return (n: GraphNode): string => {
    switch (n.kind) {
      case 'annotation':
        return t('kindAnnotation');
      case 'region':
        return t('kindRegion');
      case 'object':
        return t('kindObject');
      default:
        return t(`kind_${n.resourceKind ?? 'web'}`);
    }
  };
}


const TWEEN_MS = 400;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Where to draw each node right now: glides from where it was drawn to its new place when the layout changes.
 * A node that just appeared starts at `origin` (the node that was clicked), so it is seen coming out of it.
 */
function useGlide(nodes: PlacedNode[], origin: string | null): GraphPositions {
  const target = useMemo(() => new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])), [nodes]);
  const [drawn, setDrawn] = useState<GraphPositions>(target);
  const drawnRef = useRef<GraphPositions>(target);
  useEffect(() => {
    const from = drawnRef.current;
    const start = new Map<string, { x: number; y: number }>();
    const o = origin ? from.get(origin) : undefined;
    for (const [id, p] of target) start.set(id, from.get(id) ?? o ?? p);
    const done = () => {
      drawnRef.current = target;
      setDrawn(target);
    };
    if (reducedMotion()) {
      done();
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = easeOut(Math.min(1, (now - t0) / TWEEN_MS));
      if (k >= 1) return done();
      const at = new Map<string, { x: number; y: number }>();
      for (const [id, p] of target) {
        const s = start.get(id)!;
        at.set(id, { x: s.x + (p.x - s.x) * k, y: s.y + (p.y - s.y) * k });
      }
      drawnRef.current = at;
      setDrawn(at);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, origin]);
  return drawn;
}

/**
 * A small network diagram of one annotation: the annotation at the centre, with what it touches (its region
 * resource, linked resources, the whole item). Clicking a node expands it (what it touches in turn) and opens a small
 * preview next to it; the preview's button opens a link or goes to another annotation. Shown in the annotation detail
 * view, shared by the 2D and the 3D annotation lists.
 */
export function AnnotationNetwork({
  graph,
  annotationId,
  onSelectAnnotation,
  large,
}: {
  graph: AnnotationGraph;
  /** The annotation at the centre (the id the graph was built with). */
  annotationId: string;
  onSelectAnnotation: (id: string) => void;
  /** A taller diagram (the detail view). */
  large?: boolean;
}) {
  const t = useTranslations('AnnotationConnections');
  const kindName = useKindName();
  const rootId = annotationNodeId(annotationId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => initialExpansion(graph, rootId));
  // what was clicked last (new nodes grow out of it) and where the nodes stood before (they stay there)
  const [change, setChange] = useState<{ origin: string | null; previous?: GraphPositions }>({ origin: null });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!focusedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedId]);

  const placed = useMemo(() => {
    const shown = visibleSubgraph(graph, rootId, expanded);
    return { shown, nodes: layoutGraph(shown, rootId, change.previous) };
  }, [graph, rootId, expanded, change]);
  const start = useMemo(() => initialExpansion(graph, rootId), [graph, rootId]);
  const changedFromStart = expanded.size !== start.size || [...expanded].some((id) => !start.has(id));
  const drawn = useGlide(placed.nodes, change.origin);
  const at = (n: { id: string; x: number; y: number }) => drawn.get(n.id) ?? n;
  const byId = useMemo(() => new Map(placed.nodes.map((n) => [n.id, n])), [placed]);
  const focused = focusedId ? byId.get(focusedId) : undefined;

  const activate = (n: PlacedNode) => {
    // a second click on the same node closes its preview
    setFocusedId((prev) => (prev === n.id ? null : n.id));
    if (n.id === rootId) return;
    setChange({ origin: n.id, previous: new Map(placed.nodes.map((m) => [m.id, { x: m.x, y: m.y }])) });
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
  };
  const reset = () => {
    setChange({ origin: rootId, previous: new Map(placed.nodes.map((m) => [m.id, { x: m.x, y: m.y }])) });
    setExpanded(initialExpansion(graph, rootId));
    setFocusedId(null);
  };

  return (
    // Clicks inside the graph must not select or deselect the card around it.
    <div className="space-y-1" onClick={(e) => e.stopPropagation()} data-annotation-network>
      <div className="relative">
      <svg
        viewBox={`0 0 ${GRAPH_VIEW.width} ${GRAPH_VIEW.height}`}
        className={`w-full h-auto ${large ? 'max-h-[28rem]' : 'max-h-80'} rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900`}
        role="group"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{t('title')}</title>
        <g className="stroke-gray-300 dark:stroke-gray-600" strokeWidth={1.5}>
          {placed.shown.edges.map((e) => {
            const a = byId.get(e.a);
            const b = byId.get(e.b);
            if (!a || !b) return null;
            const pa = at(a);
            const pb = at(b);
            return <line key={`${e.a}|${e.b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />;
          })}
        </g>
        {placed.nodes.map((n) => {
          const isRoot = n.id === rootId;
          const r = isRoot ? 14 : 11;
          const hasMore = (graph.adjacency.get(n.id) ?? []).some((m) => !byId.has(m));
          const isOpen = expanded.has(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${at(n).x} ${at(n).y})`}
              role="button"
              tabIndex={0}
              aria-label={`${kindName(n)}: ${n.label}`}
              aria-pressed={isRoot ? undefined : isOpen}
              className="cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-gray-900 dark:[&:focus-visible>circle:first-of-type]:stroke-white [&:focus-visible>circle:first-of-type]:stroke-[3]"
              onClick={() => activate(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate(n);
                }
              }}
            >
              <title>{n.label}</title>
              <circle
                r={r}
                className={`${fillOf(n, isRoot)} ${focusedId === n.id ? 'stroke-gray-900 dark:stroke-white' : 'stroke-white dark:stroke-gray-900'}`}
                strokeWidth={focusedId === n.id ? 3 : 2}
              />
              {/* a ring around a node that has more to show */}
              {hasMore && !isOpen ? (
                <circle r={r + 3} fill="none" strokeDasharray="2 2" className="stroke-gray-500 dark:stroke-gray-400" />
              ) : null}
              {n.kind === 'annotation' && n.number !== undefined ? (
                <text textAnchor="middle" dy="0.35em" fontSize={10} className="fill-white pointer-events-none tabular-nums">
                  {n.number}
                </text>
              ) : null}
              <text
                y={r + 11}
                textAnchor="middle"
                fontSize={9}
                className="fill-gray-700 dark:fill-gray-200 pointer-events-none"
              >
                {/* a region's label is its id (an address); under the node, say what it is instead */}
                {shorten(n.kind === 'region' ? kindName(n) : n.label)}
              </text>
            </g>
          );
        })}
      </svg>
        {focused ? (
          <NodePopover
            node={focused}
            kind={kindName(focused)}
            isRoot={focused.id === rootId}
            count={focused.kind === 'region' ? annotationsTouching(graph, focused.id) : 0}
            onClose={() => setFocusedId(null)}
            onSelectAnnotation={onSelectAnnotation}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300 min-h-6">
        <span className="min-w-0 break-words">{t('hint')}</span>
        {changedFromStart || focusedId ? (
          <button type="button" onClick={reset} className="shrink-0 text-[var(--ds-primary)] hover:underline">
            {t('reset')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// The preview next to a clicked node: what it is, its full text, and what you can do with it.
function NodePopover({
  node,
  kind,
  isRoot,
  count,
  onClose,
  onSelectAnnotation,
}: {
  node: PlacedNode;
  kind: string;
  isRoot: boolean;
  count: number;
  onClose: () => void;
  onSelectAnnotation: (id: string) => void;
}) {
  const t = useTranslations('AnnotationConnections');
  const place = popoverPlacement(node.x, node.y);
  const action = 'text-[var(--ds-primary)] hover:underline';
  return (
    <div
      data-network-popover
      role="dialog"
      aria-label={kind}
      style={{ left: `${place.left}%`, top: `${place.top}%` }}
      className={`absolute z-10 w-max max-w-[46%] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 pr-6 text-xs shadow-md ${
        place.side === 'right' ? 'ml-4 -translate-y-1/2' : '-translate-x-full -ml-4 -translate-y-1/2'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('close')}
        className="absolute right-1 top-1 h-5 w-5 leading-5 text-center text-gray-500 hover:text-gray-800 dark:hover:text-gray-100"
      >
        ×
      </button>
      <div className="text-gray-500 dark:text-gray-400">{kind}</div>
      {/* a region's label is its id (an address); the count says more */}
      {node.kind === 'region' ? (
        count > 0 ? <div className="text-gray-800 dark:text-gray-100">{t('annotationsOnRegion', { count })}</div> : null
      ) : (
        <div className="break-words text-gray-800 dark:text-gray-100">{node.label}</div>
      )}
      {node.kind === 'resource' && node.url ? (
        <a href={node.url} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-block ${action}`}>
          {t('openResource')}
        </a>
      ) : null}
      {node.kind === 'annotation' && node.annotationId && !isRoot ? (
        <button type="button" onClick={() => onSelectAnnotation(node.annotationId!)} className={`mt-1 block ${action}`}>
          {t('goToAnnotation')}
        </button>
      ) : null}
    </div>
  );
}
