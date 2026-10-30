/**
 * FlowForge Graph Engine - Critical Subgraph & Bounded Path Enumeration
 *
 * Implements:
 *   1. Critical Subgraph Construction: G_c = (V_c, E_c) in O(V + E)
 *   2. Bounded Path Search: Searches up to K + 1 paths to accurately detect truncation
 *      without risking combinatorial explosion.
 */
import { DependencyGraph } from '../types/graph.types.js';
import { TaskCpmMetrics } from '../types/cpm.types.js';
import { compareStringDeterministic } from '../utils/comparator.js';
import { CPM_EPSILON } from './cpm-calculator.js';

export interface CriticalPathAnalysis {
  readonly criticalTaskIds: ReadonlySet<string>;
  readonly criticalSubgraph: ReadonlyMap<string, readonly string[]>;
  readonly criticalPaths: string[][];
  readonly isCriticalPathsTruncated: boolean;
}

export class CriticalPathAnalyzer {
  /**
   * Constructs the critical subgraph and enumerates up to maxCriticalPaths.
   *
   * To prevent exponential combinatorial explosion in graphs with parallel diamonds,
   * path search is strictly bounded at maxCriticalPaths + 1.
   */
  static analyze(
    graph: DependencyGraph,
    taskMetrics: ReadonlyMap<string, TaskCpmMetrics>,
    projectDurationHours: number,
    maxCriticalPaths: number = 10
  ): CriticalPathAnalysis {
    // 1. Identify all critical nodes (V_c)
    const criticalTaskIds = new Set<string>();
    for (const [taskId, metrics] of taskMetrics.entries()) {
      if (metrics.isCritical) {
        criticalTaskIds.add(taskId);
      }
    }

    if (criticalTaskIds.size === 0) {
      return {
        criticalTaskIds: new Set<string>(),
        criticalSubgraph: new Map<string, readonly string[]>(),
        criticalPaths: [],
        isCriticalPathsTruncated: false,
      };
    }

    // 2. Build Critical Subgraph G_c:
    // Edge (u -> v) exists in G_c iff u in V_c, v in V_c, and |EF[u] - ES[v]| < EPSILON
    const criticalSubgraph = new Map<string, string[]>();
    const inDegreeGc = new Map<string, number>();

    for (const u of criticalTaskIds) {
      criticalSubgraph.set(u, []);
      inDegreeGc.set(u, 0);
    }

    for (const u of criticalTaskIds) {
      const uMetrics = taskMetrics.get(u)!;
      const successors = graph.adjacency.get(u) ?? [];

      for (const v of successors) {
        if (criticalTaskIds.has(v)) {
          const vMetrics = taskMetrics.get(v)!;
          if (Math.abs(uMetrics.earlyFinishHours - vMetrics.earlyStartHours) < CPM_EPSILON) {
            criticalSubgraph.get(u)!.push(v);
            inDegreeGc.set(v, (inDegreeGc.get(v) ?? 0) + 1);
          }
        }
      }
    }

    // Sort neighbors in critical subgraph for deterministic traversal
    const frozenCriticalSubgraph = new Map<string, readonly string[]>();
    for (const [u, successors] of criticalSubgraph.entries()) {
      successors.sort(compareStringDeterministic);
      frozenCriticalSubgraph.set(u, Object.freeze(successors));
    }

    // 3. Identify Critical Sources (entry points of critical paths)
    // A critical source has inDegree == 0 in G_c and ES == 0
    const criticalSources: string[] = [];
    for (const u of criticalTaskIds) {
      const metrics = taskMetrics.get(u)!;
      if (inDegreeGc.get(u) === 0 && Math.abs(metrics.earlyStartHours) < CPM_EPSILON) {
        criticalSources.push(u);
      }
    }
    criticalSources.sort(compareStringDeterministic);

    // 4. Bounded DFS Path Search up to (maxCriticalPaths + 1)
    const targetCapacity = Math.max(1, maxCriticalPaths);
    const searchLimit = targetCapacity + 1; // Discover if an extra path exists
    const discoveredPaths: string[][] = [];

    const currentPath: string[] = [];

    function dfsWalk(u: string): void {
      if (discoveredPaths.length >= searchLimit) {
        return; // Early exit: truncation limit exceeded
      }

      currentPath.push(u);
      const successors = frozenCriticalSubgraph.get(u) ?? [];
      const uMetrics = taskMetrics.get(u)!;

      // Check if u is a critical sink: no critical successors in the critical subgraph
      const isCriticalSink = successors.length === 0;

      if (isCriticalSink) {
        discoveredPaths.push([...currentPath]);
      } else {
        for (const nextNode of successors) {
          dfsWalk(nextNode);
          if (discoveredPaths.length >= searchLimit) {
            break;
          }
        }
      }

      currentPath.pop();
    }

    for (const source of criticalSources) {
      dfsWalk(source);
      if (discoveredPaths.length >= searchLimit) {
        break;
      }
    }

    // 5. Evaluate truncation flag and slice result to maxCriticalPaths
    const isCriticalPathsTruncated = discoveredPaths.length > targetCapacity;
    const finalCriticalPaths = isCriticalPathsTruncated
      ? discoveredPaths.slice(0, targetCapacity)
      : discoveredPaths;

    return {
      criticalTaskIds,
      criticalSubgraph: frozenCriticalSubgraph,
      criticalPaths: finalCriticalPaths,
      isCriticalPathsTruncated,
    };
  }
}
