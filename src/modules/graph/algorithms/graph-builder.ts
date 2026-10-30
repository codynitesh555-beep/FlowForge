/**
 * FlowForge Graph Engine - Graph Builder
 * Validates structural invariants and builds deterministic adjacency structures.
 */
import { Result } from '../../../shared/types/result.js';
import { GraphNode, GraphEdge, DependencyGraph } from '../types/graph.types.js';
import { GraphError } from '../errors/graph.errors.js';
import { compareStringDeterministic } from '../utils/comparator.js';

export class GraphBuilder {
  /**
   * Validates inputs and constructs an in-memory DependencyGraph.
   * Returns a Result containing the graph or a structured GraphError.
   *
   * Time Complexity: O(V log V + E log(deg_max))
   * Space Complexity: O(V + E)
   */
  static build(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[]
  ): Result<DependencyGraph, GraphError> {
    const nodesMap = new Map<string, GraphNode>();
    const adjacencySets = new Map<string, Set<string>>();
    const reverseAdjacencySets = new Map<string, Set<string>>();

    // 1. Process and validate nodes
    for (const node of nodes) {
      if (!node.id || node.id.trim() === '') {
        return Result.fail({
          code: 'GRAPH_EMPTY_NODE_ID',
          message: 'Node ID cannot be empty or whitespace.',
        });
      }

      if (nodesMap.has(node.id)) {
        return Result.fail({
          code: 'GRAPH_DUPLICATE_NODE_ID',
          message: `Duplicate node ID detected: "${node.id}".`,
          nodeId: node.id,
        });
      }

      if (
        typeof node.durationHours !== 'number' ||
        Number.isNaN(node.durationHours) ||
        !Number.isFinite(node.durationHours) ||
        node.durationHours < 0
      ) {
        return Result.fail({
          code: 'GRAPH_INVALID_DURATION',
          message: `Invalid duration for node "${node.id}": ${node.durationHours}. Duration must be a finite, non-negative number.`,
          nodeId: node.id,
          duration: node.durationHours,
        });
      }

      nodesMap.set(node.id, node);
      adjacencySets.set(node.id, new Set<string>());
      reverseAdjacencySets.set(node.id, new Set<string>());
    }

    // 2. Process and validate edges
    for (const edge of edges) {
      // Check for self-loop
      if (edge.from === edge.to) {
        return Result.fail({
          code: 'GRAPH_CYCLE_DETECTED',
          message: `Self-dependency detected: "${edge.from}" -> "${edge.to}".`,
          cyclePath: [edge.from, edge.to],
        });
      }

      // Check referential integrity
      if (!nodesMap.has(edge.from)) {
        return Result.fail({
          code: 'GRAPH_MISSING_NODE',
          message: `Edge references non-existent prerequisite node: "${edge.from}".`,
          missingNodeId: edge.from,
          edge,
        });
      }

      if (!nodesMap.has(edge.to)) {
        return Result.fail({
          code: 'GRAPH_MISSING_NODE',
          message: `Edge references non-existent dependent node: "${edge.to}".`,
          missingNodeId: edge.to,
          edge,
        });
      }

      // Automatically deduplicate edges using Sets
      adjacencySets.get(edge.from)!.add(edge.to);
      reverseAdjacencySets.get(edge.to)!.add(edge.from);
    }

    // 3. Finalize sorted adjacency lists and degrees
    const adjacency = new Map<string, readonly string[]>();
    const reverseAdjacency = new Map<string, readonly string[]>();
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const [nodeId, successors] of adjacencySets.entries()) {
      const sortedSuccessors = Array.from(successors).sort(compareStringDeterministic);
      adjacency.set(nodeId, Object.freeze(sortedSuccessors));
      outDegree.set(nodeId, sortedSuccessors.length);
    }

    for (const [nodeId, predecessors] of reverseAdjacencySets.entries()) {
      const sortedPredecessors = Array.from(predecessors).sort(compareStringDeterministic);
      reverseAdjacency.set(nodeId, Object.freeze(sortedPredecessors));
      inDegree.set(nodeId, sortedPredecessors.length);
    }

    return Result.ok({
      nodes: nodesMap,
      adjacency,
      reverseAdjacency,
      inDegree,
      outDegree,
    });
  }
}
