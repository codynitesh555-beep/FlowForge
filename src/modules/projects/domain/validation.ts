import { z } from 'zod';
import { PertCalculator } from '../../graph/algorithms/pert-calculator.js';
import { ProjectTaskError } from './errors.js';

const estimate = z.number().finite().min(0).max(999999.9999).refine(
  (value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-7,
  'Estimate supports at most four decimal places.',
);
const name = z.string().trim().min(1).max(200);
const description = z.string().max(20_000).nullable().optional();

export const CreateProjectSchema = z.object({ name, description }).strict();
export const UpdateProjectSchema = z.object({ name: name.optional(), description }).strict().refine(
  (value) => value.name !== undefined || value.description !== undefined,
);
export const CreateTaskSchema = z.object({
  name: z.string().trim().min(1).max(240), description,
  optimisticHours: estimate, likelyHours: estimate, pessimisticHours: estimate,
}).strict();
export const UpdateTaskSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(240).optional(),
  description,
  optimisticHours: estimate.optional(), likelyHours: estimate.optional(), pessimisticHours: estimate.optional(),
}).strict().refine((value) => {
  const estimates = [value.optimisticHours, value.likelyHours, value.pessimisticHours];
  const estimateCount = estimates.filter((item) => item !== undefined).length;
  return (value.name !== undefined || value.description !== undefined || estimateCount === 3) && estimateCount !== 1 && estimateCount !== 2;
});
export const DeleteTaskSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const AddDependencySchema = z.object({ prerequisiteTaskId: z.string().uuid(), dependentTaskId: z.string().uuid() }).strict();
export const AssignTaskSchema = z.object({ membershipId: z.string().uuid() }).strict();

export function validateProjectInput<T>(schema: z.ZodType<T>, input: unknown, code: 'INVALID_PROJECT_INPUT' | 'INVALID_TASK_INPUT'): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProjectTaskError(code);
  return parsed.data;
}

export function validatePertEstimate(input: { optimisticHours: number; likelyHours: number; pessimisticHours: number }): void {
  const result = PertCalculator.calculate(input);
  if (result.isErr) throw new ProjectTaskError('INVALID_TASK_INPUT', { code: result.error.code });
}
