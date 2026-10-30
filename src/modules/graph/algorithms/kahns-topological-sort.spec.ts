import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './graph-builder.js';
import { KahnsTopologicalSort } from './kahns-topological-sort.js';

describe('KahnsTopologicalSort', () => {
  it('should return empty array for empty graph', () => {
    const graph = GraphBuilder.build([], []).unwrap();
    const res = KahnsTopologicalSort.sort(graph);
    expect(res.isOk).toBe(true);
    expect(res.unwrap()).toEqual([]);
  });

  it('should sort disconnected nodes deterministically using lexicographical comparator', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'PAY-2', durationHours: 1 },
        { id: 'AUTH-1', durationHours: 1 },
        { id: 'PAY-1', durationHours: 1 },
      ],
      []
    ).unwrap();

    const res = KahnsTopologicalSort.sort(graph);
    expect(res.isOk).toBe(true);
    expect(res.unwrap()).toEqual(['AUTH-1', 'PAY-1', 'PAY-2']);
  });

  it('should sort diamond graph respecting edge constraints', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'D', durationHours: 1 },
        { id: 'A', durationHours: 1 },
        { id: 'C', durationHours: 1 },
        { id: 'B', durationHours: 1 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ]
    ).unwrap();

    const res = KahnsTopologicalSort.sort(graph);
    expect(res.isOk).toBe(true);
    const order = res.unwrap();

    // A must be first, D must be last, B and C between A and D in alphabetical order (B before C)
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });

  it('should fail with GRAPH_CYCLE_DETECTED if graph contains a cycle', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 1 },
        { id: 'B', durationHours: 1 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ]
    ).unwrap();

    const res = KahnsTopologicalSort.sort(graph);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_CYCLE_DETECTED');
  });
});
