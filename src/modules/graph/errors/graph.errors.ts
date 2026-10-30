/**
 * FlowForge Graph Engine - Domain Error Contracts
 */
import { GraphEdge } from '../types/graph.types.js';

export interface GraphCycleError {
  readonly code: 'GRAPH_CYCLE_DETECTED';
  readonly message: string;
  readonly cyclePath: string[];
}

export interface GraphMissingNodeError {
  readonly code: 'GRAPH_MISSING_NODE';
  readonly message: string;
  readonly missingNodeId: string;
  readonly edge: GraphEdge;
}

export interface GraphInvalidDurationError {
  readonly code: 'GRAPH_INVALID_DURATION';
  readonly message: string;
  readonly nodeId: string;
  readonly duration: number;
}

export interface GraphDuplicateNodeIdError {
  readonly code: 'GRAPH_DUPLICATE_NODE_ID';
  readonly message: string;
  readonly nodeId: string;
}

export interface GraphEmptyNodeIdError {
  readonly code: 'GRAPH_EMPTY_NODE_ID';
  readonly message: string;
}

export interface GraphNumericalOverflowError {
  readonly code: 'GRAPH_NUMERICAL_OVERFLOW';
  readonly message: string;
  readonly detail?: string;
}

export type GraphError =
  | GraphCycleError
  | GraphMissingNodeError
  | GraphInvalidDurationError
  | GraphDuplicateNodeIdError
  | GraphEmptyNodeIdError
  | GraphNumericalOverflowError;
