import { describe, expect, it, vi } from 'vitest';
import type { OrganizationPrincipal } from '../../identity/domain/policies.js';
import type { ProjectGraphSnapshot, ProjectTaskStore } from '../contracts.js';
import { DefaultProjectTaskService } from './project-task.service.js';

const owner: OrganizationPrincipal = {
  userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151',
  organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152',
  membershipId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd153',
  role: 'OWNER', membershipStatus: 'ACTIVE',
};
const member: OrganizationPrincipal = { ...owner, role: 'MEMBER' };
const snapshot: ProjectGraphSnapshot = {
  graphRevision: 9,
  nodes: [{ id: 'task-a', durationHours: 3 }, { id: 'task-b', durationHours: 4 }],
  edges: [{ from: 'task-a', to: 'task-b' }],
};

function harness(overrides: Partial<ProjectTaskStore> = {}) {
  const store = {
    createProject: vi.fn(async () => ({ id: 'project-1', organizationId: owner.organizationId, name: 'Project', description: null, graphRevision: 0, archivedAt: null })),
    listProjects: vi.fn(async () => []), getProject: vi.fn(async () => null), updateProject: vi.fn(async () => null),
    archiveProject: vi.fn(async () => null), createTask: vi.fn(async () => null), getTask: vi.fn(async () => null),
    listTasks: vi.fn(async () => []), updateTask: vi.fn(async () => null), softDeleteTask: vi.fn(async () => null),
    activeGraph: vi.fn(async () => snapshot), addDependency: vi.fn(async () => null), removeDependency: vi.fn(async () => null),
    listTaskDependencies: vi.fn(async () => []), assignTask: vi.fn(async () => null), unassignTask: vi.fn(async () => null),
    listTaskAssignments: vi.fn(async () => []),
    ...overrides,
  } as unknown as ProjectTaskStore;
  return { service: new DefaultProjectTaskService(store), store };
}

describe('DefaultProjectTaskService', () => {
  it('derives organization scope from the authenticated principal', async () => {
    const { service, store } = harness();
    await service.createProject(owner, { name: '  Launch  ' });
    expect(store.createProject).toHaveBeenCalledWith(owner, { name: 'Launch' });
    expect(store.createProject).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: expect.any(String) }));
  });

  it('denies project creation for members before the repository is called', async () => {
    const { service, store } = harness();
    await expect(service.createProject(member, { name: 'Project' })).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(store.createProject).not.toHaveBeenCalled();
  });

  it('rejects invalid PERT ordering and excess persisted precision', async () => {
    const { service, store } = harness();
    const invalidOrder = { name: 'Task', optimisticHours: 3, likelyHours: 2, pessimisticHours: 4 };
    await expect(service.createTask(owner, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', invalidOrder)).rejects.toMatchObject({ code: 'INVALID_TASK_INPUT' });
    const tooPrecise = { ...invalidOrder, optimisticHours: 1.12345, likelyHours: 2, pessimisticHours: 4 };
    await expect(service.createTask(owner, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', tooPrecise)).rejects.toMatchObject({ code: 'INVALID_TASK_INPUT' });
    expect(store.createTask).not.toHaveBeenCalled();
  });

  it('passes the caller version to the update port and does not permit a member to update arbitrary tasks', async () => {
    const { service, store } = harness();
    const projectId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154';
    const taskId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155';
    const input = { expectedVersion: 7, optimisticHours: 1, likelyHours: 2, pessimisticHours: 3 };
    await service.updateTask(member, projectId, taskId, input).catch(() => undefined);
    expect(store.updateTask).toHaveBeenCalledWith(member, false, projectId, taskId, input);
  });

  it('propagates optimistic concurrency conflicts without converting them into success', async () => {
    const { service } = harness({ updateTask: vi.fn(async () => { throw Object.assign(new Error('TASK_VERSION_CONFLICT'), { code: 'TASK_VERSION_CONFLICT' }); }) });
    await expect(service.updateTask(owner, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', {
      expectedVersion: 3, name: 'Changed',
    })).rejects.toMatchObject({ code: 'TASK_VERSION_CONFLICT' });
  });

  it('rejects malformed update PERT ordering before repository writes', async () => {
    const { service, store } = harness();
    await expect(service.updateTask(owner, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', {
      expectedVersion: 1, optimisticHours: 4, likelyHours: 2, pessimisticHours: 5,
    })).rejects.toMatchObject({ code: 'INVALID_TASK_INPUT' });
    expect(store.updateTask).not.toHaveBeenCalled();
  });

  it('maps the frozen Graph Engine metrics to a deterministic JSON DTO', async () => {
    const { service } = harness();
    const result = await service.analyzeProject(owner, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154');
    expect(result.graphRevision).toBe(9);
    expect(result.projectDurationHours).toBe(7);
    expect(result.criticalPaths).toEqual([['task-a', 'task-b']]);
    expect(result.taskMetrics.map((metric) => metric.taskId)).toEqual(['task-a', 'task-b']);
    expect(JSON.stringify(result)).not.toContain('Map');
  });

  it('does not expose cross-role assignment permissions through the service boundary', async () => {
    const { service, store } = harness();
    await expect(service.assignTask(member, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', {
      membershipId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd156',
    })).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(store.assignTask).not.toHaveBeenCalled();
  });
});
