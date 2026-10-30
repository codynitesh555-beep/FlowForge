import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './graph-builder.js';
import { DfsCycleDetector } from './dfs-cycle-detector.js';

describe('DfsCycleDetector', () => {
  it('should return no cycle for empty graph or single node', () => {
    const emptyGraph = GraphBuilder.build([], []).unwrap();
    expect(DfsCycleDetector.detectCycle(emptyGraph)).toEqual({ hasCycle: false });

    const singleNodeGraph = GraphBuilder.build([{ id: 'A', durationHours: 1 }], []).unwrap();
    expect(DfsCycleDetector.detectCycle(singleNodeGraph)).toEqual({ hasCycle: false });
  });

  it('should return no cycle for valid DAGs (linear and diamond)', () => {
    const linear = GraphBuilder.build(
      [
        { id: 'A', durationHours: 1 },
        { id: 'B', durationHours: 2 },
        { id: 'C', durationHours: 3 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ]
    ).unwrap();
    expect(DfsCycleDetector.detectCycle(linear)).toEqual({ hasCycle: false });

    const diamond = GraphBuilder.build(
      [
        { id: 'A', durationHours: 1 },
        { id: 'B', durationHours: 2 },
        { id: 'C', durationHours: 3 },
        { id: 'D', durationHours: 4 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ]
    ).unwrap();
    expect(DfsCycleDetector.detectCycle(diamond)).toEqual({ hasCycle: false });
  });

  it('should detect two-node direct cycle (A -> B, B -> A)', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 1 },
        { id: 'B', durationHours: 2 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ]
    ).unwrap();

    const res = DfsCycleDetector.detectCycle(graph);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['A', 'B', 'A']);
  });

  it('should detect complex nested cycle (A -> B -> C -> D -> B)', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 1 },
        { id: 'B', durationHours: 1 },
        { id: 'C', durationHours: 1 },
        { id: 'D', durationHours: 1 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'B' },
      ]
    ).unwrap();

    const res = DfsCycleDetector.detectCycle(graph);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['B', 'C', 'D', 'B']);
  });

  it('should deterministically return the lexicographically first cycle when multiple exist', () => {
    // Cycle 1: B -> C -> B
    // Cycle 2: D -> E -> D
    const graph = GraphBuilder.build(
      [
        { id: 'B', durationHours: 1 },
        { id: 'C', durationHours: 1 },
        { id: 'D', durationHours: 1 },
        { id: 'E', durationHours: 1 },
      ],
      [
        { from: 'B', to: 'C' },
        { from: 'C', to: 'B' },
        { from: 'D', to: 'E' },
        { from: 'E', to: 'D' },
      ]
    ).unwrap();

    const res = DfsCycleDetector.detectCycle(graph);
    expect(res.hasCycle).toBe(true);
    expect(res.cyclePath).toEqual(['B', 'C', 'B']);
  });

  it('should handle very deep graphs (5,000 nodes) without stack overflow', () => {
    const N = 5000;
    const nodes = Array.from({ length: N }, (_, i) => ({
      id: `NODE_${String(i).padStart(5, '0')}`,
      durationHours: 1,
    }));
    const edges = Array.from({ length: N - 1 }, (_, i) => ({
      from: `NODE_${String(i).padStart(5, '0')}`,
      to: `NODE_${String(i + 1).padStart(5, '0')}`,
    }));

    // Linear chain of 5,000 nodes (Acyclic)
    const graph = GraphBuilder.build(nodes, edges).unwrap();
    const resAcyclic = DfsCycleDetector.detectCycle(graph);
    expect(resAcyclic.hasCycle).toBe(false);

    // Add back-edge from tail to head
    const cyclicEdges = [
      ...edges,
      {
        from: `NODE_${String(N - 1).padStart(5, '0')}`,
        to: `NODE_${String(0).padStart(5, '0')}`,
      },
    ];
    const cyclicGraph = GraphBuilder.build(nodes, cyclicEdges).unwrap();
    const resCyclic = DfsCycleDetector.detectCycle(cyclicGraph);
    expect(resCyclic.hasCycle).toBe(true);
    expect(resCyclic.cyclePath?.length).toBe(N + 1);
    expect(resCyclic.cyclePath?.[0]).toBe('NODE_00000');
    expect(resCyclic.cyclePath?.[N]).toBe('NODE_00000');
  });
});
