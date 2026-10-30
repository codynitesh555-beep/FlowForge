export interface User { id: string; email: string; displayName: string }
export interface Organization { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }
export interface OrganizationMember { id: string; userId: string; email: string; displayName: string; role: Organization['role']; status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' }
export interface AuthSession { user: User; accessToken: string; accessTokenExpiresAt: string }
export interface Project { id: string; organizationId: string; name: string; description: string | null; graphRevision: number; archivedAt: string | null }
export interface Task {
  id: string; projectId: string; organizationId: string; name: string; description: string | null;
  optimisticHours: number; likelyHours: number; pessimisticHours: number; expectedHours: number; varianceHours: number;
  version: number; deletedAt: string | null;
}
export interface Dependency { id: string; projectId: string; organizationId: string; prerequisiteTaskId: string; dependentTaskId: string; createdAt: string; removedAt: string | null }
export interface Assignment { id: string; taskId: string; projectId: string; organizationId: string; membershipId: string; userId: string; displayName: string; assignedAt: string; unassignedAt: string | null }
export interface Schedule {
  graphRevision: number; projectDurationHours: number; topologicalOrder: string[]; criticalTaskIds: string[];
  criticalPaths: string[][]; isCriticalPathsTruncated: boolean;
  taskMetrics: { taskId: string; earlyStartHours: number; earlyFinishHours: number; lateStartHours: number; lateFinishHours: number; totalSlackHours: number; freeSlackHours: number; isCritical: boolean }[];
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

type RefreshedSession = { accessToken: string; accessTokenExpiresAt: string };
let refreshInFlight: Promise<RefreshedSession> | null = null;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string, retryUnauthorized = true): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && accessToken && retryUnauthorized) {
    const refreshed = await refreshSession();
    return request<T>(path, init, refreshed.accessToken, false);
  }
  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    try { code = (await response.json() as { code?: string }).code ?? code; } catch { /* Keep the generic code. */ }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function refreshSession(): Promise<RefreshedSession> {
  if (!refreshInFlight) {
    const current = request<RefreshedSession>('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'x-flowforge-csrf': '1' },
    })
      .finally(() => {
        if (refreshInFlight === current) refreshInFlight = null;
      });
    refreshInFlight = current;
  }
  return refreshInFlight;
}

const org = (organizationId: string) => `/v1/organizations/${encodeURIComponent(organizationId)}`;
const project = (organizationId: string, projectId: string) => `${org(organizationId)}/projects/${encodeURIComponent(projectId)}`;
const task = (organizationId: string, projectId: string, taskId: string) => `${project(organizationId, projectId)}/tasks/${encodeURIComponent(taskId)}`;

export const api = {
  register: (input: { email: string; displayName: string; password: string }) => request<User>('/v1/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) => request<AuthSession>('/v1/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  refresh: refreshSession,
  logout: (token: string) => request<void>('/v1/auth/logout', { method: 'POST' }, token),
  organizations: (token: string) => request<Organization[]>('/v1/organizations', {}, token),
  members: (token: string, organizationId: string) => request<OrganizationMember[]>(`${org(organizationId)}/members`, {}, token),
  createOrganization: (token: string, input: { name: string; slug: string }) => request<Omit<Organization, 'role'>>('/v1/organizations', { method: 'POST', body: JSON.stringify(input) }, token),
  projects: (token: string, organizationId: string) => request<Project[]>(`${org(organizationId)}/projects`, {}, token),
  createProject: (token: string, organizationId: string, input: { name: string; description?: string }) => request<Project>(`${org(organizationId)}/projects`, { method: 'POST', body: JSON.stringify(input) }, token),
  updateProject: (token: string, organizationId: string, projectId: string, input: { name?: string; description?: string | null }) => request<Project>(project(organizationId, projectId), { method: 'PATCH', body: JSON.stringify(input) }, token),
  archiveProject: (token: string, organizationId: string, projectId: string) => request<Project>(`${project(organizationId, projectId)}/archive`, { method: 'POST' }, token),
  tasks: (token: string, organizationId: string, projectId: string) => request<Task[]>(`${project(organizationId, projectId)}/tasks`, {}, token),
  createTask: (token: string, organizationId: string, projectId: string, input: Omit<Task, 'id' | 'projectId' | 'organizationId' | 'expectedHours' | 'varianceHours' | 'version' | 'deletedAt'>) => request<Task>(`${project(organizationId, projectId)}/tasks`, { method: 'POST', body: JSON.stringify(input) }, token),
  updateTask: (token: string, organizationId: string, projectId: string, taskId: string, input: Partial<Omit<Task, 'id' | 'projectId' | 'organizationId' | 'expectedHours' | 'varianceHours' | 'version' | 'deletedAt'>> & { expectedVersion: number }) => request<Task>(task(organizationId, projectId, taskId), { method: 'PATCH', body: JSON.stringify(input) }, token),
  deleteTask: (token: string, organizationId: string, projectId: string, taskId: string, expectedVersion: number) => request<Task>(`${task(organizationId, projectId, taskId)}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }, token),
  dependencies: (token: string, organizationId: string, projectId: string, taskId: string) => request<Dependency[]>(`${task(organizationId, projectId, taskId)}/dependencies`, {}, token),
  addDependency: (token: string, organizationId: string, projectId: string, input: { prerequisiteTaskId: string; dependentTaskId: string }) => request<Dependency>(`${project(organizationId, projectId)}/dependencies`, { method: 'POST', body: JSON.stringify(input) }, token),
  removeDependency: (token: string, organizationId: string, projectId: string, dependencyId: string) => request<Dependency>(`${project(organizationId, projectId)}/dependencies/${encodeURIComponent(dependencyId)}`, { method: 'DELETE' }, token),
  assignments: (token: string, organizationId: string, projectId: string, taskId: string) => request<Assignment[]>(`${task(organizationId, projectId, taskId)}/assignments`, {}, token),
  assign: (token: string, organizationId: string, projectId: string, taskId: string, membershipId: string) => request<Assignment>(`${task(organizationId, projectId, taskId)}/assignments`, { method: 'POST', body: JSON.stringify({ membershipId }) }, token),
  unassign: (token: string, organizationId: string, projectId: string, taskId: string, assignmentId: string) => request<Assignment>(`${task(organizationId, projectId, taskId)}/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' }, token),
  schedule: (token: string, organizationId: string, projectId: string) => request<Schedule>(`${project(organizationId, projectId)}/schedule`, {}, token),
};
