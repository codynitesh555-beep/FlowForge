/**
 * FlowForge Graph Engine - Orchestration Facade
 *
 * Single deterministic entry point for graph validation, cycle detection,
 * topological sorting, and critical path analysis.
 */
import { Result } from '../../../shared/types/result.js';
import { GraphNode, GraphEdge } from '../types/graph.types.js';
import { GraphAnalysisConfig, GraphAnalysisResult } from '../types/cpm.types.js';
import { PertEstimate, PertResult } from '../types/pert.types.js';
import { GraphError } from '../errors/graph.errors.js';
import { GraphBuilder } from '../algorithms/graph-builder.js';
import { DfsCycleDetector } from '../algorithms/dfs-cycle-detector.js';
import { KahnsTopologicalSort } from '../algorithms/kahns-topological-sort.js';
import { CpmCalculator } from '../algorithms/cpm-calculator.js';
import { CriticalPathAnalyzer } from '../algorithms/critical-path-analyzer.js';
import { PertCalculator } from '../algorithms/pert-calculator.js';

export class GraphEngine {
  /**
   * Analyzes a complete project task graph and returns deterministic CPM metrics.
   * Zero database dependencies, pure in-memory execution.
   */
  static analyze(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    config: GraphAnalysisConfig = {}
  ): Result<GraphAnalysisResult, GraphError> {
    // 1. Build and validate graph structure
    const buildResult = GraphBuilder.build(nodes, edges);
    if (buildResult.isErr) {
      return Result.fail(buildResult.error);
    }
    const graph = buildResult.unwrap();

    // 2. Cycle detection via 3-color iterative DFS
    const cycleResult = DfsCycleDetector.detectCycle(graph);
    if (cycleResult.hasCycle && cycleResult.cyclePath) {
      return Result.fail({
        code: 'GRAPH_CYCLE_DETECTED',
        message: `Dependency graph contains a directed cycle: ${cycleResult.cyclePath.join(' -> ')}`,
        cyclePath: cycleResult.cyclePath,
      });
    }

    // 3. Deterministic Topological Sort via Kahn's with Min-Heap
    const topoResult = KahnsTopologicalSort.sort(graph);
    if (topoResult.isErr) {
      return Result.fail(topoResult.error);
    }
    const topologicalOrder = topoResult.unwrap();

    // 4. CPM Two-Pass Calculations (ES, EF, LS, LF, Slack)
    const cpmResult = CpmCalculator.calculate(graph, topologicalOrder);
    if (cpmResult.isErr) {
      return Result.fail(cpmResult.error);
    }
    const { projectDurationHours, taskMetrics } = cpmResult.unwrap();

    // 5. Critical Subgraph & Bounded Path Search
    const maxPaths = config.maxCriticalPaths ?? 10;
    const pathAnalysis = CriticalPathAnalyzer.analyze(
      graph,
      taskMetrics,
      projectDurationHours,
      maxPaths
    );

    return Result.ok({
      isValidDAG: true,
      topologicalOrder,
      projectDurationHours,
      criticalTaskIds: pathAnalysis.criticalTaskIds,
      criticalSubgraph: pathAnalysis.criticalSubgraph,
      criticalPaths: pathAnalysis.criticalPaths,
      isCriticalPathsTruncated: pathAnalysis.isCriticalPathsTruncated,
      taskMetrics,
    });
  }

  /**
   * Calculates PERT expected duration, standard deviation, and variance.
   */
  static calculatePert(estimate: PertEstimate): Result<PertResult, GraphError> {
    return PertCalculator.calculate(estimate);
  }

  /**
   * Fast standalone cycle check for prospective edge additions.
   */
  static validateAcyclic(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[]
  ): Result<true, GraphError> {
    const buildResult = GraphBuilder.build(nodes, edges);
    if (buildResult.isErr) {
      return Result.fail(buildResult.error);
    }

    const cycleResult = DfsCycleDetector.detectCycle(buildResult.unwrap());
    if (cycleResult.hasCycle && cycleResult.cyclePath) {
      return Result.fail({
        code: 'GRAPH_CYCLE_DETECTED',
        message: `Adding this dependency creates a circular loop: ${cycleResult.cyclePath.join(' -> ')}`,
        cyclePath: cycleResult.cyclePath,
      });
    }

    return Result.ok(true);
  }
}
