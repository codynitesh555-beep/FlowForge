/**
 * FlowForge Graph Engine - Iterative DFS Cycle Detector
 * Three-color DFS traversal using an explicit heap-allocated stack.
 *
 * Guarantees:
 * - O(V + E) time and space complexity.
 * - Deterministic first cycle reporting.
 * - Call stack safety for arbitrary graph depth (no recursion).
 */
import { DependencyGraph } from '../types/graph.types.js';
import { compareStringDeterministic } from '../utils/comparator.js';

export interface CycleDetectorResult {
  readonly hasCycle: boolean;
  readonly cyclePath?: string[];
}

const enum NodeColor {
  WHITE = 0, // Unvisited
  GRAY = 1,  // Currently in active recursion / stack path
  BLACK = 2, // Fully explored
}

interface DfsFrame {
  readonly nodeId: string;
  neighborIndex: number;
}

export class DfsCycleDetector {
  /**
   * Detects cycles in the DependencyGraph and extracts the exact closed loop path.
   * Node iteration and neighbor traversals are strictly deterministic.
   */
  static detectCycle(graph: DependencyGraph): CycleDetectorResult {
    const colors = new Map<string, NodeColor>();
    const parentMap = new Map<string, string>();

    for (const nodeId of graph.nodes.keys()) {
      colors.set(nodeId, NodeColor.WHITE);
    }

    // Sort all starting nodes lexicographically for deterministic traversal
    const sortedNodeIds = Array.from(graph.nodes.keys()).sort(compareStringDeterministic);

    for (const startNodeId of sortedNodeIds) {
      if (colors.get(startNodeId) !== NodeColor.WHITE) {
        continue;
      }

      // Initialize iterative stack
      colors.set(startNodeId, NodeColor.GRAY);
      const stack: DfsFrame[] = [{ nodeId: startNodeId, neighborIndex: 0 }];

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const neighbors = graph.adjacency.get(top.nodeId) ?? [];

        if (top.neighborIndex < neighbors.length) {
          const neighbor = neighbors[top.neighborIndex]!;
          top.neighborIndex++;

          const neighborColor = colors.get(neighbor) ?? NodeColor.WHITE;

          if (neighborColor === NodeColor.GRAY) {
            // Cycle detected: neighbor is on the current DFS path
            const cyclePath = DfsCycleDetector.reconstructCycle(top.nodeId, neighbor, parentMap);
            return {
              hasCycle: true,
              cyclePath,
            };
          }

          if (neighborColor === NodeColor.WHITE) {
            // Forward edge to unvisited node
            parentMap.set(neighbor, top.nodeId);
            colors.set(neighbor, NodeColor.GRAY);
            stack.push({ nodeId: neighbor, neighborIndex: 0 });
          }
        } else {
          // All neighbors explored; backtrack
          colors.set(top.nodeId, NodeColor.BLACK);
          stack.pop();
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Reconstructs the closed cycle loop from current node back to the target node.
   * Path shape: [target, ..., current, target]
   */
  private static reconstructCycle(
    current: string,
    target: string,
    parentMap: Map<string, string>
  ): string[] {
    const path: string[] = [current];
    let curr = current;

    while (curr !== target) {
      const parent = parentMap.get(curr);
      if (!parent) {
        // Defensive fallback in case parent mapping is missing
        break;
      }
      curr = parent;
      path.push(curr);
    }

    path.reverse();
    path.push(target); // Complete the closed loop
    return path;
  }
}
