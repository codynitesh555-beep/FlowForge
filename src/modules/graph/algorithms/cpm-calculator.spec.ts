import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './graph-builder.js';
import { KahnsTopologicalSort } from './kahns-topological-sort.js';
import { CpmCalculator } from './cpm-calculator.js';

describe('CpmCalculator', () => {
  it('should handle empty graph', () => {
    const graph = GraphBuilder.build([], []).unwrap();
    const res = CpmCalculator.calculate(graph, []);
    expect(res.isOk).toBe(true);
    const { projectDurationHours, taskMetrics } = res.unwrap();
    expect(projectDurationHours).toBe(0);
    expect(taskMetrics.size).toBe(0);
  });

  it('should calculate single node milestone and task correctly', () => {
    // Single task
    const graph = GraphBuilder.build([{ id: 'TASK-1', durationHours: 5 }], []).unwrap();
    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo);
    expect(res.isOk).toBe(true);

    const { projectDurationHours, taskMetrics } = res.unwrap();
    expect(projectDurationHours).toBe(5);

    const m = taskMetrics.get('TASK-1')!;
    expect(m.earlyStartHours).toBe(0);
    expect(m.earlyFinishHours).toBe(5);
    expect(m.lateStartHours).toBe(0);
    expect(m.lateFinishHours).toBe(5);
    expect(m.totalSlackHours).toBe(0);
    expect(m.freeSlackHours).toBe(0); // Sink node rule
    expect(m.isCritical).toBe(true);
  });

  it('should calculate linear graph: A (3h) -> B (4h) -> C (2h)', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 3 },
        { id: 'B', durationHours: 4 },
        { id: 'C', durationHours: 2 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo).unwrap();

    expect(res.projectDurationHours).toBe(9);

    const mA = res.taskMetrics.get('A')!;
    expect(mA.earlyStartHours).toBe(0);
    expect(mA.earlyFinishHours).toBe(3);
    expect(mA.isCritical).toBe(true);

    const mB = res.taskMetrics.get('B')!;
    expect(mB.earlyStartHours).toBe(3);
    expect(mB.earlyFinishHours).toBe(7);
    expect(mB.isCritical).toBe(true);

    const mC = res.taskMetrics.get('C')!;
    expect(mC.earlyStartHours).toBe(7);
    expect(mC.earlyFinishHours).toBe(9);
    expect(mC.isCritical).toBe(true);
    expect(mC.freeSlackHours).toBe(0); // Sink node
  });

  it('should accurately compute diamond graph with non-critical branch and slack', () => {
    // A (2h) -> B (5h) -> D (1h)
    // A (2h) -> C (2h) -> D (1h)
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 2 },
        { id: 'B', durationHours: 5 },
        { id: 'C', durationHours: 2 },
        { id: 'D', durationHours: 1 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo).unwrap();

    expect(res.projectDurationHours).toBe(8);

    // Critical tasks
    expect(res.taskMetrics.get('A')!.isCritical).toBe(true);
    expect(res.taskMetrics.get('B')!.isCritical).toBe(true);
    expect(res.taskMetrics.get('D')!.isCritical).toBe(true);

    // Non-critical task C
    const mC = res.taskMetrics.get('C')!;
    expect(mC.isCritical).toBe(false);
    expect(mC.earlyStartHours).toBe(2);
    expect(mC.earlyFinishHours).toBe(4);
    expect(mC.lateStartHours).toBe(5);
    expect(mC.lateFinishHours).toBe(7);
    expect(mC.totalSlackHours).toBe(3);
    // Successor D has ES = 7, so free slack for C = 7 - 4 = 3
    expect(mC.freeSlackHours).toBe(3);
  });

  it('should test divergence between Total Slack and Free Slack', () => {
    // A (0h) -> C1 (2h) -> C2 (2h) -> End (0h)  (path length 4)
    // A (0h) -> B (10h) ------------> End (0h)  (path length 10)
    // C1's successor is C2. C2's ES = 2.
    // C1's ES = 0, EF = 2.
    // FreeSlack(C1) = min(ES of successors) - EF = 2 - 2 = 0.
    // But TotalSlack(C1) = 6 because path can slip up to 6 hours before delaying project!
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 0 },
        { id: 'B', durationHours: 10 },
        { id: 'C1', durationHours: 2 },
        { id: 'C2', durationHours: 2 },
        { id: 'END', durationHours: 0 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'END' },
        { from: 'A', to: 'C1' },
        { from: 'C1', to: 'C2' },
        { from: 'C2', to: 'END' },
      ]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo).unwrap();

    expect(res.projectDurationHours).toBe(10);

    const mC1 = res.taskMetrics.get('C1')!;
    expect(mC1.totalSlackHours).toBe(6);
    expect(mC1.freeSlackHours).toBe(0); // Divergence verified!
  });

  it('should handle disconnected subgraphs correctly', () => {
    // Component 1: A (10h) -> B (5h)  [15h]
    // Component 2: C (25h)            [25h]
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 10 },
        { id: 'B', durationHours: 5 },
        { id: 'C', durationHours: 25 },
      ],
      [{ from: 'A', to: 'B' }]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo).unwrap();

    expect(res.projectDurationHours).toBe(25);
    expect(res.taskMetrics.get('C')!.isCritical).toBe(true);

    const mA = res.taskMetrics.get('A')!;
    expect(mA.isCritical).toBe(false);
    expect(mA.totalSlackHours).toBe(10);
    expect(mA.freeSlackHours).toBe(0); // B starts at 10, A finishes at 10

    const mB = res.taskMetrics.get('B')!;
    expect(mB.isCritical).toBe(false);
    expect(mB.totalSlackHours).toBe(10);
    expect(mB.freeSlackHours).toBe(0); // Sink node
  });

  it('should detect cumulative arithmetic overflow during forward pass and return GRAPH_NUMERICAL_OVERFLOW', () => {
    // Both individual node durations are valid, finite numbers in GraphBuilder
    const graph = GraphBuilder.build(
      [
        { id: 'OVERFLOW_1', durationHours: Number.MAX_VALUE },
        { id: 'OVERFLOW_2', durationHours: Number.MAX_VALUE },
      ],
      [{ from: 'OVERFLOW_1', to: 'OVERFLOW_2' }]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const res = CpmCalculator.calculate(graph, topo);

    expect(res.isErr).toBe(true);
    expect(res.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_NUMERICAL_OVERFLOW');
  });
});
