import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ProjectTaskService } from '../modules/projects/contracts.js';
import type { PrismaOrganizationMembershipResolver } from '../modules/identity/infrastructure/prisma-organizations.js';

const Uuid = z.string().uuid();
const OrgParams = z.object({ organizationId: Uuid });
const ProjectParams = OrgParams.extend({ projectId: Uuid });
const TaskParams = ProjectParams.extend({ taskId: Uuid });
const DependencyParams = ProjectParams.extend({ dependencyId: Uuid });
const AssignmentParams = TaskParams.extend({ assignmentId: Uuid });
const ProjectInput = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(20_000).nullable().optional() }).strict();
const ProjectUpdateInput = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().max(20_000).nullable().optional() }).strict();
const EstimateInput = z.number().finite().min(0).max(999999.9999);
const TaskInput = z.object({
  name: z.string().trim().min(1).max(240), description: z.string().max(20_000).nullable().optional(),
  optimisticHours: EstimateInput, likelyHours: EstimateInput, pessimisticHours: EstimateInput,
}).strict();
const TaskUpdateInput = z.object({
  expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(20_000).nullable().optional(),
  optimisticHours: EstimateInput.optional(), likelyHours: EstimateInput.optional(), pessimisticHours: EstimateInput.optional(),
}).strict();
const ProjectSchema = z.object({
  id: Uuid, organizationId: Uuid, name: z.string(), description: z.string().nullable(),
  graphRevision: z.number().int().nonnegative(), archivedAt: z.iso.datetime().nullable(),
});
const TaskSchema = z.object({
  id: Uuid, projectId: Uuid, organizationId: Uuid, name: z.string(), description: z.string().nullable(),
  optimisticHours: z.number(), likelyHours: z.number(), pessimisticHours: z.number(), expectedHours: z.number(), varianceHours: z.number(),
  version: z.number().int().positive(), deletedAt: z.iso.datetime().nullable(),
});
const DependencySchema = z.object({
  id: Uuid, projectId: Uuid, organizationId: Uuid, prerequisiteTaskId: Uuid, dependentTaskId: Uuid,
  createdAt: z.iso.datetime(), removedAt: z.iso.datetime().nullable(),
});
const AssignmentSchema = z.object({
  id: Uuid, taskId: Uuid, projectId: Uuid, organizationId: Uuid, membershipId: Uuid, userId: Uuid,
  displayName: z.string(), assignedAt: z.iso.datetime(), unassignedAt: z.iso.datetime().nullable(),
});
const AnalysisSchema = z.object({
  graphRevision: z.number().int().nonnegative(), projectDurationHours: z.number(),
  topologicalOrder: z.array(Uuid), criticalTaskIds: z.array(Uuid), criticalPaths: z.array(z.array(Uuid)),
  isCriticalPathsTruncated: z.boolean(), taskMetrics: z.array(z.object({
    taskId: Uuid, earlyStartHours: z.number(), earlyFinishHours: z.number(), lateStartHours: z.number(),
    lateFinishHours: z.number(), totalSlackHours: z.number(), freeSlackHours: z.number(), isCritical: z.boolean(),
  })),
});
const ErrorSchema = z.object({ code: z.string() });
const projectJson = <T extends { archivedAt: Date | null }>(project: T) => ({ ...project, archivedAt: project.archivedAt?.toISOString() ?? null });
const taskJson = <T extends { deletedAt: Date | null }>(task: T) => ({ ...task, deletedAt: task.deletedAt?.toISOString() ?? null });
const dependencyJson = <T extends { createdAt: Date; removedAt: Date | null }>(dependency: T) => ({
  ...dependency, createdAt: dependency.createdAt.toISOString(), removedAt: dependency.removedAt?.toISOString() ?? null,
});
const assignmentJson = <T extends { assignedAt: Date; unassignedAt: Date | null }>(assignment: T) => ({
  ...assignment, assignedAt: assignment.assignedAt.toISOString(), unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
});

export interface ProjectTaskRouteOptions {
  readonly service: ProjectTaskService;
  readonly membershipResolver: PrismaOrganizationMembershipResolver;
}

export const projectTaskRoutes = (options: ProjectTaskRouteOptions): FastifyPluginAsync => async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requirePrincipal = async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticateAccessToken(request, reply);
    if (reply.sent || !request.authContext) return;
    const params = OrgParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'INVALID_REQUEST' });
    const principal = await options.membershipResolver.resolveActivePrincipal(request.authContext.userId, params.data.organizationId);
    if (!principal) return reply.code(403).send({ code: 'ORGANIZATION_ACCESS_DENIED' });
    request.organizationPrincipal = principal;
  };

  const authResponse = { 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema };

  app.post('/v1/organizations/:organizationId/projects', {
    preHandler: requirePrincipal,
    schema: { tags: ['Projects'], summary: 'Create a project', security: [{ bearerAuth: [] }], params: OrgParams, body: ProjectInput,
      response: { 201: ProjectSchema, ...authResponse } },
  }, async (request, reply) => reply.code(201).send(projectJson(await options.service.createProject(request.organizationPrincipal!, request.body))));

  app.get('/v1/organizations/:organizationId/projects', {
    preHandler: requirePrincipal,
    schema: { tags: ['Projects'], summary: 'List active organization projects', security: [{ bearerAuth: [] }], params: OrgParams,
      response: { 200: z.array(ProjectSchema), 401: ErrorSchema, 403: ErrorSchema } },
  }, async (request) => (await options.service.listProjects(request.organizationPrincipal!)).map(projectJson));

  app.get('/v1/organizations/:organizationId/projects/:projectId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Projects'], summary: 'Get a project', security: [{ bearerAuth: [] }], params: ProjectParams,
      response: { 200: ProjectSchema, ...authResponse } },
  }, async (request) => projectJson(await options.service.getProject(request.organizationPrincipal!, request.params.projectId)));

  app.patch('/v1/organizations/:organizationId/projects/:projectId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Projects'], summary: 'Update project details', security: [{ bearerAuth: [] }], params: ProjectParams,
      body: ProjectUpdateInput, response: { 200: ProjectSchema, ...authResponse } },
  }, async (request) => projectJson(await options.service.updateProject(request.organizationPrincipal!, request.params.projectId, request.body)));

  app.post('/v1/organizations/:organizationId/projects/:projectId/archive', {
    preHandler: requirePrincipal,
    schema: { tags: ['Projects'], summary: 'Archive a project', security: [{ bearerAuth: [] }], params: ProjectParams,
      response: { 200: ProjectSchema, ...authResponse } },
  }, async (request) => projectJson(await options.service.archiveProject(request.organizationPrincipal!, request.params.projectId)));

  app.get('/v1/organizations/:organizationId/projects/:projectId/tasks', {
    preHandler: requirePrincipal,
    schema: { tags: ['Tasks'], summary: 'List active project tasks', security: [{ bearerAuth: [] }], params: ProjectParams,
      response: { 200: z.array(TaskSchema), ...authResponse } },
  }, async (request) => (await options.service.listTasks(request.organizationPrincipal!, request.params.projectId)).map(taskJson));

  app.post('/v1/organizations/:organizationId/projects/:projectId/tasks', {
    preHandler: requirePrincipal,
    schema: { tags: ['Tasks'], summary: 'Create a task', security: [{ bearerAuth: [] }], params: ProjectParams,
      body: TaskInput, response: { 201: TaskSchema, ...authResponse } },
  }, async (request, reply) => reply.code(201).send(taskJson(await options.service.createTask(request.organizationPrincipal!, request.params.projectId, request.body))));

  app.get('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Tasks'], summary: 'Get a task', security: [{ bearerAuth: [] }], params: TaskParams,
      response: { 200: TaskSchema, ...authResponse } },
  }, async (request) => taskJson(await options.service.getTask(request.organizationPrincipal!, request.params.projectId, request.params.taskId)));

  app.patch('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Tasks'], summary: 'Update a task with optimistic version checking', security: [{ bearerAuth: [] }], params: TaskParams,
      body: TaskUpdateInput, response: { 200: TaskSchema, ...authResponse } },
  }, async (request) => taskJson(await options.service.updateTask(request.organizationPrincipal!, request.params.projectId, request.params.taskId, request.body)));

  app.delete('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Tasks'], summary: 'Soft-delete a task using its expected version', security: [{ bearerAuth: [] }], params: TaskParams,
      querystring: z.object({ expectedVersion: z.coerce.number().int().positive() }),
      response: { 200: TaskSchema, ...authResponse } },
  }, async (request) => taskJson(await options.service.softDeleteTask(request.organizationPrincipal!, request.params.projectId, request.params.taskId, request.query)));

  app.get('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/dependencies', {
    preHandler: requirePrincipal,
    schema: { tags: ['Dependencies'], summary: 'List task dependency history', security: [{ bearerAuth: [] }], params: TaskParams,
      response: { 200: z.array(DependencySchema), ...authResponse } },
  }, async (request) => (await options.service.listTaskDependencies(request.organizationPrincipal!, request.params.projectId, request.params.taskId)).map(dependencyJson));

  app.post('/v1/organizations/:organizationId/projects/:projectId/dependencies', {
    preHandler: requirePrincipal,
    schema: { tags: ['Dependencies'], summary: 'Add a prerequisite edge', security: [{ bearerAuth: [] }], params: ProjectParams,
      body: z.object({ prerequisiteTaskId: Uuid, dependentTaskId: Uuid }).strict(), response: { 201: DependencySchema, ...authResponse } },
  }, async (request, reply) => reply.code(201).send(dependencyJson(await options.service.addDependency(request.organizationPrincipal!, request.params.projectId, request.body))));

  app.delete('/v1/organizations/:organizationId/projects/:projectId/dependencies/:dependencyId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Dependencies'], summary: 'Remove a dependency while retaining its history', security: [{ bearerAuth: [] }], params: DependencyParams,
      response: { 200: DependencySchema, ...authResponse } },
  }, async (request) => dependencyJson(await options.service.removeDependency(request.organizationPrincipal!, request.params.projectId, request.params.dependencyId)));

  app.get('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/assignments', {
    preHandler: requirePrincipal,
    schema: { tags: ['Assignments'], summary: 'List task assignments and history', security: [{ bearerAuth: [] }], params: TaskParams,
      response: { 200: z.array(AssignmentSchema), ...authResponse } },
  }, async (request) => (await options.service.listTaskAssignments(request.organizationPrincipal!, request.params.projectId, request.params.taskId)).map(assignmentJson));

  app.post('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/assignments', {
    preHandler: requirePrincipal,
    schema: { tags: ['Assignments'], summary: 'Assign an active organization member to a task', security: [{ bearerAuth: [] }], params: TaskParams,
      body: z.object({ membershipId: Uuid }).strict(), response: { 201: AssignmentSchema, ...authResponse } },
  }, async (request, reply) => reply.code(201).send(assignmentJson(await options.service.assignTask(request.organizationPrincipal!, request.params.projectId, request.params.taskId, request.body))));

  app.delete('/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/assignments/:assignmentId', {
    preHandler: requirePrincipal,
    schema: { tags: ['Assignments'], summary: 'Unassign a task member while retaining history', security: [{ bearerAuth: [] }], params: AssignmentParams,
      response: { 200: AssignmentSchema, ...authResponse } },
  }, async (request) => assignmentJson(await options.service.unassignTask(request.organizationPrincipal!, request.params.projectId, request.params.taskId, request.params.assignmentId)));

  app.get('/v1/organizations/:organizationId/projects/:projectId/schedule', {
    preHandler: requirePrincipal,
    schema: { tags: ['Scheduling'], summary: 'Analyze the active project graph', security: [{ bearerAuth: [] }], params: ProjectParams,
      response: { 200: AnalysisSchema, ...authResponse } },
  }, async (request) => {
    const analysis = await options.service.analyzeProject(request.organizationPrincipal!, request.params.projectId);
    return {
      ...analysis, topologicalOrder: [...analysis.topologicalOrder], criticalTaskIds: [...analysis.criticalTaskIds],
      criticalPaths: analysis.criticalPaths.map((path) => [...path]), taskMetrics: analysis.taskMetrics.map((metric) => ({ ...metric })),
    };
  });
};

declare module 'fastify' {
  interface FastifyRequest { organizationPrincipal: import('../modules/identity/domain/policies.js').OrganizationPrincipal | null }
}
