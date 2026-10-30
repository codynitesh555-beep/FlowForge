/**
 * FlowForge Graph Engine - Critical Path Method (CPM) Two-Pass Calculator
 *
 * Implements the standard two-pass walk:
 *   1. Forward pass: Computes Earliest Start (ES) and Earliest Finish (EF).
 *   2. Backward pass: Computes Latest Finish (LF) and Latest Start (LS).
 *   3. Slack Evaluation: Computes Total Slack and Free Slack (with sink node boundary).
 *
 * Time Complexity: O(V + E)
 * Space Complexity: O(V)
 */
import { Result } from '../../../shared/types/result.js';
import { DependencyGraph } from '../types/graph.types.js';
import { TaskCpmMetrics } from '../types/cpm.types.js';
import { GraphError } from '../errors/graph.errors.js';

export const CPM_EPSILON = 1e-6;

export interface CpmCalculationResult {
  readonly projectDurationHours: number;
  readonly taskMetrics: ReadonlyMap<string, TaskCpmMetrics>;
}

export class CpmCalculator {
  /**
   * Computes early/late times and slack metrics for all nodes in the DAG.
   */
  static calculate(
    graph: DependencyGraph,
    topologicalOrder: readonly string[]
  ): Result<CpmCalculationResult, GraphError> {
    if (graph.nodes.size === 0) {
      return Result.ok({
        projectDurationHours: 0.0,
        taskMetrics: new Map<string, TaskCpmMetrics>(),
      });
    }

    const ES = new Map<string, number>();
    const EF = new Map<string, number>();
    const LS = new Map<string, number>();
    const LF = new Map<string, number>();

    // ---------------------------------------------------------
    // 1. FORWARD PASS: Compute ES and EF in topological order
    // ---------------------------------------------------------
    let maxProjectDuration = 0.0;

    for (const u of topologicalOrder) {
      const node = graph.nodes.get(u);
      if (!node) continue;

      const predecessors = graph.reverseAdjacency.get(u) ?? [];

      let earlyStart = 0.0;
      if (predecessors.length > 0) {
        let maxPredecessorEF = 0.0;
        for (const p of predecessors) {
          const predEF = EF.get(p) ?? 0.0;
          if (predEF > maxPredecessorEF) {
            maxPredecessorEF = predEF;
          }
        }
        earlyStart = maxPredecessorEF;
      }

      const earlyFinish = earlyStart + node.durationHours;

      // Validate numerical overflow
      if (!Number.isFinite(earlyStart) || !Number.isFinite(earlyFinish)) {
        return Result.fail({
          code: 'GRAPH_NUMERICAL_OVERFLOW',
          message: `Forward pass numerical overflow detected on node "${u}".`,
        });
      }

      ES.set(u, earlyStart);
      EF.set(u, earlyFinish);

      if (earlyFinish > maxProjectDuration) {
        maxProjectDuration = earlyFinish;
      }
    }

    const projectDurationHours = maxProjectDuration;

    // ---------------------------------------------------------
    // 2. BACKWARD PASS: Compute LF and LS in reverse topological order
    // ---------------------------------------------------------
    for (let i = topologicalOrder.length - 1; i >= 0; i--) {
      const u = topologicalOrder[i]!;
      const node = graph.nodes.get(u);
      if (!node) continue;

      const successors = graph.adjacency.get(u) ?? [];

      let lateFinish = projectDurationHours;
      if (successors.length > 0) {
        let minSuccessorLS = Infinity;
        for (const s of successors) {
          const succLS = LS.get(s) ?? projectDurationHours;
          if (succLS < minSuccessorLS) {
            minSuccessorLS = succLS;
          }
        }
        lateFinish = minSuccessorLS;
      }

      const lateStart = lateFinish - node.durationHours;

      // Validate numerical overflow
      if (!Number.isFinite(lateFinish) || !Number.isFinite(lateStart)) {
        return Result.fail({
          code: 'GRAPH_NUMERICAL_OVERFLOW',
          message: `Backward pass numerical overflow detected on node "${u}".`,
        });
      }

      LF.set(u, lateFinish);
      LS.set(u, lateStart);
    }

    // ---------------------------------------------------------
    // 3. SLACK COMPUTATION & BOUNDARY NORMALIZATION
    // ---------------------------------------------------------
    const taskMetrics = new Map<string, TaskCpmMetrics>();

    for (const u of topologicalOrder) {
      const es = ES.get(u)!;
      const ef = EF.get(u)!;
      const ls = LS.get(u)!;
      const lf = LF.get(u)!;

      let totalSlackHours = ls - es;
      const isCritical = Math.abs(totalSlackHours) < CPM_EPSILON;

      if (isCritical) {
        totalSlackHours = 0.0; // Eliminate float residue (-0 or 1e-16)
      }

      // Free Slack Boundary Rule:
      // For sink nodes (outDegree === 0): freeSlackHours = 0.0
      // For all other nodes: min(ES of successors) - EF of current node
      let freeSlackHours = 0.0;
      const successors = graph.adjacency.get(u) ?? [];

      if (successors.length > 0) {
        let minSuccessorES = Infinity;
        for (const s of successors) {
          const succES = ES.get(s) ?? 0.0;
          if (succES < minSuccessorES) {
            minSuccessorES = succES;
          }
        }
        freeSlackHours = Math.max(0.0, minSuccessorES - ef);
        if (Math.abs(freeSlackHours) < CPM_EPSILON) {
          freeSlackHours = 0.0;
        }
      }

      taskMetrics.set(u, {
        taskId: u,
        earlyStartHours: es,
        earlyFinishHours: ef,
        lateStartHours: ls,
        lateFinishHours: lf,
        totalSlackHours,
        freeSlackHours,
        isCritical,
      });
    }

    return Result.ok({
      projectDurationHours,
      taskMetrics,
    });
  }
}
