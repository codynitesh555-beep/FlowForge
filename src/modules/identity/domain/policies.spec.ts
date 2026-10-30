import { describe, expect, it } from 'vitest';
import {
  assertActiveOwnerInvariant,
  assertOrganizationAccess,
  assertOrganizationRole,
  AuthorizationError,
  MembershipInvariantError,
  type OrganizationPrincipal,
} from './policies.js';

const activeOwner: OrganizationPrincipal = {
  userId: 'user-1',
  organizationId: 'org-1',
  membershipId: 'membership-1',
  role: 'OWNER',
  membershipStatus: 'ACTIVE',
};

describe('identity authorization policies', () => {
  it('accepts an active principal only for its authenticated organization', () => {
    expect(() => assertOrganizationAccess(activeOwner, 'org-1')).not.toThrow();
    expect(() => assertOrganizationAccess(activeOwner, 'org-2')).toThrowError(AuthorizationError);
  });

  it('rejects missing and inactive principals', () => {
    expect(() => assertOrganizationAccess(undefined, 'org-1')).toThrowError(
      expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    );
    expect(() => assertOrganizationAccess({ ...activeOwner, membershipStatus: 'SUSPENDED' }, 'org-1'))
      .toThrowError(expect.objectContaining({ code: 'MEMBERSHIP_INACTIVE' }));
  });

  it('enforces explicitly supplied roles without inventing role hierarchy', () => {
    expect(() => assertOrganizationRole(activeOwner, ['OWNER'])).not.toThrow();
    expect(() => assertOrganizationRole({ ...activeOwner, role: 'ADMIN' }, ['OWNER']))
      .toThrowError(expect.objectContaining({ code: 'ROLE_FORBIDDEN' }));
  });
});

describe('active owner invariant', () => {
  it('allows non-owner transitions and adding the first owner', () => {
    expect(() => assertActiveOwnerInvariant(1, { role: 'MEMBER', status: 'ACTIVE' }, { role: 'MEMBER', status: 'SUSPENDED' })).not.toThrow();
    expect(() => assertActiveOwnerInvariant(0, null, { role: 'OWNER', status: 'ACTIVE' })).not.toThrow();
  });

  it('rejects removing the last active owner but permits it when another remains', () => {
    const owner: Parameters<typeof assertActiveOwnerInvariant>[1] = { role: 'OWNER', status: 'ACTIVE' };
    expect(() => assertActiveOwnerInvariant(1, owner, { role: 'OWNER', status: 'REMOVED' }))
      .toThrowError(MembershipInvariantError);
    expect(() => assertActiveOwnerInvariant(2, owner, { role: 'OWNER', status: 'REMOVED' })).not.toThrow();
  });

  it('rejects an invalid owner count instead of treating it as safe', () => {
    expect(() => assertActiveOwnerInvariant(Number.NaN, null, { role: 'OWNER', status: 'ACTIVE' }))
      .toThrow(/non-negative safe integer/);
  });
});
