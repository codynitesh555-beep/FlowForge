import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import type { OrganizationPrincipal } from '../../identity/domain/policies.js';
import { withTransaction } from '../../../infrastructure/database/transaction.js';
import { analyzeDependencyAddition, analyzeProjectSnapshot, buildActiveProjectGraph } from '../scheduling.js';
import type {
  AssignmentSummary, CreateProjectInput, CreateTaskInput, DependencySummary, ProjectGraphSnapshot,
  ProjectSummary, ProjectTaskStore, TaskSummary, UpdateProjectInput, UpdateTaskInput,
} from '../contracts.js';
import { ProjectTaskError } from '../domain/errors.js';
import { assertAssignmentTargetActive } from '../domain/assignments.js';

type Tx = Prisma.TransactionClient;
type DbTask = Prisma.TaskGetPayload<Record<string, never>>;
type ProjectRow = { id: string; organizationId: string; name: string; description: string | null; graphRevision: number; archivedAt: Date | null };
type DependencyRow = { id: string; projectId: string; organizationId: string; prerequisiteTaskId: string; dependentTaskId: string; createdAt: Date; removedAt: Date | null };
type AssignmentRow = { id: string; taskId: string; projectId: string; organizationId: string; membershipId: string; userId: string; displayName: string; assignedAt: Date; unassignedAt: Date | null };

function taskSummary(task: DbTask): TaskSummary {
  const number = (value: Prisma.Decimal): number => {
    const result = Number(value.toString());
    if (!Number.isFinite(result)) throw new ProjectTaskError('INVALID_PROJECT_GRAPH');
    return result;
  };
  return {
    id: task.id, projectId: task.projectId, organizationId: task.organizationId,
    name: task.name, description: task.description,
    optimisticHours: number(task.optimisticHours), likelyHours: number(task.likelyHours),
    pessimisticHours: number(task.pessimisticHours), expectedHours: number(task.expectedHours),
    varianceHours: number(task.varianceHours), version: task.version, deletedAt: task.deletedAt,
  };
}

function projectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id, organizationId: row.organizationId, name: row.name,
    description: row.description, graphRevision: row.graphRevision, archivedAt: row.archivedAt,
  };
}

function eventJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

export async function writeProjectDomainEvent(
  transaction: Tx,
  actor: OrganizationPrincipal,
  eventType: string,
  aggregateType: 'project' | 'task' | 'dependency' | 'assignment',
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const user = await transaction.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } });
  if (!user) throw new ProjectTaskError('MEMBERSHIP_NOT_FOUND');
  await transaction.activityLog.create({
    data: {
      organizationId: actor.organizationId, actorUserId: actor.userId,
      actorDisplayName: user.displayName, action: eventType,
      aggregateType, aggregateId, payload: eventJson(payload),
    },
  });
  await transaction.outboxEvent.create({
    data: {
      organizationId: actor.organizationId, aggregateType, aggregateId,
      eventType, payload: eventJson(payload),
    },
  });
}

async function lockActor(transaction: Tx, actor: OrganizationPrincipal, additionalMembershipIds: readonly string[] = []): Promise<Map<string, { userId: string; role: string; status: string; organizationId: string }>> {
  const organizations = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "organizations" WHERE "id" = ${actor.organizationId}::uuid FOR SHARE
  `);
  if (organizations.length !== 1) throw new ProjectTaskError('MEMBERSHIP_NOT_FOUND');
  const ids = [...new Set([actor.membershipId, ...additionalMembershipIds])].sort();
  const members = ids.length === 0 ? [] : await transaction.$queryRaw<Array<{ id: string; userId: string; role: string; status: string; organizationId: string }>>(Prisma.sql`
    SELECT "id", "user_id" AS "userId", "role", "status", "organization_id" AS "organizationId" FROM "memberships"
    WHERE "organization_id" = ${actor.organizationId}::uuid
      AND "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id" ASC FOR SHARE
  `);
  const byId = new Map(members.map((membership) => [membership.id, membership]));
  const actingMembership = byId.get(actor.membershipId);
  if (!actingMembership || actingMembership.userId !== actor.userId || actingMembership.status !== 'ACTIVE' || actingMembership.role !== actor.role) {
    throw new ProjectTaskError('MEMBERSHIP_NOT_ACTIVE');
  }
  return byId;
}

async function lockProject(transaction: Tx, projectId: string, organizationId: string): Promise<ProjectRow | null> {
  // Project graph changes are serialized by the approved transaction-scoped advisory key.
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))::text AS "locked"
  `);
  const rows = await transaction.$queryRaw<ProjectRow[]>(Prisma.sql`
    SELECT "id", "organization_id" AS "organizationId", "name", "description",
           "graph_revision" AS "graphRevision", "archived_at" AS "archivedAt"
    FROM "projects" WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function requireWritableProject(project: ProjectRow | null): asserts project is ProjectRow {
  if (!project) throw new ProjectTaskError('PROJECT_NOT_FOUND');
  if (project.archivedAt) throw new ProjectTaskError('PROJECT_ARCHIVED');
}

function requireSingleRow(count: number, operation: string): void {
  if (count !== 1) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation });
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; meta?: { code?: unknown } };
  return value.code === 'P2002' || (value.code === 'P2010' && value.meta?.code === '23505');
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; meta?: { code?: unknown } };
  return value.code === 'P2003' || (value.code === 'P2010' && value.meta?.code === '23503');
}

async function incrementGraphRevision(transaction: Tx, projectId: string, organizationId: string): Promise<number> {
  const rows = await transaction.$queryRaw<Array<{ graphRevision: number }>>(Prisma.sql`
    UPDATE "projects" SET "graph_revision" = "graph_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid AND "archived_at" IS NULL
    RETURNING "graph_revision" AS "graphRevision"
  `);
  const revision = rows[0]?.graphRevision;
  if (revision === undefined) throw new ProjectTaskError('PROJECT_ARCHIVED');
  return revision;
}

async function taskById(transaction: Tx, organizationId: string, projectId: string, taskId: string, includeDeleted = false): Promise<DbTask | null> {
  return transaction.task.findFirst({
    where: { organizationId, projectId, id: taskId, ...(includeDeleted ? {} : { deletedAt: null }) },
  });
}

async function activeGraphIn(transaction: Tx, project: ProjectRow): Promise<ProjectGraphSnapshot> {
  const tasks = await transaction.task.findMany({
    where: { projectId: project.id, organizationId: project.organizationId },
    select: { id: true, expectedHours: true, deletedAt: true }, orderBy: { id: 'asc' },
  });
  const dependencies = await transaction.$queryRaw<Array<{ from: string; to: string; removedAt: Date | null }>>(Prisma.sql`
    SELECT d."prerequisite_task_id" AS "from", d."dependent_task_id" AS "to", d."removed_at" AS "removedAt"
    FROM "task_dependencies" d
    WHERE d."project_id" = ${project.id}::uuid AND d."organization_id" = ${project.organizationId}::uuid
    ORDER BY d."prerequisite_task_id" ASC, d."dependent_task_id" ASC, d."id" ASC
  `);
  try {
    return buildActiveProjectGraph(project.graphRevision,
      tasks.map((task) => ({ id: task.id, expectedHours: Number(task.expectedHours.toString()), deletedAt: task.deletedAt })),
      dependencies,
    );
  } catch {
    throw new ProjectTaskError('INVALID_PROJECT_GRAPH');
  }
}

function dependencySummary(row: DependencyRow): DependencySummary { return { ...row }; }
function assignmentSummary(row: AssignmentRow): AssignmentSummary { return { ...row }; }

export class PrismaProjectTaskStore implements ProjectTaskStore {
  constructor(private readonly client: PrismaClient) {}

  async createProject(actor: OrganizationPrincipal, input: CreateProjectInput): Promise<ProjectSummary> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await transaction.project.create({
        data: { organizationId: actor.organizationId, name: input.name, description: input.description ?? null },
        select: { id: true, organizationId: true, name: true, description: true, graphRevision: true },
      });
      await writeProjectDomainEvent(transaction, actor, 'project.created', 'project', project.id, { name: project.name });
      return { ...project, archivedAt: null };
    });
  }

  listProjects(organizationId: string): Promise<readonly ProjectSummary[]> {
    return this.client.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT "id", "organization_id" AS "organizationId", "name", "description",
             "graph_revision" AS "graphRevision", "archived_at" AS "archivedAt"
      FROM "projects" WHERE "organization_id" = ${organizationId}::uuid AND "archived_at" IS NULL
      ORDER BY "created_at" DESC, "id" ASC
    `).then((rows) => rows.map(projectSummary));
  }

  async getProject(organizationId: string, projectId: string): Promise<ProjectSummary | null> {
    const rows = await this.client.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT "id", "organization_id" AS "organizationId", "name", "description",
             "graph_revision" AS "graphRevision", "archived_at" AS "archivedAt"
      FROM "projects" WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid
    `);
    return rows[0] ? projectSummary(rows[0]) : null;
  }

  async updateProject(actor: OrganizationPrincipal, projectId: string, input: UpdateProjectInput): Promise<ProjectSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const changed = await transaction.project.updateMany({
        where: { id: projectId, organizationId: actor.organizationId },
        data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) },
      });
      requireSingleRow(changed.count, 'project.update');
      await writeProjectDomainEvent(transaction, actor, 'project.updated', 'project', projectId, { ...input });
      const updated = await this.projectWithin(transaction, actor.organizationId, projectId);
      if (!updated) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'project.update.read-after-write' });
      return projectSummary(updated);
    });
  }

  async archiveProject(actor: OrganizationPrincipal, projectId: string): Promise<ProjectSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      const now = project.archivedAt ?? new Date();
      if (!project.archivedAt) {
        const archived = await transaction.$executeRaw(Prisma.sql`
          UPDATE "projects" SET "archived_at" = ${now}, "updated_at" = ${now}
          WHERE "id" = ${projectId}::uuid AND "organization_id" = ${actor.organizationId}::uuid AND "archived_at" IS NULL
        `);
        requireSingleRow(archived, 'project.archive');
      }
      const activeAssignments = await transaction.$queryRaw<Array<{ id: string; taskId: string; membershipId: string; userId: string }>>(Prisma.sql`
        SELECT "id", "task_id" AS "taskId", "membership_id" AS "membershipId", "user_id" AS "userId"
        FROM "task_assignments" WHERE "organization_id" = ${actor.organizationId}::uuid
          AND "project_id" = ${projectId}::uuid AND "unassigned_at" IS NULL
        ORDER BY "id" ASC FOR UPDATE
      `);
      if (activeAssignments.length > 0) {
        const released = await transaction.taskAssignment.updateMany({
          where: { organizationId: actor.organizationId, projectId, id: { in: activeAssignments.map(({ id }) => id) }, unassignedAt: null },
          data: { unassignedAt: now },
        });
        if (released.count !== activeAssignments.length) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'project.archive.assignment-release' });
        for (const assignment of activeAssignments) {
          await writeProjectDomainEvent(transaction, actor, 'assignment.removed', 'assignment', assignment.id, {
            projectId, taskId: assignment.taskId, membershipId: assignment.membershipId,
            userId: assignment.userId, reason: 'project_archived',
          });
        }
      }
      if (!project.archivedAt) await writeProjectDomainEvent(transaction, actor, 'project.archived', 'project', projectId, { archivedAt: now.toISOString() });
      return projectSummary({ ...project, archivedAt: now });
    });
  }

  async createTask(actor: OrganizationPrincipal, projectId: string, input: CreateTaskInput): Promise<TaskSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const created = await transaction.task.create({
        data: {
          projectId, organizationId: actor.organizationId, name: input.name,
          description: input.description ?? null,
          optimisticHours: new Prisma.Decimal(input.optimisticHours),
          likelyHours: new Prisma.Decimal(input.likelyHours),
          pessimisticHours: new Prisma.Decimal(input.pessimisticHours),
        },
      });
      await incrementGraphRevision(transaction, projectId, actor.organizationId);
      const task = taskSummary(created);
      await writeProjectDomainEvent(transaction, actor, 'task.created', 'task', task.id, {
        projectId, name: task.name, optimisticHours: task.optimisticHours,
        likelyHours: task.likelyHours, pessimisticHours: task.pessimisticHours,
      });
      return task;
    });
  }

  async getTask(organizationId: string, projectId: string, taskId: string): Promise<TaskSummary | null> {
    const task = await this.client.task.findFirst({ where: { organizationId, projectId, id: taskId, deletedAt: null } });
    return task ? taskSummary(task) : null;
  }

  async listTasks(organizationId: string, projectId: string): Promise<readonly TaskSummary[] | null> {
    if (!await this.projectExists(organizationId, projectId)) return null;
    const tasks = await this.client.task.findMany({
      where: { organizationId, projectId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return tasks.map(taskSummary);
  }

  async updateTask(actor: OrganizationPrincipal, canUpdateAny: boolean, projectId: string, taskId: string, input: UpdateTaskInput): Promise<TaskSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const current = await taskById(transaction, actor.organizationId, projectId, taskId);
      if (!current) return null;
      if (current.version !== input.expectedVersion) throw new ProjectTaskError('TASK_VERSION_CONFLICT');
      if (!canUpdateAny) {
        const assignment = await transaction.taskAssignment.findFirst({
          where: { organizationId: actor.organizationId, projectId, taskId, membershipId: actor.membershipId, unassignedAt: null },
          select: { id: true },
        });
        if (!assignment) throw new ProjectTaskError('TASK_NOT_FOUND');
      }
      const graphChanged = input.optimisticHours !== undefined && (
        Number(current.optimisticHours.toString()) !== input.optimisticHours ||
        Number(current.likelyHours.toString()) !== input.likelyHours ||
        Number(current.pessimisticHours.toString()) !== input.pessimisticHours
      );
      const data: Prisma.TaskUpdateManyMutationInput = {
        version: { increment: 1 },
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.optimisticHours !== undefined ? {
          optimisticHours: new Prisma.Decimal(input.optimisticHours),
          likelyHours: new Prisma.Decimal(input.likelyHours!),
          pessimisticHours: new Prisma.Decimal(input.pessimisticHours!),
        } : {}),
      };
      const result = await transaction.task.updateMany({
        where: { id: taskId, projectId, organizationId: actor.organizationId, deletedAt: null, version: input.expectedVersion }, data,
      });
      if (result.count !== 1) throw new ProjectTaskError('TASK_VERSION_CONFLICT');
      const updated = await taskById(transaction, actor.organizationId, projectId, taskId);
      if (!updated) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'task.update.read-after-write' });
      if (graphChanged) await incrementGraphRevision(transaction, projectId, actor.organizationId);
      const task = taskSummary(updated);
      await writeProjectDomainEvent(transaction, actor, 'task.updated', 'task', taskId, {
        projectId, version: task.version, graphChanged, name: task.name,
      });
      return task;
    });
  }

  async softDeleteTask(actor: OrganizationPrincipal, projectId: string, taskId: string, expectedVersion: number): Promise<TaskSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const current = await taskById(transaction, actor.organizationId, projectId, taskId);
      if (!current) return null;
      if (current.version !== expectedVersion) throw new ProjectTaskError('TASK_VERSION_CONFLICT');
      const now = new Date();
      const updated = await transaction.task.updateMany({
        where: { id: taskId, projectId, organizationId: actor.organizationId, deletedAt: null, version: expectedVersion },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ProjectTaskError('TASK_VERSION_CONFLICT');
      const assignmentRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "task_assignments" WHERE "organization_id" = ${actor.organizationId}::uuid
          AND "project_id" = ${projectId}::uuid AND "task_id" = ${taskId}::uuid AND "unassigned_at" IS NULL
        ORDER BY "id" ASC FOR UPDATE
      `);
      if (assignmentRows.length > 0) {
        const released = await transaction.taskAssignment.updateMany({
          where: { id: { in: assignmentRows.map((row) => row.id) }, unassignedAt: null }, data: { unassignedAt: now },
        });
        if (released.count !== assignmentRows.length) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'task.delete.assignment-release' });
        for (const row of assignmentRows) await writeProjectDomainEvent(transaction, actor, 'assignment.removed', 'assignment', row.id, { projectId, taskId, reason: 'task_deleted' });
      }
      await incrementGraphRevision(transaction, projectId, actor.organizationId);
      const deleted = await taskById(transaction, actor.organizationId, projectId, taskId, true);
      if (!deleted) throw new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'task.delete.read-after-write' });
      const task = taskSummary(deleted);
      await writeProjectDomainEvent(transaction, actor, 'task.deleted', 'task', taskId, { projectId, version: task.version, deletedAt: now.toISOString() });
      return task;
    });
  }

  async activeGraph(organizationId: string, projectId: string): Promise<ProjectGraphSnapshot | null> {
    return withTransaction(this.client, async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))::text AS "locked"
      `);
      const rows = await transaction.$queryRaw<ProjectRow[]>(Prisma.sql`
        SELECT "id", "organization_id" AS "organizationId", "name", "description",
               "graph_revision" AS "graphRevision", "archived_at" AS "archivedAt"
        FROM "projects" WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE
      `);
      const project = rows[0];
      if (!project) return null;
      if (project.archivedAt) throw new ProjectTaskError('PROJECT_ARCHIVED');
      return activeGraphIn(transaction, project);
    });
  }

  async addDependency(actor: OrganizationPrincipal, projectId: string, prerequisiteTaskId: string, dependentTaskId: string): Promise<DependencySummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const tasks = await transaction.task.findMany({
        where: { organizationId: actor.organizationId, projectId, deletedAt: null, id: { in: [prerequisiteTaskId, dependentTaskId] } },
        select: { id: true },
      });
      if (tasks.length !== 2) return null;
      const snapshot = await activeGraphIn(transaction, project);
      const analysis = analyzeDependencyAddition(snapshot, prerequisiteTaskId, dependentTaskId);
      if (analysis.isErr) {
        if (analysis.error.code === 'GRAPH_CYCLE_DETECTED') throw new ProjectTaskError('DEPENDENCY_CYCLE');
        throw new ProjectTaskError('INVALID_PROJECT_GRAPH', { graphCode: analysis.error.code });
      }
      const prior = await transaction.$queryRaw<DependencyRow[]>(Prisma.sql`
        SELECT "id", "project_id" AS "projectId", "organization_id" AS "organizationId",
               "prerequisite_task_id" AS "prerequisiteTaskId", "dependent_task_id" AS "dependentTaskId",
               "created_at" AS "createdAt", "removed_at" AS "removedAt"
        FROM "task_dependencies" WHERE "project_id" = ${projectId}::uuid AND "organization_id" = ${actor.organizationId}::uuid
          AND "prerequisite_task_id" = ${prerequisiteTaskId}::uuid AND "dependent_task_id" = ${dependentTaskId}::uuid AND "removed_at" IS NULL
      `);
      if (prior.length) throw new ProjectTaskError('DEPENDENCY_EXISTS');
      const id = randomUUID();
      const now = new Date();
      let inserted: DependencyRow[];
      try {
        inserted = await transaction.$queryRaw<DependencyRow[]>(Prisma.sql`
        INSERT INTO "task_dependencies" ("id", "project_id", "organization_id", "prerequisite_task_id", "dependent_task_id", "created_at")
        VALUES (${id}::uuid, ${projectId}::uuid, ${actor.organizationId}::uuid, ${prerequisiteTaskId}::uuid, ${dependentTaskId}::uuid, ${now})
        RETURNING "id", "project_id" AS "projectId", "organization_id" AS "organizationId",
          "prerequisite_task_id" AS "prerequisiteTaskId", "dependent_task_id" AS "dependentTaskId",
          "created_at" AS "createdAt", "removed_at" AS "removedAt"
        `);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ProjectTaskError('DEPENDENCY_EXISTS');
        if (isForeignKeyViolation(error)) throw new ProjectTaskError('TASK_NOT_FOUND');
        throw error;
      }
      await incrementGraphRevision(transaction, projectId, actor.organizationId);
      const dependency = inserted[0];
      if (!dependency) throw new ProjectTaskError('INVALID_PROJECT_GRAPH');
      await writeProjectDomainEvent(transaction, actor, 'dependency.added', 'dependency', dependency.id, { projectId, prerequisiteTaskId, dependentTaskId });
      return dependencySummary(dependency);
    });
  }

  async removeDependency(actor: OrganizationPrincipal, projectId: string, dependencyId: string): Promise<DependencySummary | null> {
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const now = new Date();
      const rows = await transaction.$queryRaw<DependencyRow[]>(Prisma.sql`
        UPDATE "task_dependencies" SET "removed_at" = ${now}
        WHERE "id" = ${dependencyId}::uuid AND "project_id" = ${projectId}::uuid
          AND "organization_id" = ${actor.organizationId}::uuid AND "removed_at" IS NULL
        RETURNING "id", "project_id" AS "projectId", "organization_id" AS "organizationId",
          "prerequisite_task_id" AS "prerequisiteTaskId", "dependent_task_id" AS "dependentTaskId",
          "created_at" AS "createdAt", "removed_at" AS "removedAt"
      `);
      const dependency = rows[0];
      if (!dependency) return null;
      await incrementGraphRevision(transaction, projectId, actor.organizationId);
      await writeProjectDomainEvent(transaction, actor, 'dependency.removed', 'dependency', dependency.id, {
        projectId, prerequisiteTaskId: dependency.prerequisiteTaskId, dependentTaskId: dependency.dependentTaskId,
      });
      return dependencySummary(dependency);
    });
  }

  async listTaskDependencies(organizationId: string, projectId: string, taskId: string): Promise<readonly DependencySummary[] | null> {
    if (!await this.client.task.findFirst({ where: { id: taskId, projectId, organizationId, deletedAt: null }, select: { id: true } })) return null;
    return this.client.$queryRaw<DependencyRow[]>(Prisma.sql`
      SELECT "id", "project_id" AS "projectId", "organization_id" AS "organizationId",
        "prerequisite_task_id" AS "prerequisiteTaskId", "dependent_task_id" AS "dependentTaskId",
        "created_at" AS "createdAt", "removed_at" AS "removedAt"
      FROM "task_dependencies" WHERE "project_id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid
        AND ("prerequisite_task_id" = ${taskId}::uuid OR "dependent_task_id" = ${taskId}::uuid)
      ORDER BY "created_at" ASC, "id" ASC
    `).then((rows) => rows.map(dependencySummary));
  }

  async assignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, membershipId: string): Promise<AssignmentSummary | null> {
    return withTransaction(this.client, async (transaction) => {
      const memberships = await lockActor(transaction, actor, [membershipId]);
      const target = memberships.get(membershipId);
      assertAssignmentTargetActive(actor.organizationId, target);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const task = await taskById(transaction, actor.organizationId, projectId, taskId);
      if (!task) return null;
      const existing = await transaction.taskAssignment.findFirst({
        where: { organizationId: actor.organizationId, taskId, userId: target.userId, unassignedAt: null }, select: { id: true },
      });
      if (existing) throw new ProjectTaskError('ASSIGNMENT_EXISTS');
      const created = await transaction.taskAssignment.create({
        data: { taskId, projectId, organizationId: actor.organizationId, membershipId, userId: target.userId },
        include: { membership: { include: { user: { select: { displayName: true } } } } },
      }).catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ProjectTaskError('ASSIGNMENT_EXISTS');
        if (isForeignKeyViolation(error)) throw new ProjectTaskError('TASK_NOT_FOUND');
        throw error;
      });
      const assignment: AssignmentSummary = {
        id: created.id, taskId: created.taskId, projectId: created.projectId, organizationId: created.organizationId,
        membershipId: created.membershipId, userId: created.userId,
        displayName: created.membership.user.displayName, assignedAt: created.assignedAt, unassignedAt: created.unassignedAt,
      };
      await writeProjectDomainEvent(transaction, actor, 'assignment.added', 'assignment', assignment.id, { projectId, taskId, membershipId, userId: target.userId });
      return assignment;
    });
  }

  async unassignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, assignmentId: string): Promise<AssignmentSummary | null> {
    const target = await this.client.taskAssignment.findFirst({
      where: { id: assignmentId, projectId, taskId, organizationId: actor.organizationId }, select: { membershipId: true },
    });
    if (!target) return null;
    return withTransaction(this.client, async (transaction) => {
      await lockActor(transaction, actor, [target.membershipId]);
      const project = await lockProject(transaction, projectId, actor.organizationId);
      if (!project) return null;
      requireWritableProject(project);
      const rows = await transaction.$queryRaw<AssignmentRow[]>(Prisma.sql`
        SELECT a."id", a."task_id" AS "taskId", a."project_id" AS "projectId", a."organization_id" AS "organizationId",
          a."membership_id" AS "membershipId", a."user_id" AS "userId", u."display_name" AS "displayName",
          a."assigned_at" AS "assignedAt", a."unassigned_at" AS "unassignedAt"
        FROM "task_assignments" a JOIN "users" u ON u."id" = a."user_id"
        WHERE a."id" = ${assignmentId}::uuid AND a."task_id" = ${taskId}::uuid
          AND a."project_id" = ${projectId}::uuid AND a."organization_id" = ${actor.organizationId}::uuid
          AND a."unassigned_at" IS NULL
        ORDER BY a."id" ASC FOR UPDATE OF a
      `);
      const current = rows[0];
      if (!current) return null;
      const now = new Date();
      const changed = await transaction.taskAssignment.updateMany({ where: { id: assignmentId, unassignedAt: null }, data: { unassignedAt: now } });
      requireSingleRow(changed.count, 'assignment.unassign');
      const assignment = { ...current, unassignedAt: now };
      await writeProjectDomainEvent(transaction, actor, 'assignment.removed', 'assignment', assignmentId, { projectId, taskId, membershipId: current.membershipId, userId: current.userId });
      return assignmentSummary(assignment);
    });
  }

  async listTaskAssignments(organizationId: string, projectId: string, taskId: string, ownMembershipId: string | null): Promise<readonly AssignmentSummary[] | null> {
    if (!await this.client.task.findFirst({ where: { id: taskId, projectId, organizationId }, select: { id: true } })) return null;
    const rows = await this.client.$queryRaw<AssignmentRow[]>(Prisma.sql`
      SELECT a."id", a."task_id" AS "taskId", a."project_id" AS "projectId", a."organization_id" AS "organizationId",
        a."membership_id" AS "membershipId", a."user_id" AS "userId", u."display_name" AS "displayName",
        a."assigned_at" AS "assignedAt", a."unassigned_at" AS "unassignedAt"
      FROM "task_assignments" a JOIN "users" u ON u."id" = a."user_id"
      WHERE a."task_id" = ${taskId}::uuid AND a."project_id" = ${projectId}::uuid
        AND a."organization_id" = ${organizationId}::uuid
        AND (${ownMembershipId}::uuid IS NULL OR a."membership_id" = ${ownMembershipId}::uuid)
      ORDER BY a."assigned_at" ASC, a."id" ASC
    `);
    return rows.map(assignmentSummary);
  }

  private async projectWithin(transaction: Tx, organizationId: string, projectId: string): Promise<ProjectRow | null> {
    const rows = await transaction.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT "id", "organization_id" AS "organizationId", "name", "description",
        "graph_revision" AS "graphRevision", "archived_at" AS "archivedAt"
      FROM "projects" WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid
    `);
    return rows[0] ?? null;
  }

  private async projectExists(organizationId: string, projectId: string): Promise<boolean> {
    const rows = await this.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid AND "organization_id" = ${organizationId}::uuid
    `);
    return rows.length === 1;
  }
}
