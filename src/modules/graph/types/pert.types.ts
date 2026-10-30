/**
 * FlowForge Graph Engine - PERT (Program Evaluation and Review Technique) Types
 */

export interface PertEstimate {
  readonly optimisticHours: number;
  readonly likelyHours: number;
  readonly pessimisticHours: number;
}

export interface PertResult {
  readonly expectedHours: number;         // mu = (O + 4L + P) / 6
  readonly standardDeviationHours: number;// sigma = (P - O) / 6
  readonly varianceHours: number;          // sigma^2
}
