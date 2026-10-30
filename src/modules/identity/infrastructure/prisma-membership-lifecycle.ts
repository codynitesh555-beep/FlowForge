import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  MembershipLifecycleTransactions,
  MembershipLifecycleUnitOfWork,
  MembershipChange,
  MembershipRecord,
} from '../application/contracts.js';
import type { OrganizationPrincipal } from '../domain/policies.js';
import { withTransaction } from '../../../infrastructure/database/transaction.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error('Expected a UUID identifier.');
}

class PrismaMembershipLifecycleUnitOfWork implements MembershipLifecycleUnitOfWork {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async lockOrganization(organizationId: string): Promise<boolean> {
    requireUuid(organizationId);
    const rows = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "organizations" WHERE "id" = ${organizationId}::uuid FOR UPDATE
    `);
    return rows.length === 1;
  }

  async lockMembershipsInIdOrder(organizationId: string, membershipIds: readonly string[]): Promise<void> {
    requireUuid(organizationId);
    const ids = [...new Set(membershipIds)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    for (const id of ids) requireUuid(id);
    if (ids.length === 0) return;
    await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "memberships"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id" ASC FOR UPDATE
    `);
  }

  countActiveOwners(organizationId: string): Promise<number> {
    requireUuid(organizationId);
    return this.transaction.membership.count({
      where: { organizationId, role: 'OWNER', status: 'ACTIVE' },
    });
  }

  async findMembership(organizationId: string, membershipId: string): Promise<MembershipRecord | null> {
    requireUuid(organizationId);
    requireUuid(membershipId);
    return this.transaction.membership.findFirst({
      where: { organizationId, id: membershipId },
      select: { id: true, organizationId: true, userId: true, role: true, status: true },
    });
  }

  async updateMembership(organizationId: string, membershipId: string, change: MembershipChange): Promise<MembershipRecord> {
    requireUuid(organizationId);
    requireUuid(membershipId);
    const updated = await this.transaction.membership.updateMany({
      where: { organizationId, id: membershipId },
      data: { role: change.role, status: change.status },
    });
    if (updated.count !== 1) throw new Error('MEMBERSHIP_NOT_FOUND');
    const membership = await this.findMembership(organizationId, membershipId);
    if (!membership) throw new Error('MEMBERSHIP_NOT_FOUND');
    return membership;
  }

  async releaseAssignmentsForMembership(actor: OrganizationPrincipal, membershipId: string): Promise<void> {
    const organizationId = actor.organizationId;
    requireUuid(organizationId);
    requireUuid(membershipId);
    const now = new Date();
    const assignments = await this.transaction.$queryRaw<Array<{ id: string; taskId: string; projectId: string; userId: string; membershipId: string }>>(Prisma.sql`
      SELECT "id", "task_id" AS "taskId", "project_id" AS "projectId", "user_id" AS "userId", "membership_id" AS "membershipId"
      FROM "task_assignments"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "membership_id" = ${membershipId}::uuid
        AND "unassigned_at" IS NULL
      ORDER BY "id" ASC FOR UPDATE
    `);
    if (assignments.length === 0) return;
    const released = await this.transaction.taskAssignment.updateMany({
      where: { organizationId, membershipId, id: { in: assignments.map(({ id }) => id) }, unassignedAt: null },
      data: { unassignedAt: now },
    });
    if (released.count !== assignments.length) throw new Error('ASSIGNMENT_RELEASE_INVARIANT_VIOLATION');

    const user = await this.transaction.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } });
    if (!user) throw new Error('MEMBERSHIP_NOT_FOUND');
    for (const assignment of assignments) {
      const payload = {
        projectId: assignment.projectId,
        taskId: assignment.taskId,
        membershipId: assignment.membershipId,
        userId: assignment.userId,
        reason: 'membership_deactivated',
      };
      await this.transaction.activityLog.create({
        data: {
          organizationId, actorUserId: actor.userId, actorDisplayName: user.displayName,
          action: 'assignment.removed', aggregateType: 'assignment', aggregateId: assignment.id,
          payload: payload as Prisma.InputJsonObject,
        },
      });
      await this.transaction.outboxEvent.create({
        data: {
          organizationId, aggregateType: 'assignment', aggregateId: assignment.id,
          eventType: 'assignment.removed', payload: payload as Prisma.InputJsonObject,
        },
      });
    }
  }
}

/** Prisma interactive transaction adapter; construction does not connect. */
export class PrismaMembershipLifecycleTransactions implements MembershipLifecycleTransactions {
  constructor(private readonly client: PrismaClient) {}

  run<T>(work: (transaction: MembershipLifecycleUnitOfWork) => Promise<T>): Promise<T> {
    return withTransaction(this.client, (transaction) => work(new PrismaMembershipLifecycleUnitOfWork(transaction)));
  }
}
