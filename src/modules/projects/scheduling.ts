import { GraphEngine, type GraphAnalysisResult, type GraphError } from '../graph/index.js';
import type { Result } from '../../shared/types/result.js';
import type { ProjectGraphSnapshot } from './contracts.js';
import { compareStringDeterministic } from '../graph/index.js';

export interface SchedulingTaskRow { readonly id: string; readonly expectedHours: number; readonly deletedAt: Date | null }
export interface SchedulingDependencyRow { readonly from: string; readonly to: string; readonly removedAt: Date | null }

/** Pure adapter; persistence must supply only active, tenant-scoped graph rows. */
export function analyzeProjectSnapshot(
  snapshot: ProjectGraphSnapshot,
): Result<GraphAnalysisResult, GraphError> {
  return GraphEngine.analyze(snapshot.nodes, snapshot.edges);
}

/** Build the active graph while retaining deleted tasks and removed edges in storage history. */
export function buildActiveProjectGraph(
  graphRevision: number,
  tasks: readonly SchedulingTaskRow[],
  dependencies: readonly SchedulingDependencyRow[],
): ProjectGraphSnapshot {
  const activeTasks = tasks.filter((task) => task.deletedAt === null);
  const activeIds = new Set(activeTasks.map((task) => task.id));
  return {
    graphRevision,
    nodes: activeTasks.map((task) => {
      if (!Number.isFinite(task.expectedHours) || task.expectedHours < 0) throw new Error('INVALID_PROJECT_GRAPH');
      return { id: task.id, durationHours: task.expectedHours };
    }).sort((a, b) => compareStringDeterministic(a.id, b.id)),
    edges: dependencies.filter((dependency) => dependency.removedAt === null && activeIds.has(dependency.from) && activeIds.has(dependency.to))
      .map(({ from, to }) => ({ from, to }))
      .sort((a, b) => compareStringDeterministic(a.from, b.from) || compareStringDeterministic(a.to, b.to)),
  };
}

export function analyzeDependencyAddition(
  snapshot: ProjectGraphSnapshot,
  prerequisiteTaskId: string,
  dependentTaskId: string,
): Result<GraphAnalysisResult, GraphError> {
  return analyzeProjectSnapshot({
    ...snapshot,
    edges: [...snapshot.edges, { from: prerequisiteTaskId, to: dependentTaskId }],
  });
}
