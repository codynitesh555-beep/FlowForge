import { describe, it, expect } from 'vitest';
import { PertCalculator } from './pert-calculator.js';

describe('PertCalculator', () => {
  it('should accurately calculate PERT metrics for standard distribution', () => {
    const res = PertCalculator.calculate({
      optimisticHours: 4,
      likelyHours: 8,
      pessimisticHours: 18,
    });

    expect(res.isOk).toBe(true);
    const result = res.unwrap();

    // mu = (4 + 4*8 + 18) / 6 = 54 / 6 = 9
    expect(result.expectedHours).toBe(9);
    // sigma = (18 - 4) / 6 = 14 / 6
    expect(result.standardDeviationHours).toBeCloseTo(14 / 6, 6);
    // variance = sigma^2 = (14/6)^2
    expect(result.varianceHours).toBeCloseTo(Math.pow(14 / 6, 2), 6);
  });

  it('should handle zero-duration milestones', () => {
    const res = PertCalculator.calculate({
      optimisticHours: 0,
      likelyHours: 0,
      pessimisticHours: 0,
    });

    expect(res.isOk).toBe(true);
    const result = res.unwrap();
    expect(result.expectedHours).toBe(0);
    expect(result.standardDeviationHours).toBe(0);
    expect(result.varianceHours).toBe(0);
  });

  it('should handle single-point certainty (O == L == P)', () => {
    const res = PertCalculator.calculate({
      optimisticHours: 12,
      likelyHours: 12,
      pessimisticHours: 12,
    });

    expect(res.isOk).toBe(true);
    const result = res.unwrap();
    expect(result.expectedHours).toBe(12);
    expect(result.standardDeviationHours).toBe(0);
    expect(result.varianceHours).toBe(0);
  });

  it('should reject invalid bounds where optimistic > likely or likely > pessimistic', () => {
    const res1 = PertCalculator.calculate({
      optimisticHours: 10,
      likelyHours: 8,
      pessimisticHours: 12,
    });
    expect(res1.isErr).toBe(true);
    expect(res1.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_INVALID_DURATION');

    const res2 = PertCalculator.calculate({
      optimisticHours: 5,
      likelyHours: 15,
      pessimisticHours: 10,
    });
    expect(res2.isErr).toBe(true);
    expect(res2.match({ ok: () => null, err: (e) => e.code })).toBe('GRAPH_INVALID_DURATION');
  });

  it('should reject negative, NaN, and Infinite values', () => {
    expect(PertCalculator.calculate({ optimisticHours: -1, likelyHours: 5, pessimisticHours: 10 }).isErr).toBe(true);
    expect(PertCalculator.calculate({ optimisticHours: NaN, likelyHours: 5, pessimisticHours: 10 }).isErr).toBe(true);
    expect(PertCalculator.calculate({ optimisticHours: 5, likelyHours: Infinity, pessimisticHours: 10 }).isErr).toBe(true);
  });
});
