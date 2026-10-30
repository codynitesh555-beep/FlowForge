import { assertActiveOwnerInvariant, assertOrganizationAccess } from '../domain/policies.js';
import type {
  MembershipChange,
  MembershipChangeAuthorizer,
  MembershipLifecycleService,
  MembershipLifecycleTransactions,
  MembershipRecord,
} from './contracts.js';

export class MembershipNotFoundError extends Error {
  readonly name = 'MembershipNotFoundError';
  constructor() { super('MEMBERSHIP_NOT_FOUND'); }
}

/**
 * Membership lifecycle orchestration. Storage and role policy are injected;
 * the transaction port must implement the SQL locking contract in Phase 1A.1.
 */
export class DefaultMembershipLifecycleService implements MembershipLifecycleService {
  constructor(
    private readonly transactions: MembershipLifecycleTransactions,
    private readonly authorizer: MembershipChangeAuthorizer,
  ) {}

  changeMembership(
    actor: Parameters<MembershipLifecycleService['changeMembership']>[0],
    membershipId: string,
    change: MembershipChange,
  ): Promise<MembershipRecord> {
    assertOrganizationAccess(actor, actor.organizationId);

    return this.transactions.run(async (transaction) => {
      const organizationExists = await transaction.lockOrganization(actor.organizationId);
      if (!organizationExists) throw new MembershipNotFoundError();

      await transaction.lockMembershipsInIdOrder(actor.organizationId, [membershipId]);
      const current = await transaction.findMembership(actor.organizationId, membershipId);
      if (!current) throw new MembershipNotFoundError();

      await this.authorizer.assertCanChangeMembership(actor, current, change);

      const activeOwnerCount = await transaction.countActiveOwners(actor.organizationId);
      assertActiveOwnerInvariant(activeOwnerCount, current, change);

      const updated = await transaction.updateMembership(actor.organizationId, membershipId, change);
      if (current.status === 'ACTIVE' && change.status !== 'ACTIVE') {
        await transaction.releaseAssignmentsForMembership(actor, membershipId);
      }
      return updated;
    });
  }
}
