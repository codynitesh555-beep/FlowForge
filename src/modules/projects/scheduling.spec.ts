import { describe, expect, it } from 'vitest';
import { analyzeDependencyAddition, analyzeProjectSnapshot, buildActiveProjectGraph } from './scheduling.js';

describe('analyzeProjectSnapshot', () => {
  it('delegates active graph nodes and edges to the frozen Graph Engine', () => {
    const result = analyzeProjectSnapshot({
      graphRevision: 4,
      nodes: [
        { id: 'task-a', durationHours: 2 },
        { id: 'task-b', durationHours: 3 },
      ],
      edges: [{ from: 'task-a', to: 'task-b' }],
    });

    expect(result.isOk).toBe(true);
    expect(result.unwrap().projectDurationHours).toBe(5);
    expect(result.unwrap().topologicalOrder).toEqual(['task-a', 'task-b']);
  });

  it('preserves graph validation errors for callers to map at the application boundary', () => {
    const result = analyzeProjectSnapshot({
      graphRevision: 1,
      nodes: [{ id: 'task-a', durationHours: 1 }],
      edges: [{ from: 'task-a', to: 'missing' }],
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe('GRAPH_MISSING_NODE');
  });

  it('rejects a dependency that would close a cycle through the frozen Graph Engine', () => {
    const snapshot = {
      graphRevision: 5,
      nodes: [{ id: 'a', durationHours: 1 }, { id: 'b', durationHours: 1 }, { id: 'c', durationHours: 1 }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    };
    const result = analyzeDependencyAddition(snapshot, 'c', 'a');
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe('GRAPH_CYCLE_DETECTED');
  });

  it('excludes soft-deleted tasks, removed edges, and edges touching deleted tasks', () => {
    const deletedAt = new Date('2026-01-01T00:00:00.000Z');
    const snapshot = buildActiveProjectGraph(8, [
      { id: 'active-a', expectedHours: 2, deletedAt: null },
      { id: 'active-b', expectedHours: 3, deletedAt: null },
      { id: 'deleted-c', expectedHours: 4, deletedAt },
    ], [
      { from: 'active-a', to: 'active-b', removedAt: null },
      { from: 'active-b', to: 'deleted-c', removedAt: null },
      { from: 'deleted-c', to: 'active-a', removedAt: null },
      { from: 'active-b', to: 'active-a', removedAt: deletedAt },
    ]);
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['active-a', 'active-b']);
    expect(snapshot.edges).toEqual([{ from: 'active-a', to: 'active-b' }]);
    expect(analyzeProjectSnapshot(snapshot).isOk).toBe(true);
  });
});
