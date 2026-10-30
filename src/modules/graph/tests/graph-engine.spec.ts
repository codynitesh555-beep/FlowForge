import { describe, it, expect } from 'vitest';
import { GraphEngine, GraphNode, GraphEdge } from '../index.js';

describe('GraphEngine Facade - Architectural Test Suite', () => {
  // Case 1: Empty Graph
  it('TestCase 1: Empty Graph', () => {
    const res = GraphEngine.analyze([], []);
    expect(res.isOk).toBe(true);
    const result = res.unwrap();
    expect(result.isValidDAG).toBe(true);
    expect(result.topologicalOrder).toEqual([]);
    expect(result.projectDurationHours).toBe(0);
    expect(result.criticalPaths).toEqual([]);
    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.isCriticalPathsTruncated).toBe(false);
  });

  // Case 2: Single Node Milestone
  it('TestCase 2: Single Node Milestone (duration = 0)', () => {
    const nodes: GraphNode[] = [{ id: 'M1', durationHours: 0 }];
    const res = GraphEngine.analyze(nodes, []);
    expect(res.isOk).toBe(true);
    const result = res.unwrap();
    expect(result.projectDurationHours).toBe(0);
    expect(result.criticalTaskIds.has('M1')).toBe(true);
    const m = result.taskMetrics.get('M1')!;
    expect(m.totalSlackHours).toBe(0);
    expect(m.freeSlackHours).toBe(0);
    expect(m.isCritical).toBe(true);
  });

  // Case 3: Self-Loop (A -> A)
  it('TestCase 3: Self-Loop (A -> A)', () => {
    const nodes: GraphNode[] = [{ id: 'A', durationHours: 1 }];
    const edges: GraphEdge[] = [{ from: 'A', to: 'A' }];
    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isErr).toBe(true);
    res.match({
      ok: () => { throw new Error('Expected failure'); },
      err: (e) => {
        expect(e.code).toBe('GRAPH_CYCLE_DETECTED');
        if (e.code === 'GRAPH_CYCLE_DETECTED') {
          expect(e.cyclePath).toEqual(['A', 'A']);
        }
      },
    });
  });

  // Case 4: Two-Node Direct Cycle (A -> B, B -> A)
  it('TestCase 4: Two-Node Direct Cycle (A -> B, B -> A)', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 1 },
      { id: 'B', durationHours: 2 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ];
    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isErr).toBe(true);
    res.match({
      ok: () => { throw new Error('Expected failure'); },
      err: (e) => {
        expect(e.code).toBe('GRAPH_CYCLE_DETECTED');
        if (e.code === 'GRAPH_CYCLE_DETECTED') {
          expect(e.cyclePath).toEqual(['A', 'B', 'A']);
        }
      },
    });
  });

  // Case 5: Complex Nested Cycle
  it('TestCase 5: Complex Nested Cycle (A -> B -> C -> D -> B)', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 1 },
      { id: 'B', durationHours: 1 },
      { id: 'C', durationHours: 1 },
      { id: 'D', durationHours: 1 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'B' },
    ];
    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isErr).toBe(true);
    res.match({
      ok: () => { throw new Error('Expected failure'); },
      err: (e) => {
        expect(e.code).toBe('GRAPH_CYCLE_DETECTED');
        if (e.code === 'GRAPH_CYCLE_DETECTED') {
          expect(e.cyclePath).toEqual(['B', 'C', 'D', 'B']);
        }
      },
    });
  });

  // Case 6: Deterministic Kahn's Tie-Breaking
  it('TestCase 6: Deterministic Kahn Tie-Breaking with Independent Nodes', () => {
    const nodes: GraphNode[] = [
      { id: 'PAY-2', durationHours: 2 },
      { id: 'PAY-1', durationHours: 2 },
      { id: 'AUTH-1', durationHours: 2 },
    ];
    const res = GraphEngine.analyze(nodes, []);
    expect(res.isOk).toBe(true);
    expect(res.unwrap().topologicalOrder).toEqual(['AUTH-1', 'PAY-1', 'PAY-2']);
  });

  // Case 7: Diamond Dependency with Slack & Free Slack
  it('TestCase 7: Diamond Dependency with Slack & Free Slack', () => {
    // A (2h) -> B (5h) -> D (1h)
    // A (2h) -> C (2h) -> D (1h)
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 2 },
      { id: 'B', durationHours: 5 },
      { id: 'C', durationHours: 2 },
      { id: 'D', durationHours: 1 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ];

    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isOk).toBe(true);
    const result = res.unwrap();

    expect(result.projectDurationHours).toBe(8);
    expect(result.criticalPaths).toEqual([['A', 'B', 'D']]);
    expect(result.criticalTaskIds).toEqual(new Set(['A', 'B', 'D']));

    const cMetrics = result.taskMetrics.get('C')!;
    expect(cMetrics.isCritical).toBe(false);
    expect(cMetrics.totalSlackHours).toBe(3);
    expect(cMetrics.freeSlackHours).toBe(3);
  });

  // Case 8: Free Slack vs Total Slack Divergence
  it('TestCase 8: Free Slack vs Total Slack Divergence', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 0 },
      { id: 'B', durationHours: 10 },
      { id: 'C1', durationHours: 2 },
      { id: 'C2', durationHours: 2 },
      { id: 'END', durationHours: 0 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'END' },
      { from: 'A', to: 'C1' },
      { from: 'C1', to: 'C2' },
      { from: 'C2', to: 'END' },
    ];

    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isOk).toBe(true);
    const result = res.unwrap();

    const mC1 = result.taskMetrics.get('C1')!;
    expect(mC1.totalSlackHours).toBe(6);
    expect(mC1.freeSlackHours).toBe(0);
  });

  // Case 9: Combinatorial Critical Path Truncation
  it('TestCase 9: Combinatorial Critical Path Truncation (2^4 = 16 paths capped at 5)', () => {
    const nodes = [
      { id: 'A', durationHours: 0 },
      { id: 'B1', durationHours: 1 },
      { id: 'B2', durationHours: 1 },
      { id: 'C', durationHours: 0 },
      { id: 'D1', durationHours: 1 },
      { id: 'D2', durationHours: 1 },
      { id: 'E', durationHours: 0 },
      { id: 'F1', durationHours: 1 },
      { id: 'F2', durationHours: 1 },
      { id: 'G', durationHours: 0 },
      { id: 'H1', durationHours: 1 },
      { id: 'H2', durationHours: 1 },
      { id: 'END', durationHours: 0 },
    ];

    const edges = [
      { from: 'A', to: 'B1' }, { from: 'A', to: 'B2' },
      { from: 'B1', to: 'C' }, { from: 'B2', to: 'C' },
      { from: 'C', to: 'D1' }, { from: 'C', to: 'D2' },
      { from: 'D1', to: 'E' }, { from: 'D2', to: 'E' },
      { from: 'E', to: 'F1' }, { from: 'E', to: 'F2' },
      { from: 'F1', to: 'G' }, { from: 'F2', to: 'G' },
      { from: 'G', to: 'H1' }, { from: 'G', to: 'H2' },
      { from: 'H1', to: 'END' }, { from: 'H2', to: 'END' },
    ];

    const res = GraphEngine.analyze(nodes, edges, { maxCriticalPaths: 5 });
    expect(res.isOk).toBe(true);
    const result = res.unwrap();

    expect(result.criticalPaths.length).toBe(5);
    expect(result.isCriticalPathsTruncated).toBe(true);
    expect(result.criticalTaskIds.size).toBe(13);
  });

  // Case 10: Disconnected Subgraphs
  it('TestCase 10: Disconnected Subgraphs', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 10 },
      { id: 'B', durationHours: 5 },
      { id: 'C', durationHours: 25 },
    ];
    const edges: GraphEdge[] = [{ from: 'A', to: 'B' }];

    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isOk).toBe(true);
    const result = res.unwrap();

    expect(result.projectDurationHours).toBe(25);
    expect(result.criticalTaskIds).toEqual(new Set(['C']));
    expect(result.criticalPaths).toEqual([['C']]);
  });

  // Case 11: Invalid Durations Rejected
  it('TestCase 11: Invalid Durations Rejected', () => {
    const resNeg = GraphEngine.analyze([{ id: 'A', durationHours: -5 }], []);
    expect(resNeg.isErr).toBe(true);
    expect(resNeg.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_INVALID_DURATION');

    const resNaN = GraphEngine.analyze([{ id: 'A', durationHours: NaN }], []);
    expect(resNaN.isErr).toBe(true);

    const resInf = GraphEngine.analyze([{ id: 'A', durationHours: Infinity }], []);
    expect(resInf.isErr).toBe(true);
  });

  // Case 12: Missing Node Referential Integrity
  it('TestCase 12: Missing Node Referential Integrity', () => {
    const nodes: GraphNode[] = [{ id: 'A', durationHours: 2 }];
    const edges: GraphEdge[] = [{ from: 'A', to: 'MISSING' }];
    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_MISSING_NODE');
  });

  // Additional Boundary Tests:
  it('Boundary: Duplicate node IDs rejected', () => {
    const nodes: GraphNode[] = [
      { id: 'PAY-1', durationHours: 2 },
      { id: 'PAY-1', durationHours: 4 },
    ];
    const res = GraphEngine.analyze(nodes, []);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_DUPLICATE_NODE_ID');
  });

  it('Boundary: Empty or whitespace node IDs rejected', () => {
    const nodes: GraphNode[] = [{ id: '   ', durationHours: 2 }];
    const res = GraphEngine.analyze(nodes, []);
    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_EMPTY_NODE_ID');
  });

  it('Boundary: Duplicate edges automatically handled', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 2 },
      { id: 'B', durationHours: 3 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B' },
    ];
    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isOk).toBe(true);
    expect(res.unwrap().projectDurationHours).toBe(5);
  });

  it('Boundary: Exactly K critical paths returns isCriticalPathsTruncated = false', () => {
    // 2 parallel branches: [A, B] and [C, D]
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 1 },
      { id: 'B', durationHours: 2 },
      { id: 'C', durationHours: 1 },
      { id: 'D', durationHours: 2 },
    ];
    const edges: GraphEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ];

    const res = GraphEngine.analyze(nodes, edges, { maxCriticalPaths: 2 });
    expect(res.isOk).toBe(true);
    const result = res.unwrap();
    expect(result.criticalPaths.length).toBe(2);
    expect(result.isCriticalPathsTruncated).toBe(false);
  });

  it('Boundary: Fast acyclic validation helper', () => {
    const nodes: GraphNode[] = [
      { id: 'A', durationHours: 1 },
      { id: 'B', durationHours: 1 },
    ];
    expect(GraphEngine.validateAcyclic(nodes, [{ from: 'A', to: 'B' }]).isOk).toBe(true);
    expect(
      GraphEngine.validateAcyclic(nodes, [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ]).isErr
    ).toBe(true);
  });

  // Regression Test (ALG-01): Terminal Zero-Duration Milestone on Critical Path
  it('Regression (ALG-01): TASK_A (5h) -> RELEASE_MILESTONE (0h) critical path preserves milestone', () => {
    const nodes: GraphNode[] = [
      { id: 'TASK_A', durationHours: 5 },
      { id: 'RELEASE_MILESTONE', durationHours: 0 },
    ];
    const edges: GraphEdge[] = [{ from: 'TASK_A', to: 'RELEASE_MILESTONE' }];

    const res = GraphEngine.analyze(nodes, edges);
    expect(res.isOk).toBe(true);

    const result = res.unwrap();
    // 1. Assert project duration is 5 hours
    expect(result.projectDurationHours).toBe(5);

    // 2. Assert both nodes are critical
    expect(result.criticalTaskIds.has('TASK_A')).toBe(true);
    expect(result.criticalTaskIds.has('RELEASE_MILESTONE')).toBe(true);

    // 3. Assert the critical path is exactly: ['TASK_A', 'RELEASE_MILESTONE']
    expect(result.criticalPaths).toEqual([['TASK_A', 'RELEASE_MILESTONE']]);

    // 4. Assert the path is not incorrectly truncated at TASK_A
    expect(result.isCriticalPathsTruncated).toBe(false);
  });
});
