import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './graph-builder.js';
import { KahnsTopologicalSort } from './kahns-topological-sort.js';
import { CpmCalculator } from './cpm-calculator.js';
import { CriticalPathAnalyzer } from './critical-path-analyzer.js';

describe('CriticalPathAnalyzer', () => {
  it('should handle empty graph with zero paths and no truncation', () => {
    const graph = GraphBuilder.build([], []).unwrap();
    const cpm = CpmCalculator.calculate(graph, []).unwrap();
    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 10);

    expect(analysis.criticalPaths).toEqual([]);
    expect(analysis.isCriticalPathsTruncated).toBe(false);
    expect(analysis.criticalTaskIds.size).toBe(0);
  });

  it('should extract single critical path accurately', () => {
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 2 },
        { id: 'B', durationHours: 3 },
      ],
      [{ from: 'A', to: 'B' }]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const cpm = CpmCalculator.calculate(graph, topo).unwrap();
    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 10);

    expect(analysis.criticalPaths).toEqual([['A', 'B']]);
    expect(analysis.isCriticalPathsTruncated).toBe(false);
    expect(analysis.criticalTaskIds).toEqual(new Set(['A', 'B']));
  });

  it('should extract multiple equal-length critical paths deterministically', () => {
    // Branch 1: A (2h) -> B (4h) = 6h
    // Branch 2: C (2h) -> D (4h) = 6h
    const graph = GraphBuilder.build(
      [
        { id: 'C', durationHours: 2 },
        { id: 'A', durationHours: 2 },
        { id: 'D', durationHours: 4 },
        { id: 'B', durationHours: 4 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'C', to: 'D' },
      ]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const cpm = CpmCalculator.calculate(graph, topo).unwrap();
    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 10);

    expect(analysis.criticalPaths).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(analysis.isCriticalPathsTruncated).toBe(false);
  });

  it('should verify behavior with exactly K critical paths', () => {
    // 2 parallel paths: [A, B] and [C, D]
    const graph = GraphBuilder.build(
      [
        { id: 'A', durationHours: 2 },
        { id: 'B', durationHours: 2 },
        { id: 'C', durationHours: 2 },
        { id: 'D', durationHours: 2 },
      ],
      [
        { from: 'A', to: 'B' },
        { from: 'C', to: 'D' },
      ]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const cpm = CpmCalculator.calculate(graph, topo).unwrap();

    // Pass maxCriticalPaths = 2
    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 2);

    expect(analysis.criticalPaths.length).toBe(2);
    // There are exactly 2, so it should NOT be truncated!
    expect(analysis.isCriticalPathsTruncated).toBe(false);
  });

  it('should detect truncation when more than K critical paths exist without exponential explosion', () => {
    // 4 diamonds in a row: 2^4 = 16 critical paths
    // A -> (B1, B2) -> C -> (D1, D2) -> E -> (F1, F2) -> G -> (H1, H2) -> END
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

    const graph = GraphBuilder.build(nodes, edges).unwrap();
    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const cpm = CpmCalculator.calculate(graph, topo).unwrap();

    // Limit to max 5 paths
    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 5);

    expect(analysis.criticalPaths.length).toBe(5);
    expect(analysis.isCriticalPathsTruncated).toBe(true);
    // All 13 nodes should still be identified as critical
    expect(analysis.criticalTaskIds.size).toBe(13);
  });

  it('Regression (ALG-01): should traverse through zero-duration terminal milestone without premature truncation', () => {
    // TASK_A (5 hours) -> RELEASE_MILESTONE (0 hours)
    const graph = GraphBuilder.build(
      [
        { id: 'TASK_A', durationHours: 5 },
        { id: 'RELEASE_MILESTONE', durationHours: 0 },
      ],
      [{ from: 'TASK_A', to: 'RELEASE_MILESTONE' }]
    ).unwrap();

    const topo = KahnsTopologicalSort.sort(graph).unwrap();
    const cpm = CpmCalculator.calculate(graph, topo).unwrap();

    expect(cpm.projectDurationHours).toBe(5);
    expect(cpm.taskMetrics.get('TASK_A')!.isCritical).toBe(true);
    expect(cpm.taskMetrics.get('RELEASE_MILESTONE')!.isCritical).toBe(true);

    const analysis = CriticalPathAnalyzer.analyze(graph, cpm.taskMetrics, cpm.projectDurationHours, 10);

    // Must be exactly ['TASK_A', 'RELEASE_MILESTONE'] and not truncated at TASK_A
    expect(analysis.criticalPaths).toEqual([['TASK_A', 'RELEASE_MILESTONE']]);
    expect(analysis.isCriticalPathsTruncated).toBe(false);
    expect(analysis.criticalTaskIds).toEqual(new Set(['TASK_A', 'RELEASE_MILESTONE']));
  });
});
