/**
 * FlowForge Graph Engine - Critical Path Method (CPM) Types
 */

export interface TaskCpmMetrics {
  readonly taskId: string;
  readonly earlyStartHours: number;  // ES
  readonly earlyFinishHours: number; // EF
  readonly lateStartHours: number;   // LS
  readonly lateFinishHours: number;  // LF
  readonly totalSlackHours: number;  // LS - ES (normalized to 0 if |totalSlack| < EPSILON)
  readonly freeSlackHours: number;   // 0 for sink nodes; min(ES_successors) - EF otherwise
  readonly isCritical: boolean;      // |totalSlackHours| < EPSILON
}

export interface GraphAnalysisConfig {
  /** Maximum number of critical paths to enumerate. Defaults to 10. */
  readonly maxCriticalPaths?: number;
}

export interface GraphAnalysisResult {
  readonly isValidDAG: true;
  readonly topologicalOrder: string[];
  readonly projectDurationHours: number;

  /** Set of all task IDs lying on any critical path */
  readonly criticalTaskIds: ReadonlySet<string>;

  /** The directed critical subgraph edges: u -> successors in G_c */
  readonly criticalSubgraph: ReadonlyMap<string, readonly string[]>;

  /** Enumerated critical paths up to maxCriticalPaths */
  readonly criticalPaths: string[][];

  /** True if more than maxCriticalPaths exist in the graph */
  readonly isCriticalPathsTruncated: boolean;

  /** Calculated CPM metrics for each task in the graph */
  readonly taskMetrics: ReadonlyMap<string, TaskCpmMetrics>;
}
