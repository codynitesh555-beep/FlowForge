/**
 * FlowForge Graph Engine - Deterministic Topological Sort (Kahn's Algorithm)
 * Uses a Binary Min Heap to guarantee deterministic lexicographical tie-breaking
 * whenever multiple nodes have zero in-degree.
 *
 * Upper bound time complexity: O((V + E) log V)
 * Space complexity: O(V + E)
 */
import { Result } from '../../../shared/types/result.js';
import { DependencyGraph } from '../types/graph.types.js';
import { GraphError } from '../errors/graph.errors.js';
import { BinaryMinHeap } from './binary-min-heap.js';
import { compareStringDeterministic } from '../utils/comparator.js';

export class KahnsTopologicalSort {
  /**
   * Computes a deterministic topological ordering for the DependencyGraph.
   * If a cycle is present, returns a GraphCycleError.
   */
  static sort(graph: DependencyGraph): Result<string[], GraphError> {
    const inDegreeMap = new Map<string, number>(graph.inDegree);
    const minHeap = new BinaryMinHeap<string>(compareStringDeterministic);
    const topologicalOrder: string[] = [];

    // 1. Enqueue all source nodes (in-degree == 0)
    for (const [nodeId, degree] of inDegreeMap.entries()) {
      if (degree === 0) {
        minHeap.push(nodeId);
      }
    }

    // 2. Process nodes in deterministic order
    while (!minHeap.isEmpty) {
      const u = minHeap.pop()!;
      topologicalOrder.push(u);

      const successors = graph.adjacency.get(u) ?? [];
      for (const v of successors) {
        const currentDegree = (inDegreeMap.get(v) ?? 1) - 1;
        inDegreeMap.set(v, currentDegree);

        if (currentDegree === 0) {
          minHeap.push(v);
        }
      }
    }

    // 3. Cycle safety guard: If not all nodes were processed, a cycle exists.
    // Note (KAH-01): Standalone Kahn's sort detects cycle presence but does not reconstruct the exact
    // cycle path (cyclePath: []). In the GraphEngine facade, DfsCycleDetector always executes
    // first to provide comprehensive cycle path reconstruction (A -> B -> C -> A).
    if (topologicalOrder.length !== graph.nodes.size) {
      return Result.fail({
        code: 'GRAPH_CYCLE_DETECTED',
        message: 'Graph contains a cycle; topological sort could not process all nodes.',
        cyclePath: [],
      });
    }

    return Result.ok(topologicalOrder);
  }
}
