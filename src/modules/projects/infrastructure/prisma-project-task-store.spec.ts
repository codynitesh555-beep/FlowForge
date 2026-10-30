import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { OrganizationPrincipal } from '../../identity/domain/policies.js';
import { PrismaProjectTaskStore } from './prisma-project-task-store.js';

const organizationId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152';
const projectId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154';
const taskId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155';
const assignmentId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd156';
const actor: OrganizationPrincipal = {
  userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151', organizationId,
  membershipId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd153', role: 'OWNER', membershipStatus: 'ACTIVE',
};

const project = { id: projectId, organizationId, name: 'Project', description: null, graphRevision: 0, archivedAt: null };
const task = {
  id: taskId, projectId, organizationId, name: 'Task', description: null,
  optimisticHours: new Prisma.Decimal(1), likelyHours: new Prisma.Decimal(2), pessimisticHours: new Prisma.Decimal(3),
  expectedHours: new Prisma.Decimal(2), varianceHours: new Prisma.Decimal(0.1111), version: 1, deletedAt: null,
  createdAt: new Date(), updatedAt: new Date(), slackHours: null,
};

type HarnessOptions = {
  raw?: (query: Prisma.Sql) => Promise<unknown> | unknown;
  taskFindFirst?: () => Promise<unknown> | unknown;
  projectUpdateMany?: () => Promise<unknown> | unknown;
  assignmentUpdateMany?: () => Promise<unknown> | unknown;
  activityCreate?: () => Promise<unknown> | unknown;
  outboxCreate?: () => Promise<unknown> | unknown;
  taskCreate?: () => Promise<unknown> | unknown;
  assignmentFindFirst?: () => Promise<unknown> | unknown;
  assignmentCreate?: () => Promise<unknown> | unknown;
  assignmentFindMany?: () => Promise<unknown> | unknown;
  dependencyFind?: () => Promise<unknown> | unknown;
  taskUpdateMany?: () => Promise<unknown> | unknown;
  dependencyUpdate?: () => Promise<unknown> | unknown;
  rootAssignmentFindFirst?: () => Promise<unknown> | unknown;
};

type FakeState = {
  projectCreates: Array<Record<string, unknown>>;
  taskCreates: Array<Record<string, unknown>>;
  taskUpdates: Array<Record<string, unknown>>;
  assignmentCreates: Array<Record<string, unknown>>;
  assignmentReleases: Array<Record<string, unknown>>;
  dependencyRemovals: Array<Record<string, unknown>>;
  activityWrites: Array<{ data: Record<string, unknown> }>;
  outboxWrites: Array<{ data: Record<string, unknown> }>;
  graphRevisions: number[];
};

function emptyState(): FakeState {
  return { projectCreates: [], taskCreates: [], taskUpdates: [], assignmentCreates: [], assignmentReleases: [], dependencyRemovals: [], activityWrites: [], outboxWrites: [], graphRevisions: [] };
}

function cloneState(state: FakeState): FakeState {
  return {
    projectCreates: [...state.projectCreates],
    taskCreates: [...state.taskCreates], taskUpdates: [...state.taskUpdates],
    assignmentCreates: [...state.assignmentCreates], assignmentReleases: [...state.assignmentReleases],
    dependencyRemovals: [...state.dependencyRemovals], activityWrites: [...state.activityWrites],
    outboxWrites: [...state.outboxWrites], graphRevisions: [...state.graphRevisions],
  };
}

function harness(options: HarnessOptions = {}) {
  let committedState = emptyState();
  const rawQueries: Prisma.Sql[] = [];
  let activeState: FakeState | undefined;
  const transaction = {} as {
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    project: { create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    task: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    taskAssignment: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
    activityLog: { create: ReturnType<typeof vi.fn> };
    outboxEvent: { create: ReturnType<typeof vi.fn> };
  };
  transaction.$queryRaw = vi.fn(async (query: Prisma.Sql) => {
      rawQueries.push(query);
      if (query.sql.includes('UPDATE "task_dependencies" SET "removed_at"')) {
        const rows = options.raw ? await options.raw(query) : options.dependencyUpdate?.() ?? [];
        if (Array.isArray(rows) && rows.length > 0) activeState!.dependencyRemovals.push({ query, removedAt: query.values[0] });
        return rows;
      }
      if (query.sql.includes('UPDATE "projects" SET "graph_revision"')) activeState!.graphRevisions.push(1);
      if (options.raw) {
        const result = options.raw(query);
        if (result !== undefined) return result;
      }
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return [project];
      if (query.sql.includes('UPDATE "projects" SET "graph_revision"')) return [{ graphRevision: 1 }];
      if (query.sql.includes('FROM "task_assignments"')) return options.assignmentFindMany?.() ?? [];
      if (query.sql.includes('FROM "task_dependencies"')) return options.dependencyFind?.() ?? [];
      return [];
    });
    transaction.$executeRaw = vi.fn(async () => 1);
    transaction.project = {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => { activeState!.projectCreates.push(args.data); return { ...project }; }),
      updateMany: vi.fn(async () => options.projectUpdateMany?.() ?? { count: 1 }),
    };
    transaction.task = {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        activeState!.taskCreates.push(args.data);
        return options.taskCreate?.() ?? ({ ...task });
      }),
      findFirst: vi.fn(async () => options.taskFindFirst ? options.taskFindFirst() : task),
      findMany: vi.fn(async () => [task, { ...task, id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157' }]),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        activeState!.taskUpdates.push(args);
        return options.taskUpdateMany?.() ?? { count: 1 };
      }),
    };
    transaction.taskAssignment = {
      findFirst: vi.fn(async () => options.assignmentFindFirst ? options.assignmentFindFirst() : null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        activeState!.assignmentCreates.push(args.data);
        return options.assignmentCreate ? options.assignmentCreate() : ({
          id: assignmentId, ...args.data, assignedAt: new Date('2026-01-01T00:00:00.000Z'), unassignedAt: null,
          membership: { user: { displayName: 'Grace Hopper' } },
        });
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        activeState!.assignmentReleases.push(args);
        return options.assignmentUpdateMany?.() ?? { count: 1 };
      }),
    };
    transaction.user = { findUnique: vi.fn(async () => ({ displayName: 'Ada Lovelace' })) };
    transaction.activityLog = { create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      activeState!.activityWrites.push(args);
      return options.activityCreate?.();
    }) };
    transaction.outboxEvent = { create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      activeState!.outboxWrites.push(args);
      return options.outboxCreate?.();
    }) };
  const rootWrite = async (): Promise<never> => { throw new Error('Unexpected root-client write outside transaction'); };
  const client = {
    $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<unknown>) => {
      const draft = cloneState(committedState);
      activeState = draft;
      try {
        const result = await work(transaction);
        committedState = draft;
        return result;
      } catch (error) {
        throw error;
      } finally {
        activeState = undefined;
      }
    }),
    task: {
      create: vi.fn(rootWrite), updateMany: vi.fn(rootWrite),
      findFirst: vi.fn(async () => options.taskFindFirst ? options.taskFindFirst() : task),
      findMany: vi.fn(async () => [task]),
    },
    taskAssignment: {
      create: vi.fn(rootWrite), updateMany: vi.fn(rootWrite),
      findFirst: vi.fn(async () => options.rootAssignmentFindFirst?.() ?? null),
    },
    project: { create: vi.fn(rootWrite), updateMany: vi.fn(rootWrite) },
    activityLog: { create: vi.fn(rootWrite) }, outboxEvent: { create: vi.fn(rootWrite) },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    store: new PrismaProjectTaskStore(client as unknown as PrismaClient), transaction, client,
    rawQueries, committedState: () => committedState,
  };
}

describe('PrismaProjectTaskStore offline transaction boundary', () => {
  it('rolls back task updates when the post-write row is unexpectedly absent', async () => {
    let reads = 0;
    const h = harness({ taskFindFirst: () => (++reads === 1 ? task : null) });
    await expect(h.store.updateTask(actor, true, projectId, taskId, { expectedVersion: 1, name: 'Changed' }))
      .rejects.toMatchObject({ code: 'PERSISTENCE_INVARIANT_VIOLATION' });
    expect(h.transaction.task.updateMany).toHaveBeenCalledOnce();
    expect(h.committedState().taskUpdates).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
  });

  it('rolls back project metadata writes when the post-write project read is absent', async () => {
    let projectReads = 0;
    const h = harness({ raw: (query) => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return (++projectReads === 1 ? [project] : []);
      return [];
    } });
    await expect(h.store.updateProject(actor, projectId, { name: 'Changed' }))
      .rejects.toMatchObject({ code: 'PERSISTENCE_INVARIANT_VIOLATION' });
    expect(h.transaction.project.updateMany).toHaveBeenCalledOnce();
    expect(h.committedState().projectCreates).toHaveLength(0);
  });

  it('rolls back task deletion when its post-write row disappears after assignment and revision work', async () => {
    let reads = 0;
    const h = harness({ taskFindFirst: () => (++reads === 1 ? task : null) });
    await expect(h.store.softDeleteTask(actor, projectId, taskId, 1))
      .rejects.toMatchObject({ code: 'PERSISTENCE_INVARIANT_VIOLATION' });
    expect(h.transaction.task.updateMany).toHaveBeenCalledOnce();
    expect(h.transaction.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId, projectId, id: taskId, version: 1, deletedAt: null }),
    }));
    expect(h.rawQueries.some(({ sql }) => sql.includes('UPDATE "projects" SET "graph_revision"'))).toBe(true);
    expect(h.committedState().taskUpdates).toHaveLength(0);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
  });

  it.each([
    ['ActivityLog', { activityCreate: async () => { throw new Error('activity write failed'); } }],
    ['OutboxEvent', { outboxCreate: async () => { throw new Error('outbox write failed'); } }],
  ] as const)('does not commit project creation when %s creation fails', async (_name, options) => {
    const h = harness(options);
    await expect(h.store.createProject(actor, { name: 'Project' })).rejects.toThrow(/write failed/);
    expect(h.transaction.project.create).toHaveBeenCalledOnce();
    expect(h.committedState().projectCreates).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
  });

  it('rolls back task creation when the graph revision write fails', async () => {
    const h = harness({ raw: (query) => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return [project];
      if (query.sql.includes('UPDATE "projects" SET "graph_revision"')) throw new Error('revision write failed');
      return [];
    } });
    await expect(h.store.createTask(actor, projectId, {
      name: 'Task', optimisticHours: 1, likelyHours: 2, pessimisticHours: 3,
    })).rejects.toThrow('revision write failed');
    expect(h.transaction.task.create).toHaveBeenCalledOnce();
    expect(h.committedState().taskCreates).toHaveLength(0);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
  });

  it('releases assignment history and emits events atomically when archiving a project', async () => {
    const h = harness({ raw: (query) => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return [project];
      if (query.sql.includes('FROM "task_assignments"')) return [{ id: assignmentId, taskId, membershipId: actor.membershipId, userId: actor.userId }];
      return [];
    } });
    const archived = await h.store.archiveProject(actor, projectId);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(h.transaction.taskAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId, projectId, id: { in: [assignmentId] }, unassignedAt: null }),
    }));
    expect(h.committedState().assignmentReleases).toHaveLength(1);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual(['assignment.removed', 'project.archived']);
    expect(h.committedState().outboxWrites.map(({ data }) => data.eventType)).toEqual(['assignment.removed', 'project.archived']);
    expect(h.committedState().outboxWrites[0]?.data.payload).toMatchObject({ reason: 'project_archived', taskId });
  });

  it('repairs residual assignments on repeated archive without duplicating the archive event', async () => {
    const archivedAt = new Date('2026-01-01T00:00:00.000Z');
    const h = harness({ raw: (query) => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return [{ ...project, archivedAt }];
      if (query.sql.includes('FROM "task_assignments"')) return [{ id: assignmentId, taskId, membershipId: actor.membershipId, userId: actor.userId }];
      return [];
    } });
    const result = await h.store.archiveProject(actor, projectId);
    expect(result?.archivedAt).toBe(archivedAt);
    expect(h.transaction.$executeRaw).not.toHaveBeenCalled();
    expect(h.committedState().assignmentReleases).toHaveLength(1);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual(['assignment.removed']);
    expect(h.committedState().outboxWrites.map(({ data }) => data.eventType)).toEqual(['assignment.removed']);
  });

  it('rejects and rolls back if assignment release affects fewer rows than were locked', async () => {
    const h = harness({
      raw: (query) => {
        if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
        if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
        if (query.sql.includes('FROM "projects"')) return [project];
        if (query.sql.includes('FROM "task_assignments"')) return [{ id: assignmentId, taskId, membershipId: actor.membershipId, userId: actor.userId }];
        return [];
      },
      assignmentUpdateMany: async () => ({ count: 0 }),
    });
    await expect(h.store.archiveProject(actor, projectId)).rejects.toMatchObject({ code: 'PERSISTENCE_INVARIANT_VIOLATION' });
    expect(h.transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(h.committedState().assignmentReleases).toHaveLength(0);
    expect(h.committedState().projectCreates).toHaveLength(0);
  });

  it('does not commit archive or assignment-history changes when an assignment event fails', async () => {
    const h = harness({
      raw: (query) => {
        if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
        if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
        if (query.sql.includes('FROM "projects"')) return [project];
        if (query.sql.includes('FROM "task_assignments"')) return [{ id: assignmentId, taskId, membershipId: actor.membershipId, userId: actor.userId }];
        return [];
      },
      activityCreate: async () => { throw new Error('activity failure'); },
    });
    await expect(h.store.archiveProject(actor, projectId)).rejects.toThrow('activity failure');
    expect(h.transaction.taskAssignment.updateMany).toHaveBeenCalledOnce();
    expect(h.committedState().assignmentReleases).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('rejects stale task versions before issuing the update', async () => {
    const h = harness();
    await expect(h.store.updateTask(actor, true, projectId, taskId, { expectedVersion: 2, name: 'Changed' }))
      .rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT' });
    expect(h.transaction.task.updateMany).not.toHaveBeenCalled();
    expect(h.committedState().taskUpdates).toHaveLength(0);
  });

  it('uses a transaction client and takes tenant then advisory/project locks before task writes', async () => {
    const h = harness();
    await h.store.createTask(actor, projectId, { name: 'Task', optimisticHours: 1, likelyHours: 2, pessimisticHours: 3 });
    const statements = h.rawQueries.map(({ sql }) => sql);
    expect(statements.findIndex((sql) => sql.includes('FROM "organizations"'))).toBeLessThan(statements.findIndex((sql) => sql.includes('FROM "memberships"')));
    expect(statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(statements.findIndex((sql) => sql.includes('FROM "projects"')));
    expect(statements.find((sql) => sql.includes('pg_advisory_xact_lock'))).toContain('::text AS "locked"');
    expect(h.transaction.task.create).toHaveBeenCalledOnce();
    expect(h.client.task).not.toBe(h.transaction.task);
    expect(h.client.task.create).not.toHaveBeenCalled();
    expect(h.client.activityLog.create).not.toHaveBeenCalled();
    expect(h.client.$transaction).toHaveBeenCalledOnce();
    expect(h.committedState().taskCreates).toHaveLength(1);
    const organizationLock = h.rawQueries.find(({ sql }) => sql.includes('FROM "organizations"'));
    expect(organizationLock?.sql).not.toContain(organizationId);
    expect(organizationLock?.values).toContain(organizationId);
  });

  it('returns Prisma-decodable advisory-lock output while reading a project graph', async () => {
    const h = harness();
    const graph = await h.store.activeGraph(organizationId, projectId);
    expect(graph).not.toBeNull();
    expect(h.rawQueries.find(({ sql }) => sql.includes('pg_advisory_xact_lock'))?.sql)
      .toContain('::text AS "locked"');
  });

  it('stops at organization scope when the authenticated organization is not present', async () => {
    const h = harness({ raw: (query) => query.sql.includes('FROM "organizations"') ? [] : [] });
    await expect(h.store.updateTask(actor, true, projectId, taskId, { expectedVersion: 1, name: 'Changed' }))
      .rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_FOUND' });
    expect(h.transaction.task.updateMany).not.toHaveBeenCalled();
    expect(h.rawQueries).toHaveLength(1);
    expect(h.committedState().taskUpdates).toHaveLength(0);
  });

  it('translates a duplicate active-edge SQL constraint into a stable domain conflict', async () => {
    const h = harness({ raw: (query) => {
      if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
      if (query.sql.includes('FROM "memberships"')) return [{ id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }];
      if (query.sql.includes('FROM "projects"')) return [project];
      if (query.sql.includes('SELECT pg_advisory_xact_lock')) return [];
      if (query.sql.includes('FROM "task_dependencies"')) return [];
      if (query.sql.includes('INSERT INTO "task_dependencies"')) throw Object.assign(new Error('constraint details'), { code: 'P2010', meta: { code: '23505' } });
      return [];
    } });
    await expect(h.store.addDependency(actor, projectId, taskId, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157'))
      .rejects.toMatchObject({ code: 'DEPENDENCY_EXISTS' });
  });

  it('rejects a cycle from the persisted active graph before inserting or revising it', async () => {
    const dependentTaskId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const h = harness({ raw: (query) => query.sql.includes('FROM "task_dependencies" d')
      ? [{ from: taskId, to: dependentTaskId, removedAt: null }]
      : undefined });

    await expect(h.store.addDependency(actor, projectId, dependentTaskId, taskId))
      .rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });

    expect(h.rawQueries.some(({ sql }) => sql.includes('FROM "task_dependencies" d'))).toBe(true);
    expect(h.rawQueries.some(({ sql }) => sql.includes('INSERT INTO "task_dependencies"'))).toBe(false);
    expect(h.rawQueries.some(({ sql }) => sql.includes('UPDATE "projects" SET "graph_revision"'))).toBe(false);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('translates assignment unique and foreign-key violations without exposing database errors', async () => {
    const targetMembershipId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const target = { id: targetMembershipId, userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd158', role: 'MEMBER', status: 'ACTIVE', organizationId };
    const setup = (code: string, meta?: { code?: string }) => harness({
      raw: (query) => {
        if (query.sql.includes('FROM "organizations"')) return [{ id: organizationId }];
        if (query.sql.includes('FROM "memberships"')) return [
          { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }, target,
        ];
        if (query.sql.includes('FROM "projects"')) return [project];
        return [];
      },
      assignmentCreate: async () => { throw Object.assign(new Error('SQL and constraint details must remain private'), { code, meta }); },
    });
    const duplicate = setup('P2002');
    await expect(duplicate.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toMatchObject({ code: 'ASSIGNMENT_EXISTS' });
    const foreignKey = setup('P2010', { code: '23503' });
    await expect(foreignKey.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect(duplicate.committedState().outboxWrites).toHaveLength(0);
    expect(foreignKey.committedState().outboxWrites).toHaveLength(0);
  });

  it('commits dependency removal, one graph revision and both domain events', async () => {
    const dependency = {
      id: assignmentId, projectId, organizationId, prerequisiteTaskId: taskId,
      dependentTaskId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), removedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const h = harness({ raw: (query) => query.sql.includes('UPDATE "task_dependencies" SET "removed_at"') ? [dependency] : undefined });
    const result = await h.store.removeDependency(actor, projectId, assignmentId);
    expect(result?.removedAt).toEqual(dependency.removedAt);
    expect(h.committedState().dependencyRemovals).toHaveLength(1);
    expect(h.committedState().graphRevisions).toHaveLength(1);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual(['dependency.removed']);
    expect(h.committedState().outboxWrites.map(({ data }) => data.eventType)).toEqual(['dependency.removed']);
  });

  it('returns null for a missing or already removed dependency without changing revision or events', async () => {
    const h = harness({ raw: (query) => query.sql.includes('UPDATE "task_dependencies" SET "removed_at"') ? [] : undefined });
    await expect(h.store.removeDependency(actor, projectId, assignmentId)).resolves.toBeNull();
    expect(h.committedState().dependencyRemovals).toHaveLength(0);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it.each([
    ['ActivityLog', { activityCreate: async () => { throw new Error('activity failure'); } }],
    ['OutboxEvent', { outboxCreate: async () => { throw new Error('outbox failure'); } }],
  ] as const)('discards dependency removal, revision and events when %s fails', async (_name, options) => {
    const dependency = {
      id: assignmentId, projectId, organizationId, prerequisiteTaskId: taskId,
      dependentTaskId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), removedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const h = harness({ ...options, raw: (query) => query.sql.includes('UPDATE "task_dependencies" SET "removed_at"') ? [dependency] : undefined });
    await expect(h.store.removeDependency(actor, projectId, assignmentId)).rejects.toThrow(/failure/);
    expect(h.committedState().dependencyRemovals).toHaveLength(0);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('commits an assignment for an active same-tenant member without changing graph revision', async () => {
    const targetMembershipId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const target = { id: targetMembershipId, userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd158', role: 'MEMBER', status: 'ACTIVE', organizationId };
    const h = harness({ raw: (query) => query.sql.includes('FROM "memberships"') ? [
      { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }, target,
    ] : undefined });
    const result = await h.store.assignTask(actor, projectId, taskId, targetMembershipId);
    expect(result).toMatchObject({ id: assignmentId, taskId, projectId, organizationId, membershipId: targetMembershipId, userId: target.userId, displayName: 'Grace Hopper' });
    expect(h.committedState().assignmentCreates).toHaveLength(1);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual(['assignment.added']);
    expect(h.committedState().outboxWrites.map(({ data }) => data.eventType)).toEqual(['assignment.added']);
  });

  it('rejects inactive or cross-tenant assignment targets before project/task writes', async () => {
    const targetMembershipId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const inactiveTarget = { id: targetMembershipId, userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd158', role: 'MEMBER', status: 'SUSPENDED', organizationId };
    const h = harness({ raw: (query) => query.sql.includes('FROM "memberships"') ? [
      { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }, inactiveTarget,
    ] : undefined });
    await expect(h.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_ACTIVE' });
    expect(h.rawQueries.some((query) => query.sql.includes('WHERE "organization_id" ='))).toBe(true);
    expect(h.transaction.taskAssignment.create).not.toHaveBeenCalled();
    expect(h.committedState().assignmentCreates).toHaveLength(0);
    const foreignTenant = harness({ raw: (query) => query.sql.includes('FROM "memberships"') ? [
      { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId },
    ] : undefined });
    await expect(foreignTenant.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_ACTIVE' });
    const membershipQuery = foreignTenant.rawQueries.find((query) => query.sql.includes('FROM "memberships"'));
    expect(membershipQuery?.values).toContain(organizationId);
    expect(foreignTenant.transaction.taskAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects an already active assignment without adding another row', async () => {
    const targetMembershipId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const target = { id: targetMembershipId, userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd158', role: 'MEMBER', status: 'ACTIVE', organizationId };
    const h = harness({
      raw: (query) => query.sql.includes('FROM "memberships"') ? [
        { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }, target,
      ] : undefined,
      assignmentFindFirst: () => ({ id: assignmentId }),
    });
    await expect(h.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toMatchObject({ code: 'ASSIGNMENT_EXISTS' });
    expect(h.transaction.taskAssignment.create).not.toHaveBeenCalled();
    expect(h.committedState().assignmentCreates).toHaveLength(0);
  });

  it('discards an assignment when either required event write fails', async () => {
    const targetMembershipId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd157';
    const target = { id: targetMembershipId, userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd158', role: 'MEMBER', status: 'ACTIVE', organizationId };
    const h = harness({
      raw: (query) => query.sql.includes('FROM "memberships"') ? [
        { id: actor.membershipId, userId: actor.userId, role: actor.role, status: 'ACTIVE', organizationId }, target,
      ] : undefined,
      outboxCreate: async () => { throw new Error('outbox failure'); },
    });
    await expect(h.store.assignTask(actor, projectId, taskId, targetMembershipId)).rejects.toThrow('outbox failure');
    expect(h.committedState().assignmentCreates).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('unassigns through the transaction client after a root-client membership lookup', async () => {
    const assignment = {
      id: assignmentId, taskId, projectId, organizationId, membershipId: actor.membershipId, userId: actor.userId,
      displayName: 'Ada Lovelace', assignedAt: new Date('2026-01-01T00:00:00.000Z'), unassignedAt: null,
    };
    const h = harness({
      rootAssignmentFindFirst: () => ({ membershipId: actor.membershipId }),
      assignmentFindMany: () => [assignment],
    });
    const result = await h.store.unassignTask(actor, projectId, taskId, assignmentId);
    expect(result).toMatchObject({ id: assignmentId, unassignedAt: expect.any(Date) });
    expect(h.client.taskAssignment.findFirst).toHaveBeenCalledOnce();
    expect(h.transaction.taskAssignment.updateMany).toHaveBeenCalledOnce();
    expect(h.transaction.activityLog.create).toHaveBeenCalledOnce();
    expect(h.transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(h.client.taskAssignment.updateMany).not.toHaveBeenCalled();
    expect(h.client.activityLog.create).not.toHaveBeenCalled();
    expect(h.committedState().assignmentReleases).toHaveLength(1);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual(['assignment.removed']);
    expect(h.committedState().graphRevisions).toHaveLength(0);
  });

  it('returns null for missing or repeated unassignment without writing history', async () => {
    const missing = harness();
    await expect(missing.store.unassignTask(actor, projectId, taskId, assignmentId)).resolves.toBeNull();
    expect(missing.client.$transaction).not.toHaveBeenCalled();
    const repeated = harness({ rootAssignmentFindFirst: () => ({ membershipId: actor.membershipId }), assignmentFindMany: () => [] });
    await expect(repeated.store.unassignTask(actor, projectId, taskId, assignmentId)).resolves.toBeNull();
    expect(repeated.transaction.taskAssignment.updateMany).not.toHaveBeenCalled();
    expect(repeated.committedState().assignmentReleases).toHaveLength(0);
    expect(repeated.committedState().activityWrites).toHaveLength(0);
  });

  it('discards unassignment history when a required event fails', async () => {
    const assignment = {
      id: assignmentId, taskId, projectId, organizationId, membershipId: actor.membershipId, userId: actor.userId,
      displayName: 'Ada Lovelace', assignedAt: new Date('2026-01-01T00:00:00.000Z'), unassignedAt: null,
    };
    const h = harness({
      rootAssignmentFindFirst: () => ({ membershipId: actor.membershipId }),
      assignmentFindMany: () => [assignment],
      outboxCreate: async () => { throw new Error('outbox failure'); },
    });
    await expect(h.store.unassignTask(actor, projectId, taskId, assignmentId)).rejects.toThrow('outbox failure');
    expect(h.committedState().assignmentReleases).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('releases active task assignments, retains history events and advances graph revision once on soft delete', async () => {
    let reads = 0;
    const deletedTask = { ...task, deletedAt: new Date('2026-01-02T00:00:00.000Z'), version: 2 };
    const assignments = [
      { id: assignmentId }, { id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd159' },
    ];
    const h = harness({
      taskFindFirst: () => (++reads === 1 ? task : deletedTask),
      raw: (query) => query.sql.includes('FROM "task_assignments"') ? assignments : undefined,
      assignmentUpdateMany: () => ({ count: assignments.length }),
    });
    const result = await h.store.softDeleteTask(actor, projectId, taskId, 1);
    expect(result?.version).toBe(2);
    expect(h.committedState().taskUpdates).toHaveLength(1);
    expect(h.committedState().assignmentReleases).toHaveLength(1);
    expect(h.committedState().graphRevisions).toHaveLength(1);
    expect(h.committedState().activityWrites.map(({ data }) => data.action)).toEqual([
      'assignment.removed', 'assignment.removed', 'task.deleted',
    ]);
    expect(h.committedState().outboxWrites.map(({ data }) => data.eventType)).toEqual([
      'assignment.removed', 'assignment.removed', 'task.deleted',
    ]);
  });

  it('discards task deletion, assignment release, revision and event state when an assignment event fails', async () => {
    let reads = 0;
    const h = harness({
      taskFindFirst: () => (++reads === 1 ? task : { ...task, deletedAt: new Date(), version: 2 }),
      raw: (query) => query.sql.includes('FROM "task_assignments"') ? [{ id: assignmentId }] : undefined,
      outboxCreate: async () => { throw new Error('outbox failure'); },
    });
    await expect(h.store.softDeleteTask(actor, projectId, taskId, 1)).rejects.toThrow('outbox failure');
    expect(h.committedState().taskUpdates).toHaveLength(0);
    expect(h.committedState().assignmentReleases).toHaveLength(0);
    expect(h.committedState().graphRevisions).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
    expect(h.committedState().outboxWrites).toHaveLength(0);
  });

  it('increments graph revision once for a successful PERT update and not for metadata-only updates', async () => {
    const pert = harness({ taskFindFirst: () => ({ ...task }) });
    await pert.store.updateTask(actor, true, projectId, taskId, {
      expectedVersion: 1, optimisticHours: 1.5, likelyHours: 2.5, pessimisticHours: 3.5,
    });
    expect(pert.committedState().taskUpdates).toHaveLength(1);
    expect(pert.committedState().graphRevisions).toHaveLength(1);

    const metadata = harness({ taskFindFirst: () => ({ ...task }) });
    await metadata.store.updateTask(actor, true, projectId, taskId, { expectedVersion: 1, name: 'Renamed' });
    expect(metadata.committedState().taskUpdates).toHaveLength(1);
    expect(metadata.committedState().graphRevisions).toHaveLength(0);
  });

  it('maps a version race at the conditional update to TASK_VERSION_CONFLICT and discards fake writes', async () => {
    const h = harness({ taskFindFirst: () => task, taskUpdateMany: () => ({ count: 0 }) });
    await expect(h.store.updateTask(actor, true, projectId, taskId, { expectedVersion: 1, name: 'Concurrent edit' }))
      .rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT' });
    expect(h.transaction.task.updateMany).toHaveBeenCalledOnce();
    expect(h.committedState().taskUpdates).toHaveLength(0);
    expect(h.committedState().activityWrites).toHaveLength(0);
  });
});
