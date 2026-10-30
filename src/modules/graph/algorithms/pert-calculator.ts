/**
 * FlowForge Graph Engine - PERT Calculator
 * Computes mean, standard deviation, and variance for three-point PERT estimates.
 */
import { Result } from '../../../shared/types/result.js';
import { PertEstimate, PertResult } from '../types/pert.types.js';
import { GraphError } from '../errors/graph.errors.js';

export class PertCalculator {
  /**
   * Computes expected mean duration, standard deviation, and variance.
   *
   * Formulas:
   *   mu = (O + 4L + P) / 6
   *   sigma = (P - O) / 6
   *   variance = sigma^2
   */
  static calculate(estimate: PertEstimate): Result<PertResult, GraphError> {
    const { optimisticHours: O, likelyHours: L, pessimisticHours: P } = estimate;

    // 1. Validation of finite non-negative numbers
    if (
      !Number.isFinite(O) || O < 0 ||
      !Number.isFinite(L) || L < 0 ||
      !Number.isFinite(P) || P < 0
    ) {
      return Result.fail({
        code: 'GRAPH_INVALID_DURATION',
        message: `PERT estimates must be finite, non-negative numbers. Received: O=${O}, L=${L}, P=${P}`,
        nodeId: 'PERT_INPUT',
        duration: NaN,
      });
    }

    // 2. Structural ordering check: O <= L <= P
    if (O > L || L > P) {
      return Result.fail({
        code: 'GRAPH_INVALID_DURATION',
        message: `PERT estimates must satisfy optimistic <= likely <= pessimistic. Received: O=${O}, L=${L}, P=${P}`,
        nodeId: 'PERT_INPUT',
        duration: O,
      });
    }

    // 3. Calculation
    const expectedHours = (O + 4 * L + P) / 6;
    const standardDeviationHours = (P - O) / 6;
    const varianceHours = Math.pow(standardDeviationHours, 2);

    // 4. Numerical overflow check
    if (
      !Number.isFinite(expectedHours) ||
      !Number.isFinite(standardDeviationHours) ||
      !Number.isFinite(varianceHours)
    ) {
      return Result.fail({
        code: 'GRAPH_NUMERICAL_OVERFLOW',
        message: 'Computed PERT values produced a numerical overflow or non-finite result.',
      });
    }

    return Result.ok({
      expectedHours,
      standardDeviationHours,
      varianceHours,
    });
  }
}
