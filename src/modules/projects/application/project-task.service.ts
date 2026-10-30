import { hasPermission, assertPermission } from '../../identity/domain/permissions.js';
import type { OrganizationPrincipal } from '../../identity/domain/policies.js';
import { z } from 'zod';
import { analyzeProjectSnapshot } from '../scheduling.js';
import { compareStringDeterministic } from '../../graph/index.js';
import type { ProjectTaskStore, ProjectTaskService as ProjectTaskServicePort, SchedulingAnalysis } from '../contracts.js';
import { ProjectTaskError } from '../domain/errors.js';
import {
  AddDependencySchema, AssignTaskSchema, CreateProjectSchema, CreateTaskSchema, DeleteTaskSchema,
  UpdateProjectSchema, UpdateTaskSchema, validatePertEstimate, validateProjectInput,
} from '../domain/validation.js';

const ProjectIdSchema = z.string().uuid();

export class DefaultProjectTaskService implements ProjectTaskServicePort {
  constructor(private readonly store: ProjectTaskStore) {}

  async createProject(actor: OrganizationPrincipal, input: unknown) {
    assertPermission(actor, actor.organizationId, 'project:create');
    const data = validateProjectInput(CreateProjectSchema, input, 'INVALID_PROJECT_INPUT');
    return this.store.createProject(actor, data);
  }

  async listProjects(actor: OrganizationPrincipal) {
    assertPermission(actor, actor.organizationId, 'project:read');
    return this.store.listProjects(actor.organizationId);
  }

  async getProject(actor: OrganizationPrincipal, projectId: string) {
    assertPermission(actor, actor.organizationId, 'project:read');
    this.validateId(projectId);
    const project = await this.store.getProject(actor.organizationId, projectId);
    if (!project) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    return project;
  }

  async updateProject(actor: OrganizationPrincipal, projectId: string, input: unknown) {
    assertPermission(actor, actor.organizationId, 'project:update');
    this.validateId(projectId);
    const data = validateProjectInput(UpdateProjectSchema, input, 'INVALID_PROJECT_INPUT');
    const project = await this.store.updateProject(actor, projectId, data);
    if (!project) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    return project;
  }

  async archiveProject(actor: OrganizationPrincipal, projectId: string) {
    assertPermission(actor, actor.organizationId, 'project:archive');
    this.validateId(projectId);
    const project = await this.store.archiveProject(actor, projectId);
    if (!project) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    return project;
  }

  async createTask(actor: OrganizationPrincipal, projectId: string, input: unknown) {
    assertPermission(actor, actor.organizationId, 'task:create');
    this.validateId(projectId);
    const data = validateProjectInput(CreateTaskSchema, input, 'INVALID_TASK_INPUT');
    validatePertEstimate(data);
    const task = await this.store.createTask(actor, projectId, data);
    if (!task) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    return task;
  }

  async getTask(actor: OrganizationPrincipal, projectId: string, taskId: string) {
    assertPermission(actor, actor.organizationId, 'task:read');
    this.validateId(projectId); this.validateId(taskId);
    const task = await this.store.getTask(actor.organizationId, projectId, taskId);
    if (!task) throw new ProjectTaskError('TASK_NOT_FOUND');
    return task;
  }

  async listTasks(actor: OrganizationPrincipal, projectId: string) {
    assertPermission(actor, actor.organizationId, 'task:read');
    this.validateId(projectId);
    const tasks = await this.store.listTasks(actor.organizationId, projectId);
    if (!tasks) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    return tasks;
  }

  async updateTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown) {
    this.validateId(projectId); this.validateId(taskId);
    const data = validateProjectInput(UpdateTaskSchema, input, 'INVALID_TASK_INPUT');
    if (data.optimisticHours !== undefined) {
      validatePertEstimate({
        optimisticHours: data.optimisticHours,
        likelyHours: data.likelyHours!,
        pessimisticHours: data.pessimisticHours!,
      });
    }
    const canUpdateAny = hasPermission(actor.role, 'task:update-any');
    assertPermission(actor, actor.organizationId, canUpdateAny ? 'task:update-any' : 'task:update-assigned');
    const task = await this.store.updateTask(
      actor, canUpdateAny, projectId, taskId, data,
    );
    if (!task) throw new ProjectTaskError('TASK_NOT_FOUND');
    return task;
  }

  async softDeleteTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown) {
    assertPermission(actor, actor.organizationId, 'task:soft-delete');
    this.validateId(projectId); this.validateId(taskId);
    const data = validateProjectInput(DeleteTaskSchema, input, 'INVALID_TASK_INPUT');
    const task = await this.store.softDeleteTask(actor, projectId, taskId, data.expectedVersion);
    if (!task) throw new ProjectTaskError('TASK_NOT_FOUND');
    return task;
  }

  async analyzeProject(actor: OrganizationPrincipal, projectId: string): Promise<SchedulingAnalysis> {
    assertPermission(actor, actor.organizationId, 'schedule:run');
    this.validateId(projectId);
    const snapshot = await this.store.activeGraph(actor.organizationId, projectId);
    if (!snapshot) throw new ProjectTaskError('PROJECT_NOT_FOUND');
    const result = analyzeProjectSnapshot(snapshot);
    if (result.isErr) {
      if (result.error.code === 'GRAPH_CYCLE_DETECTED') throw new ProjectTaskError('DEPENDENCY_CYCLE');
      throw new ProjectTaskError('INVALID_PROJECT_GRAPH', { graphCode: result.error.code });
    }
    const analysis = result.value;
    return {
      graphRevision: snapshot.graphRevision,
      projectDurationHours: analysis.projectDurationHours,
      topologicalOrder: analysis.topologicalOrder,
      criticalTaskIds: [...analysis.criticalTaskIds].sort(compareStringDeterministic),
      criticalPaths: analysis.criticalPaths,
      isCriticalPathsTruncated: analysis.isCriticalPathsTruncated,
      taskMetrics: [...analysis.taskMetrics.values()].sort((a, b) => compareStringDeterministic(a.taskId, b.taskId)),
    };
  }

  async addDependency(actor: OrganizationPrincipal, projectId: string, input: unknown) {
    assertPermission(actor, actor.organizationId, 'dependency:manage');
    this.validateId(projectId);
    const data = validateProjectInput(AddDependencySchema, input, 'INVALID_TASK_INPUT');
    if (data.prerequisiteTaskId === data.dependentTaskId) throw new ProjectTaskError('DEPENDENCY_CYCLE');
    const dependency = await this.store.addDependency(
      actor, projectId, data.prerequisiteTaskId, data.dependentTaskId,
    );
    if (!dependency) throw new ProjectTaskError('TASK_NOT_FOUND');
    return dependency;
  }

  async removeDependency(actor: OrganizationPrincipal, projectId: string, dependencyId: string) {
    assertPermission(actor, actor.organizationId, 'dependency:manage');
    this.validateId(projectId); this.validateId(dependencyId);
    const dependency = await this.store.removeDependency(actor, projectId, dependencyId);
    if (!dependency) throw new ProjectTaskError('DEPENDENCY_NOT_FOUND');
    return dependency;
  }

  async listTaskDependencies(actor: OrganizationPrincipal, projectId: string, taskId: string) {
    assertPermission(actor, actor.organizationId, 'dependency:read');
    this.validateId(projectId); this.validateId(taskId);
    const dependencies = await this.store.listTaskDependencies(actor.organizationId, projectId, taskId);
    if (!dependencies) throw new ProjectTaskError('TASK_NOT_FOUND');
    return dependencies;
  }

  async assignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown) {
    assertPermission(actor, actor.organizationId, 'assignment:manage');
    this.validateId(projectId); this.validateId(taskId);
    const data = validateProjectInput(AssignTaskSchema, input, 'INVALID_TASK_INPUT');
    const assignment = await this.store.assignTask(actor, projectId, taskId, data.membershipId);
    if (!assignment) throw new ProjectTaskError('TASK_NOT_FOUND');
    return assignment;
  }

  async unassignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, assignmentId: string) {
    assertPermission(actor, actor.organizationId, 'assignment:manage');
    this.validateId(projectId); this.validateId(taskId); this.validateId(assignmentId);
    const assignment = await this.store.unassignTask(actor, projectId, taskId, assignmentId);
    if (!assignment) throw new ProjectTaskError('ASSIGNMENT_NOT_FOUND');
    return assignment;
  }

  async listTaskAssignments(actor: OrganizationPrincipal, projectId: string, taskId: string) {
    this.validateId(projectId); this.validateId(taskId);
    const ownOnly = !hasPermission(actor.role, 'assignment:read-all');
    if (ownOnly) assertPermission(actor, actor.organizationId, 'assignment:read-own');
    else assertPermission(actor, actor.organizationId, 'assignment:read-all');
    const assignments = await this.store.listTaskAssignments(
      actor.organizationId, projectId, taskId, ownOnly ? actor.membershipId : null,
    );
    if (!assignments) throw new ProjectTaskError('TASK_NOT_FOUND');
    return assignments;
  }

  private validateId(value: string): void {
    if (!ProjectIdSchema.safeParse(value).success) throw new ProjectTaskError('INVALID_PROJECT_INPUT');
  }
}
