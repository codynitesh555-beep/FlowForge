import { describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { OrganizationPrincipal } from '../domain/policies.js';
import { DefaultMembershipLifecycleService } from '../application/membership-lifecycle.service.js';
import type { MembershipRecord } from '../application/contracts.js';
import { PrismaMembershipLifecycleTransactions } from './prisma-membership-lifecycle.js';

const organizationId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152';
const projectId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154';
const actor: OrganizationPrincipal = {
  userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151', organizationId,
  membershipId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd153', role: 'OWNER', membershipStatus: 'ACTIVE',
};
const target: MembershipRecord = {
  id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', organizationId,
  userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd156', role: 'MEMBER', status: 'ACTIVE',
};

type Assignment = { id: string; taskId: string; projectId: string; organizationId: string; membershipId: string; userId: string; unassignedAt: Date | null };
type State = {
  membership: MembershipRecord;
  assignments: Assignment[];
  activity: Array<{ data: Record<string, unknown> }>;
  outbox: Array<{ data: Record<string, unknown> }>;
};
function cloneState(state: State): State {
  return {
    membership: { ...state.membership },
    assignments: state.assignments.map((row) => ({ ...row })),
    activity: state.activity.map((row) => ({ data: { ...row.data } })),
    outbox: state.outbox.map((row) => ({ data: { ...row.data } })),
  };
}
const assignment = (n: number): Assignment => ({
  id: `2a3ebad4-60cf-4cdb-8e1c-${String(n).padStart(12, '0')}`,
  taskId: `3a3ebad4-60cf-4cdb-8e1c-${String(n).padStart(12, '0')}`,
  projectId, organizationId, membershipId: target.id, userId: target.userId, unassignedAt: null,
});

function makeHarness(seed: Assignment[] = [], options: { failActivity?: boolean; failOutbox?: boolean } = {}) {
  let committed: State = { membership: { ...target }, assignments: seed.map((row) => ({ ...row })), activity: [], outbox: [] };
  let transactionDraft: State | undefined;
  const txState = (): State => {
    if (!transactionDraft) throw new Error('Fake transaction delegate used outside a transaction.');
    return transactionDraft;
  };
  const transaction = {
    $queryRaw: async (query: Prisma.Sql): Promise<unknown[]> => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: target.id }];
      if (query.sql.includes('FROM "task_assignments"')) return txState().assignments
        .filter((row) => row.membershipId === target.id && row.organizationId === organizationId && row.unassignedAt === null)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, taskId, projectId: pId, userId, membershipId }) => ({ id, taskId, projectId: pId, userId, membershipId }));
      return [];
    },
    membership: {
      count: async () => 2,
      findFirst: async () => ({ ...txState().membership }),
      updateMany: async ({ where, data }: {
        where: { organizationId: string; id: string };
        data: Pick<MembershipRecord, 'role' | 'status'>;
      }) => {
        const state = txState();
        if (where.organizationId !== state.membership.organizationId || where.id !== state.membership.id) return { count: 0 };
        state.membership = { ...state.membership, ...data };
        return { count: 1 };
      },
    },
    taskAssignment: {
      updateMany: async ({ where, data }: {
        where: { organizationId: string; membershipId: string; id: { in: string[] }; unassignedAt: null };
        data: { unassignedAt: Date };
      }) => {
        const active = txState().assignments.filter((row) => row.organizationId === where.organizationId
          && row.membershipId === where.membershipId && where.id.in.includes(row.id) && row.unassignedAt === null);
        for (const row of active) row.unassignedAt = data.unassignedAt;
        return { count: active.length };
      },
    },
    user: { findUnique: async () => ({ displayName: 'Audit Actor' }) },
    activityLog: { create: async (args: { data: Record<string, unknown> }) => {
      txState().activity.push(args);
      if (options.failActivity) throw new Error('activity write failed');
      return {};
    } },
    outboxEvent: { create: async (args: { data: Record<string, unknown> }) => {
      txState().outbox.push(args);
      if (options.failOutbox) throw new Error('outbox write failed');
      return {};
    } },
  };
  const client = {
    $transaction: async <T>(work: (tx: typeof transaction) => Promise<T>): Promise<T> => {
      const draft = cloneState(committed);
      transactionDraft = draft;
      try {
        const result = await work(transaction);
        committed = draft;
        return result;
      } finally {
        transactionDraft = undefined;
      }
    },
  } as unknown as PrismaClient;
  const service = new DefaultMembershipLifecycleService(new PrismaMembershipLifecycleTransactions(client), {
    assertCanChangeMembership: async () => undefined,
  });
  const deactivate = () => service.changeMembership(actor, target.id, { role: 'MEMBER', status: 'SUSPENDED' });
  return { get committed() { return committed; }, deactivate };
}

describe('PrismaMembershipLifecycleTransactions assignment release events', () => {
  it('releases one active assignment and writes matching audit and outbox records', async () => {
    const h = makeHarness([assignment(1)]);
    await h.deactivate();
    expect(h.committed.membership.status).toBe('SUSPENDED');
    expect(h.committed.assignments[0]?.unassignedAt).toBeInstanceOf(Date);
    expect(h.committed.activity.map(({ data }) => data)).toEqual([expect.objectContaining({
      organizationId, actorUserId: actor.userId, actorDisplayName: 'Audit Actor', action: 'assignment.removed',
      aggregateType: 'assignment', aggregateId: assignment(1).id,
      payload: { projectId, taskId: assignment(1).taskId, membershipId: target.id, userId: target.userId, reason: 'membership_deactivated' },
    })]);
    expect(h.committed.outbox.map(({ data }) => data)).toEqual([expect.objectContaining({
      organizationId, aggregateType: 'assignment', aggregateId: assignment(1).id, eventType: 'assignment.removed',
      payload: { projectId, taskId: assignment(1).taskId, membershipId: target.id, userId: target.userId, reason: 'membership_deactivated' },
    })]);
  });

  it('writes one event pair for each of multiple active assignments in ID order', async () => {
    const rows = [assignment(2), assignment(1)];
    const h = makeHarness(rows);
    await h.deactivate();
    expect(h.committed.assignments.every((row) => row.unassignedAt instanceof Date)).toBe(true);
    expect(h.committed.activity.map(({ data }) => data.aggregateId)).toEqual([assignment(1).id, assignment(2).id]);
    expect(h.committed.outbox.map(({ data }) => data.aggregateId)).toEqual([assignment(1).id, assignment(2).id]);
  });

  it('writes no assignment events when there are no active assignments', async () => {
    const h = makeHarness([]);
    await h.deactivate();
    expect(h.committed.activity).toHaveLength(0);
    expect(h.committed.outbox).toHaveLength(0);
  });

  it('does not duplicate release events for assignments already released', async () => {
    const released = { ...assignment(1), unassignedAt: new Date('2026-01-01T00:00:00.000Z') };
    const h = makeHarness([released]);
    await h.deactivate();
    expect(h.committed.assignments[0]?.unassignedAt).toEqual(released.unassignedAt);
    expect(h.committed.activity).toHaveLength(0);
    expect(h.committed.outbox).toHaveLength(0);
  });

  it('does not emit duplicate assignment release events when deactivation is repeated', async () => {
    const h = makeHarness([assignment(1)]);
    await h.deactivate();
    const firstActivityCount = h.committed.activity.length;
    const firstOutboxCount = h.committed.outbox.length;
    await h.deactivate();
    expect(firstActivityCount).toBe(1);
    expect(firstOutboxCount).toBe(1);
    expect(h.committed.activity).toHaveLength(1);
    expect(h.committed.outbox).toHaveLength(1);
  });

  it.each(['activity', 'outbox'] as const)('rejects and rolls back fake state when the %s event write fails', async (failure) => {
    const h = makeHarness([assignment(1)], failure === 'activity' ? { failActivity: true } : { failOutbox: true });
    const before = structuredClone(h.committed);
    await expect(h.deactivate()).rejects.toThrow(`${failure} write failed`);
    expect(h.committed.membership.status).toBe(before.membership.status);
    expect(h.committed.assignments.map(({ unassignedAt }) => unassignedAt)).toEqual(before.assignments.map(({ unassignedAt }) => unassignedAt));
    expect(h.committed.activity).toEqual(before.activity);
    expect(h.committed.outbox).toEqual(before.outbox);
  });
});
