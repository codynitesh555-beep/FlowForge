export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

/** Must be created by trusted authentication middleware, never request data. */
export interface OrganizationPrincipal {
  readonly userId: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly role: OrganizationRole;
  readonly membershipStatus: MembershipStatus;
}

export interface MembershipState {
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
}

export class AuthorizationError extends Error {
  readonly name = 'AuthorizationError';
  constructor(readonly code: 'AUTHENTICATION_REQUIRED' | 'ORGANIZATION_SCOPE_MISMATCH' | 'MEMBERSHIP_INACTIVE' | 'ROLE_FORBIDDEN') {
    super(code);
  }
}

export class MembershipInvariantError extends Error {
  readonly name = 'MembershipInvariantError';
  constructor(readonly code: 'ACTIVE_OWNER_REQUIRED') {
    super(code);
  }
}

/** Checks the server-derived principal against a route's organization scope. */
export function assertOrganizationAccess(
  principal: OrganizationPrincipal | null | undefined,
  organizationId: string,
): asserts principal is OrganizationPrincipal {
  if (!principal) throw new AuthorizationError('AUTHENTICATION_REQUIRED');
  if (principal.membershipStatus !== 'ACTIVE') throw new AuthorizationError('MEMBERSHIP_INACTIVE');
  if (principal.organizationId !== organizationId) throw new AuthorizationError('ORGANIZATION_SCOPE_MISMATCH');
}

/** Role policy is explicit at each call site; no implicit role hierarchy. */
export function assertOrganizationRole(
  principal: OrganizationPrincipal,
  allowedRoles: readonly OrganizationRole[],
): void {
  if (!allowedRoles.includes(principal.role)) throw new AuthorizationError('ROLE_FORBIDDEN');
}

/**
 * Apply a proposed membership state while holding the organization
 * serialization lock. `activeOwnerCount` is read after that lock is acquired.
 */
export function assertActiveOwnerInvariant(
  activeOwnerCount: number,
  current: MembershipState | null,
  next: MembershipState,
): void {
  if (!Number.isSafeInteger(activeOwnerCount) || activeOwnerCount < 0) {
    throw new RangeError('activeOwnerCount must be a non-negative safe integer.');
  }

  const currentIsActiveOwner = current?.role === 'OWNER' && current.status === 'ACTIVE';
  const nextIsActiveOwner = next.role === 'OWNER' && next.status === 'ACTIVE';
  const result = activeOwnerCount - Number(currentIsActiveOwner) + Number(nextIsActiveOwner);
  if (result < 1) throw new MembershipInvariantError('ACTIVE_OWNER_REQUIRED');
}
