/**
 * FlowForge Graph Engine - Core Graph Types
 */

export interface GraphNode {
  readonly id: string;
  readonly durationHours: number;
}

export interface GraphEdge {
  readonly from: string; // prerequisiteId
  readonly to: string;   // dependentId
}

export interface DependencyGraph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly adjacency: ReadonlyMap<string, readonly string[]>;        // from -> sorted successors
  readonly reverseAdjacency: ReadonlyMap<string, readonly string[]>; // to -> sorted predecessors
  readonly inDegree: ReadonlyMap<string, number>;
  readonly outDegree: ReadonlyMap<string, number>;
}
