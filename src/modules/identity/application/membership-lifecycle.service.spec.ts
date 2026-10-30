import { describe, expect, it, vi } from 'vitest';
import type {
  MembershipLifecycleTransactions,
  MembershipLifecycleUnitOfWork,
  MembershipRecord,
} from './contracts.js';
import { DefaultMembershipLifecycleService } from './membership-lifecycle.service.js';
import { MembershipInvariantError } from '../domain/policies.js';

const actor = {
  userId: 'actor-1', organizationId: 'org-1', membershipId: 'actor-membership',
  role: 'OWNER' as const, membershipStatus: 'ACTIVE' as const,
};
const member: MembershipRecord = {
  id: 'member-1', organizationId: 'org-1', userId: 'user-2', role: 'MEMBER', status: 'ACTIVE',
};

function createHarness(current = member, activeOwners = 1) {
  const order: string[] = [];
  const transaction: MembershipLifecycleUnitOfWork = {
    lockOrganization: vi.fn(async () => { order.push('organization-lock'); return true; }),
    lockMembershipsInIdOrder: vi.fn(async (_org, ids) => { order.push(`membership-lock:${ids.join(',')}`); }),
    countActiveOwners: vi.fn(async () => { order.push('owner-count'); return activeOwners; }),
    findMembership: vi.fn(async () => { order.push('find-membership'); return current; }),
    updateMembership: vi.fn(async (_org, _id, change) => {
      order.push('update-membership');
      return { ...current, ...change };
    }),
    releaseAssignmentsForMembership: vi.fn(async () => { order.push('release-assignments'); }),
  };
  const transactions: MembershipLifecycleTransactions = {
    run: vi.fn(async (work) => work(transaction)),
  };
  const authorizer = { assertCanChangeMembership: vi.fn(async () => { order.push('authorize'); }) };
  return { service: new DefaultMembershipLifecycleService(transactions, authorizer), transaction, transactions, authorizer, order };
}

describe('DefaultMembershipLifecycleService', () => {
  it('locks organization then membership, checks policy and persists within one transaction', async () => {
    const harness = createHarness();
    await harness.service.changeMembership(actor, member.id, { role: 'MEMBER', status: 'SUSPENDED' });
    expect(harness.transactions.run).toHaveBeenCalledOnce();
    expect(harness.order).toEqual([
      'organization-lock', 'membership-lock:member-1', 'find-membership',
      'authorize', 'owner-count', 'update-membership', 'release-assignments',
    ]);
    expect(harness.transaction.releaseAssignmentsForMembership).toHaveBeenCalledOnce();
  });

  it('rejects removing the last active owner before any mutation', async () => {
    const owner: MembershipRecord = { ...member, role: 'OWNER' };
    const harness = createHarness(owner, 1);
    await expect(harness.service.changeMembership(actor, owner.id, { role: 'OWNER', status: 'REMOVED' }))
      .rejects.toBeInstanceOf(MembershipInvariantError);
    expect(harness.transaction.updateMembership).not.toHaveBeenCalled();
    expect(harness.transaction.releaseAssignmentsForMembership).not.toHaveBeenCalled();
  });

  it('does not release assignments for an active-to-active role change', async () => {
    const harness = createHarness(member, 1);
    await harness.service.changeMembership(actor, member.id, { role: 'ADMIN', status: 'ACTIVE' });
    expect(harness.transaction.releaseAssignmentsForMembership).not.toHaveBeenCalled();
  });

  it('stops before membership access when the organization is absent', async () => {
    const harness = createHarness();
    vi.mocked(harness.transaction.lockOrganization).mockResolvedValue(false);
    await expect(harness.service.changeMembership(actor, member.id, { role: 'MEMBER', status: 'SUSPENDED' }))
      .rejects.toThrow('MEMBERSHIP_NOT_FOUND');
    expect(harness.transaction.lockMembershipsInIdOrder).not.toHaveBeenCalled();
  });
});
