import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './graph-builder.js';
import { GraphNode, GraphEdge } from '../types/graph.types.js';

describe('GraphBuilder', () => {
  it('should successfully construct an empty graph', () => {
    const res = GraphBuilder.build([], []);
    expect(res.isOk).toBe(true);
    const graph = res.unwrap();
    expect(graph.nodes.size).toBe(0);
    expect(graph.adjacency.size).toBe(0);
    expect(graph.reverseAdjacency.size).toBe(0);
  });

  it('should construct a valid graph and sort successors/predecessors deterministically', () => {
    const nodes: GraphNode[] = [
      { id: 'C', durationHours: 2 },
      { id: 'A', durationHours: 5 },
      { id: 'B', durationHours: 3 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'C' },
      { from: 'A', to: 'B' },
    ];

    const res = GraphBuilder.build(nodes, edges);
    expect(res.isOk).toBe(true);
    const graph = res.unwrap();

    expect(graph.nodes.size).toBe(3);
    // Successors of A must be sorted ['B', 'C']
    expect(graph.adjacency.get('A')).toEqual(['B', 'C']);
    expect(graph.outDegree.get('A')).toBe(2);
    expect(graph.inDegree.get('A')).toBe(0);
    expect(graph.inDegree.get('B')).toBe(1);
    expect(graph.inDegree.get('C')).toBe(1);
  });

  it('should deduplicate multiple identical edges', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 1 },
      { id: 'B', durationHours: 2 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B' },
    ];

    const res = GraphBuilder.build(nodes, edges);
    expect(res.isOk).toBe(true);
    const graph = res.unwrap();
    expect(graph.adjacency.get('A')).toEqual(['B']);
    expect(graph.outDegree.get('A')).toBe(1);
    expect(graph.inDegree.get('B')).toBe(1);
  });

  it('should reject empty or whitespace node IDs', () => {
    const nodes: GraphNode[] = [{ id: '   ', durationHours: 4 }];
    const res = GraphBuilder.build(nodes, []);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_EMPTY_NODE_ID');
  });

  it('should reject duplicate node IDs', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 4 },
      { id: 'A', durationHours: 8 },
    ];
    const res = GraphBuilder.build(nodes, []);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_DUPLICATE_NODE_ID');
  });

  it('should reject invalid durations (negative, NaN, Infinity)', () => {
    expect(GraphBuilder.build([{ id: 'A', durationHours: -1 }], []).isErr).toBe(true);
    expect(GraphBuilder.build([{ id: 'A', durationHours: NaN }], []).isErr).toBe(true);
    expect(GraphBuilder.build([{ id: 'A', durationHours: Infinity }], []).isErr).toBe(true);
    expect(GraphBuilder.build([{ id: 'A', durationHours: -Infinity }], []).isErr).toBe(true);

    // 0 is a valid milestone duration
    expect(GraphBuilder.build([{ id: 'A', durationHours: 0 }], []).isOk).toBe(true);
  });

  it('should reject missing prerequisite or dependent nodes', () => {
    const nodes: GraphNode[] = [{ id: 'A', durationHours: 1 }];
    const resPrereq = GraphBuilder.build(nodes, [{ from: 'NON_EXISTENT', to: 'A' }]);
    expect(resPrereq.isErr).toBe(true);
    expect(resPrereq.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_MISSING_NODE');

    const resDep = GraphBuilder.build(nodes, [{ from: 'A', to: 'NON_EXISTENT' }]);
    expect(resDep.isErr).toBe(true);
    expect(resDep.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_MISSING_NODE');
  });

  it('should immediately detect and reject a self-loop (A -> A)', () => {
    const nodes: GraphNode[] = [{ id: 'A', durationHours: 1 }];
    const res = GraphBuilder.build(nodes, [{ from: 'A', to: 'A' }]);
    expect(res.isErr).toBe(true);
    res.match({
      ok: () => {
        throw new Error('Expected failure');
      },
      err: (e) => {
        expect(e.code).toBe('GRAPH_CYCLE_DETECTED');
        if (e.code === 'GRAPH_CYCLE_DETECTED') {
          expect(e.cyclePath).toEqual(['A', 'A']);
        }
      },
    });
  });
});
