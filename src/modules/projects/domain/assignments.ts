import { ProjectTaskError } from './errors.js';

export interface AssignmentTargetMembership {
  readonly organizationId: string;
  readonly status: string;
  readonly userId: string;
}

/** Called only for a membership row selected and locked inside the assignment transaction. */
export function assertAssignmentTargetActive(
  organizationId: string,
  target: AssignmentTargetMembership | null | undefined,
): asserts target is AssignmentTargetMembership {
  if (!target || target.organizationId !== organizationId || target.status !== 'ACTIVE') {
    throw new ProjectTaskError('MEMBERSHIP_NOT_ACTIVE');
  }
}
