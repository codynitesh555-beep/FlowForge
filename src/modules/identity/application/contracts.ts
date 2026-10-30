import type {
  MembershipState,
  OrganizationPrincipal,
} from '../domain/policies.js';

export interface MembershipRecord extends MembershipState {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
}

export interface MembershipChange {
  readonly role: MembershipRecord['role'];
  readonly status: MembershipRecord['status'];
}

/**
 * Transaction-scoped port. Implementations must use one Prisma transaction
 * client for every method and honor the lock sequence documented in
 * PHASE_1A.1_FUTURE_INVARIANTS.md.
 */
export interface MembershipLifecycleUnitOfWork {
  /** SELECT the organization row FOR UPDATE; call before all other methods. */
  lockOrganization(organizationId: string): Promise<boolean>;
  /** Lock requested membership rows with ORDER BY id ASC FOR UPDATE. */
  lockMembershipsInIdOrder(organizationId: string, membershipIds: readonly string[]): Promise<void>;
  /** Read after the organization lock so lifecycle counts serialize. */
  countActiveOwners(organizationId: string): Promise<number>;
  findMembership(organizationId: string, membershipId: string): Promise<MembershipRecord | null>;
  updateMembership(organizationId: string, membershipId: string, change: MembershipChange): Promise<MembershipRecord>;
  /** Release active assignments in ascending assignment ID order in this transaction. */
  releaseAssignmentsForMembership(actor: OrganizationPrincipal, membershipId: string): Promise<void>;
}

export interface MembershipLifecycleTransactions {
  run<T>(work: (transaction: MembershipLifecycleUnitOfWork) => Promise<T>): Promise<T>;
}

/**
 * Application contract deliberately leaves role-to-action policy open for
 * owner approval. Organization scope is derived from the authenticated actor.
 */
export interface MembershipLifecycleService {
  changeMembership(
    actor: OrganizationPrincipal,
    membershipId: string,
    change: MembershipChange,
  ): Promise<MembershipRecord>;
}

export interface MembershipChangeAuthorizer {
  assertCanChangeMembership(
    actor: OrganizationPrincipal,
    target: MembershipRecord,
    change: MembershipChange,
  ): Promise<void>;
}
