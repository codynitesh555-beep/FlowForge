import { describe, expect, it } from 'vitest';
import { assertAssignmentTargetActive } from './assignments.js';

describe('assignment target membership policy', () => {
  it('accepts only active memberships in the actor organization', () => {
    const userId = 'user-a';
    expect(() => assertAssignmentTargetActive('org-a', { organizationId: 'org-a', status: 'ACTIVE', userId })).not.toThrow();
    expect(() => assertAssignmentTargetActive('org-a', { organizationId: 'org-a', status: 'SUSPENDED', userId })).toThrow(/MEMBERSHIP_NOT_ACTIVE/);
    expect(() => assertAssignmentTargetActive('org-a', { organizationId: 'org-b', status: 'ACTIVE', userId })).toThrow(/MEMBERSHIP_NOT_ACTIVE/);
    expect(() => assertAssignmentTargetActive('org-a', null)).toThrow(/MEMBERSHIP_NOT_ACTIVE/);
  });
});
