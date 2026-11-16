import { describe, expect, it } from 'vitest';
import {
  GRAPH_VIEW,
  OBJECT_NODE_ID,
  annotationNodeId,
  annotationsTouching,
  buildAnnotationGraph,
  hasConnections,
  initialExpansion,
  layoutGraph,
  opensDetail,
  popoverPlacement,
  regionNodeId,
  visibleSubgraph,
} from './annotationGraph';
import type { AnnotationResource } from './annotationResources';

const dog: AnnotationResource = { kind: 'wikidata', role: 'identifying', url: 'https://www.wikidata.org/wiki/Q144', label: 'dog' };
const book: AnnotationResource = { kind: 'citation', role: 'related', label: 'A. Author, Dogs, 2020' };

const items = [
  { id: 'a1', number: 1, label: 'First', regionId: 'reg1', resources: [dog] },
  { id: 'a2', number: 2, label: 'Second', regionId: 'reg1' },
  { id: 'a8', number: 8, label: 'Eighth', resources: [{ ...dog }, book] },
  { id: 'a9', number: 9, resources: [book] },
];
const object = { id: 'https://example.org/manifest', label: 'The item' };
const ids = (v: { nodes: { id: string }[] }) => v.nodes.map((n) => n.id);

describe('buildAnnotationGraph', () => {
  const g = buildAnnotationGraph(items, object);
  it('links two annotations on a shared region through one region node', () => {
    expect([...g.nodes.values()].filter((n) => n.kind === 'region')).toHaveLength(1);
    expect(g.adjacency.get(regionNodeId('reg1'))).toEqual(
      expect.arrayContaining([annotationNodeId('a1'), annotationNodeId('a2'), OBJECT_NODE_ID]),
    );
  });
  it('makes one node of a Wikidata address shared by two annotations', () => {
    const q = [...g.nodes.values()].filter((n) => n.kind === 'resource' && n.url?.endsWith('Q144'));
    expect(q).toHaveLength(1);
    expect(g.adjacency.get(q[0].id)).toEqual([annotationNodeId('a1'), annotationNodeId('a8')]);
  });
  it('merges a reference without an address by its text', () => {
    const c = [...g.nodes.values()].filter((n) => n.resourceKind === 'citation');
    expect(c).toHaveLength(1);
    expect(g.adjacency.get(c[0].id)).toHaveLength(2);
  });
  it('joins an annotation without a region to the object', () => {
    expect(g.adjacency.get(annotationNodeId('a8'))).toContain(OBJECT_NODE_ID);
    expect(g.adjacency.get(annotationNodeId('a1'))).not.toContain(OBJECT_NODE_ID);
  });
  it('omits the object when none is given', () => {
    expect(buildAnnotationGraph(items).nodes.has(OBJECT_NODE_ID)).toBe(false);
  });
  it('knows which annotations have connections', () => {
    expect(hasConnections({ id: 'x' })).toBe(false);
    expect(hasConnections(items[1])).toBe(true);
    expect(hasConnections(items[3])).toBe(true);
  });
});

describe('visibleSubgraph', () => {
  const g = buildAnnotationGraph(items, object);
  const root = annotationNodeId('a1');
  it('starts with the root and its neighbours only', () => {
    const v = visibleSubgraph(g, root, new Set());
    expect(ids(v).sort()).toEqual([root, regionNodeId('reg1'), 'x:https://www.wikidata.org/wiki/Q144'].sort());
    expect(v.edges).toHaveLength(2);
  });
  it('shows a lone annotation together with the object', () => {
    const lone = buildAnnotationGraph([{ id: 'z' }], object);
    expect(ids(visibleSubgraph(lone, annotationNodeId('z'), new Set()))).toEqual([annotationNodeId('z'), OBJECT_NODE_ID]);
  });
  it('reveals the other annotation when the shared resource is expanded', () => {
    const q = 'x:https://www.wikidata.org/wiki/Q144';
    expect(ids(visibleSubgraph(g, root, new Set())).includes(annotationNodeId('a8'))).toBe(false);
    const v = visibleSubgraph(g, root, new Set([q]));
    expect(ids(v)).toContain(annotationNodeId('a8'));
    expect(v.edges.some((e) => [e.a, e.b].sort().join() === [q, annotationNodeId('a8')].sort().join())).toBe(true);
  });
  it('ignores an expanded node that is not shown', () => {
    const v = visibleSubgraph(g, root, new Set([annotationNodeId('a8')]));
    expect(ids(v)).not.toContain(annotationNodeId('a8'));
  });
  it('is empty for an unknown root', () => {
    expect(visibleSubgraph(g, 'a:none', new Set()).nodes).toEqual([]);
  });
});

describe('layoutGraph', () => {
  const g = buildAnnotationGraph(items, object);
  const root = annotationNodeId('a1');
  const shown = visibleSubgraph(g, root, new Set(['x:https://www.wikidata.org/wiki/Q144', regionNodeId('reg1')]));
  it('is deterministic', () => {
    expect(layoutGraph(shown, root)).toEqual(layoutGraph(shown, root));
  });
  it('puts the root in the centre, numbers rings by distance, and stays inside the view', () => {
    const placed = layoutGraph(shown, root);
    const byId = new Map(placed.map((p) => [p.id, p]));
    expect(byId.get(root)).toMatchObject({ x: GRAPH_VIEW.width / 2, y: GRAPH_VIEW.height / 2, ring: 0 });
    expect(byId.get(regionNodeId('reg1'))!.ring).toBe(1);
    expect(byId.get(annotationNodeId('a8'))!.ring).toBe(2);
    expect(placed).toHaveLength(shown.nodes.length);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(GRAPH_VIEW.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(GRAPH_VIEW.height);
    }
  });
  it('places a lone root', () => {
    const lone = buildAnnotationGraph([{ id: 'z' }]);
    expect(layoutGraph(visibleSubgraph(lone, 'a:z', new Set()), 'a:z')).toHaveLength(1);
  });

  it('keeps the nodes already shown close to where they were when a node is expanded', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, regionId: 'r', resources: i === 0 ? [{ kind: 'wikidata' as const, role: 'identifying' as const, url: 'https://www.wikidata.org/wiki/Q1' }, { kind: 'wikipedia' as const, role: 'related' as const, url: 'https://en.wikipedia.org/wiki/X' }] : [] }));
    const g = buildAnnotationGraph(items, { id: 'm' });
    const before = layoutGraph(visibleSubgraph(g, 'a:n0', new Set()), 'a:n0');
    const prev = new Map(before.map((p) => [p.id, { x: p.x, y: p.y }]));
    const after = layoutGraph(visibleSubgraph(g, 'a:n0', new Set(['r:r'])), 'a:n0', prev);
    const fresh = layoutGraph(visibleSubgraph(g, 'a:n0', new Set(['r:r'])), 'a:n0');
    const shift = (placed: typeof after) =>
      before.reduce((sum, b) => {
        const a = placed.find((p) => p.id === b.id)!;
        return sum + Math.hypot(a.x - b.x, a.y - b.y);
      }, 0) / before.length;
    // with the previous positions the old nodes move little, and less than when laid out from scratch
    expect(shift(after)).toBeLessThan(30);
    expect(shift(after)).toBeLessThan(shift(fresh));
    expect(after).toHaveLength(before.length + 6); // five annotations on the region and the whole item
  });

  it('keeps the labels of a crowded region from overlapping, inside the view', () => {
    // one region shared by 9 annotations: expanding it puts 8 more around the start
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, regionId: 'r' }));
    const g = buildAnnotationGraph(items, { id: 'm' });
    const placed = layoutGraph(visibleSubgraph(g, 'a:n0', new Set(['r:r'])), 'a:n0');
    expect(placed).toHaveLength(11);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(GRAPH_VIEW.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(GRAPH_VIEW.height);
    }
    let overlaps = 0;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        if (Math.abs(placed[i].x - placed[j].x) < 60 && Math.abs(placed[i].y - placed[j].y) < 24) overlaps++;
    expect(overlaps).toBe(0);
  });
});

describe('detail view helpers', () => {
  it('opens the detail view only for connected annotations that are not search hits', () => {
    expect(opensDetail({ id: 'a', regionId: 'r' })).toBe(true);
    expect(opensDetail({ id: 'a', resources: [book] })).toBe(true);
    expect(opensDetail({ id: 'a' })).toBe(false);
    expect(opensDetail({ id: 'a', regionId: 'r', hitId: 'h' })).toBe(false);
  });

  it('counts the annotations on a region', () => {
    const g = buildAnnotationGraph(
      [
        { id: 'a', regionId: 'r' },
        { id: 'b', regionId: 'r' },
      ],
      undefined,
      'en',
    );
    expect(annotationsTouching(g, regionNodeId('r'))).toBe(2);
  });

  it('places the popover on the side with more room and keeps the anchor off the edges', () => {
    expect(popoverPlacement(GRAPH_VIEW.width * 0.8, 140).side).toBe('left');
    expect(popoverPlacement(GRAPH_VIEW.width * 0.2, 140).side).toBe('right');
    expect(popoverPlacement(10, 0).top).toBe(30);
    expect(popoverPlacement(10, GRAPH_VIEW.height).top).toBe(70);
    expect(popoverPlacement(GRAPH_VIEW.width / 2, GRAPH_VIEW.height / 2).left).toBe(50);
  });
});

describe('initialExpansion', () => {
  it("opens the root's region so the other annotations on it show at once", () => {
    const g = buildAnnotationGraph([{ id: 'a', regionId: 'r' }, { id: 'b', regionId: 'r' }, { id: 'c' }], { id: 'm' });
    expect([...initialExpansion(g, 'a:a')]).toEqual(['r:r']);
    const shown = visibleSubgraph(g, 'a:a', initialExpansion(g, 'a:a'));
    expect(shown.nodes.map((n) => n.id)).toContain('a:b');
  });
  it('leaves a crowded region closed, and opens nothing for an annotation without a region', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, regionId: 'r' }));
    const g = buildAnnotationGraph([...many, { id: 'lone' }], { id: 'm' });
    expect(initialExpansion(g, 'a:n0').size).toBe(0);
    expect(initialExpansion(g, 'a:n0', 13)).toEqual(new Set(['r:r']));
    expect(initialExpansion(g, 'a:lone').size).toBe(0);
  });
});
