import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { createIntegrationPrismaClient } from './integration-prisma.js';
import { requireDedicatedIntegrationDatabase } from './integration-safety.js';

const rollbackSignal = Symbol('rollback integration fixture');
let database: PrismaClient | undefined;

function db(): PrismaClient {
  if (!database) throw new Error('Integration database is not connected.');
  return database;
}

async function rolledBackFixture(run: (transaction: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await db().$transaction(async (transaction) => {
      await run(transaction);
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }
}

async function workspace(transaction: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const user = await transaction.user.create({
    data: { email: `integration-${suffix}@example.test`, displayName: 'Integration User' },
  });
  const organization = await transaction.organization.create({
    data: { name: 'Integration Workspace', slug: `integration-${suffix}` },
  });
  const membership = await transaction.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
  });
  const project = await transaction.project.create({
    data: { organizationId: organization.id, name: 'Integration Project' },
  });
  return { user, organization, membership, project };
}

async function task(
  transaction: Prisma.TransactionClient,
  projectId: string,
  organizationId: string,
  name: string,
) {
  return transaction.task.create({
    data: {
      projectId, organizationId, name,
      optimisticHours: new Prisma.Decimal(1),
      likelyHours: new Prisma.Decimal(2),
      pessimisticHours: new Prisma.Decimal(3),
    },
  });
}

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== '1')('Phase 1C scratch PostgreSQL integration', () => {
  beforeAll(async () => {
    requireDedicatedIntegrationDatabase();
    database = createIntegrationPrismaClient();
    await database.$connect();
  });

  afterAll(async () => {
    await database?.$disconnect();
    database = undefined;
  });

  it('computes PERT-derived task hours with the database trigger', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const created = await task(transaction, fixture.project.id, fixture.organization.id, 'Trigger task');
      expect(Number(created.expectedHours.toString())).toBe(2);
      expect(Number(created.varianceHours.toString())).toBe(0.1111);
    });
  });

  it('rejects a task whose project and organization do not match', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const other = await workspace(transaction);
      await expect(transaction.task.create({
        data: {
          projectId: fixture.project.id, organizationId: other.organization.id, name: 'Cross-tenant task',
          optimisticHours: 1, likelyHours: 2, pessimisticHours: 3,
        },
      })).rejects.toBeDefined();
    });
  });

  it('enforces unique organization membership and normalized identifiers', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      await expect(transaction.membership.create({
        data: { organizationId: fixture.organization.id, userId: fixture.user.id, role: 'MEMBER' },
      })).rejects.toBeDefined();
      await expect(transaction.organization.create({ data: { name: 'Invalid slug', slug: ' Uppercase ' } }))
        .rejects.toBeDefined();
    });
  });

  it('enforces PERT ordering and self-dependency checks', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      await expect(transaction.task.create({
        data: {
          projectId: fixture.project.id, organizationId: fixture.organization.id, name: 'Invalid estimates',
          optimisticHours: 3, likelyHours: 2, pessimisticHours: 1,
        },
      })).rejects.toBeDefined();
    });
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const existing = await task(transaction, fixture.project.id, fixture.organization.id, 'Self dependency task');
      await expect(transaction.taskDependency.create({
        data: {
          projectId: fixture.project.id, organizationId: fixture.organization.id,
          prerequisiteTaskId: existing.id, dependentTaskId: existing.id,
        },
      })).rejects.toBeDefined();
    });
  });

  it('enforces one active dependency edge and one active assignment per task and user', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const first = await task(transaction, fixture.project.id, fixture.organization.id, 'First');
      const second = await task(transaction, fixture.project.id, fixture.organization.id, 'Second');
      await transaction.taskDependency.create({
        data: {
          projectId: fixture.project.id, organizationId: fixture.organization.id,
          prerequisiteTaskId: first.id, dependentTaskId: second.id,
        },
      });
      await expect(transaction.taskDependency.create({
        data: {
          projectId: fixture.project.id, organizationId: fixture.organization.id,
          prerequisiteTaskId: first.id, dependentTaskId: second.id,
        },
      })).rejects.toBeDefined();
    });
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const first = await task(transaction, fixture.project.id, fixture.organization.id, 'Assignment target');
      const assignment = {
        taskId: first.id, projectId: fixture.project.id, organizationId: fixture.organization.id,
        membershipId: fixture.membership.id, userId: fixture.user.id,
      };
      await transaction.taskAssignment.create({ data: assignment });
      await expect(transaction.taskAssignment.create({ data: assignment })).rejects.toBeDefined();
    });
  });

  it('retains dependency history when a task is soft-deleted', async () => {
    await rolledBackFixture(async (transaction) => {
      const fixture = await workspace(transaction);
      const first = await task(transaction, fixture.project.id, fixture.organization.id, 'First');
      const second = await task(transaction, fixture.project.id, fixture.organization.id, 'Second');
      await transaction.taskDependency.create({
        data: {
          projectId: fixture.project.id, organizationId: fixture.organization.id,
          prerequisiteTaskId: first.id, dependentTaskId: second.id,
        },
      });
      await transaction.task.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
      expect(await transaction.taskDependency.count({ where: { projectId: fixture.project.id } })).toBe(1);
    });
  });

  it('rolls back all writes in a failed transaction', async () => {
    const suffix = randomUUID();
    try {
      await db().$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: `rollback-${suffix}@example.test`, displayName: 'Rollback User' },
        });
        const organization = await transaction.organization.create({
          data: { name: 'Rollback Workspace', slug: `rollback-${suffix}` },
        });
        await transaction.membership.create({
          data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
        });
        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
    }
    expect(await db().user.count({ where: { email: `rollback-${suffix}@example.test` } })).toBe(0);
    expect(await db().organization.count({ where: { slug: `rollback-${suffix}` } })).toBe(0);
  });
});
