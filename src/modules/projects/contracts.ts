import type { GraphEdge, GraphNode } from '../graph/index.js';
import type { OrganizationPrincipal } from '../identity/domain/policies.js';

/** Request types deliberately omit organizationId; the actor is the scope. */
export interface CreateProjectInput { readonly name: string; readonly description?: string | null }
export interface UpdateProjectInput { readonly name?: string; readonly description?: string | null }
export interface CreateTaskInput {
  readonly name: string;
  readonly description?: string | null;
  readonly optimisticHours: number;
  readonly likelyHours: number;
  readonly pessimisticHours: number;
}
export interface UpdateTaskInput {
  readonly expectedVersion: number;
  readonly name?: string;
  readonly description?: string | null;
  readonly optimisticHours?: number;
  readonly likelyHours?: number;
  readonly pessimisticHours?: number;
}

export interface ProjectSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly graphRevision: number;
  readonly archivedAt: Date | null;
}
export interface TaskSummary {
  readonly id: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly optimisticHours: number;
  readonly likelyHours: number;
  readonly pessimisticHours: number;
  readonly expectedHours: number;
  readonly varianceHours: number;
  readonly version: number;
  readonly deletedAt: Date | null;
}
export interface DependencySummary {
  readonly id: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly prerequisiteTaskId: string;
  readonly dependentTaskId: string;
  readonly createdAt: Date;
  readonly removedAt: Date | null;
}
export interface AssignmentSummary {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly assignedAt: Date;
  readonly unassignedAt: Date | null;
}
export interface SchedulingAnalysis {
  readonly graphRevision: number;
  readonly projectDurationHours: number;
  readonly topologicalOrder: readonly string[];
  readonly criticalTaskIds: readonly string[];
  readonly criticalPaths: readonly (readonly string[])[];
  readonly isCriticalPathsTruncated: boolean;
  readonly taskMetrics: readonly {
    readonly taskId: string;
    readonly earlyStartHours: number;
    readonly earlyFinishHours: number;
    readonly lateStartHours: number;
    readonly lateFinishHours: number;
    readonly totalSlackHours: number;
    readonly freeSlackHours: number;
    readonly isCritical: boolean;
  }[];
}

export interface ProjectGraphSnapshot {
  readonly graphRevision: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** Store methods are organization-scoped; mutations must be atomic with audit and outbox writes. */
export interface ProjectTaskStore {
  createProject(actor: OrganizationPrincipal, input: CreateProjectInput): Promise<ProjectSummary>;
  listProjects(organizationId: string): Promise<readonly ProjectSummary[]>;
  getProject(organizationId: string, projectId: string): Promise<ProjectSummary | null>;
  updateProject(actor: OrganizationPrincipal, projectId: string, input: UpdateProjectInput): Promise<ProjectSummary | null>;
  archiveProject(actor: OrganizationPrincipal, projectId: string): Promise<ProjectSummary | null>;
  createTask(actor: OrganizationPrincipal, projectId: string, input: CreateTaskInput): Promise<TaskSummary | null>;
  getTask(organizationId: string, projectId: string, taskId: string): Promise<TaskSummary | null>;
  listTasks(organizationId: string, projectId: string): Promise<readonly TaskSummary[] | null>;
  updateTask(actor: OrganizationPrincipal, canUpdateAny: boolean, projectId: string, taskId: string, input: UpdateTaskInput): Promise<TaskSummary | null>;
  softDeleteTask(actor: OrganizationPrincipal, projectId: string, taskId: string, expectedVersion: number): Promise<TaskSummary | null>;
  activeGraph(organizationId: string, projectId: string): Promise<ProjectGraphSnapshot | null>;
  addDependency(actor: OrganizationPrincipal, projectId: string, prerequisiteTaskId: string, dependentTaskId: string): Promise<DependencySummary | null>;
  removeDependency(actor: OrganizationPrincipal, projectId: string, dependencyId: string): Promise<DependencySummary | null>;
  listTaskDependencies(organizationId: string, projectId: string, taskId: string): Promise<readonly DependencySummary[] | null>;
  assignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, membershipId: string): Promise<AssignmentSummary | null>;
  unassignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, assignmentId: string): Promise<AssignmentSummary | null>;
  listTaskAssignments(organizationId: string, projectId: string, taskId: string, ownMembershipId: string | null): Promise<readonly AssignmentSummary[] | null>;
}

export interface ProjectTaskService {
  createProject(actor: OrganizationPrincipal, input: unknown): Promise<ProjectSummary>;
  listProjects(actor: OrganizationPrincipal): Promise<readonly ProjectSummary[]>;
  getProject(actor: OrganizationPrincipal, projectId: string): Promise<ProjectSummary>;
  updateProject(actor: OrganizationPrincipal, projectId: string, input: unknown): Promise<ProjectSummary>;
  archiveProject(actor: OrganizationPrincipal, projectId: string): Promise<ProjectSummary>;
  createTask(actor: OrganizationPrincipal, projectId: string, input: unknown): Promise<TaskSummary>;
  getTask(actor: OrganizationPrincipal, projectId: string, taskId: string): Promise<TaskSummary>;
  listTasks(actor: OrganizationPrincipal, projectId: string): Promise<readonly TaskSummary[]>;
  updateTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown): Promise<TaskSummary>;
  softDeleteTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown): Promise<TaskSummary>;
  analyzeProject(actor: OrganizationPrincipal, projectId: string): Promise<SchedulingAnalysis>;
  addDependency(actor: OrganizationPrincipal, projectId: string, input: unknown): Promise<DependencySummary>;
  removeDependency(actor: OrganizationPrincipal, projectId: string, dependencyId: string): Promise<DependencySummary>;
  listTaskDependencies(actor: OrganizationPrincipal, projectId: string, taskId: string): Promise<readonly DependencySummary[]>;
  assignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, input: unknown): Promise<AssignmentSummary>;
  unassignTask(actor: OrganizationPrincipal, projectId: string, taskId: string, assignmentId: string): Promise<AssignmentSummary>;
  listTaskAssignments(actor: OrganizationPrincipal, projectId: string, taskId: string): Promise<readonly AssignmentSummary[]>;
}
