import { describe, expect, it, vi } from 'vitest';
import type { OrganizationPrincipal } from '../../identity/domain/policies.js';
import { writeProjectDomainEvent } from './prisma-project-task-store.js';

const actor: OrganizationPrincipal = {
  userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152',
  membershipId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd153', role: 'OWNER', membershipStatus: 'ACTIVE',
};

describe('project activity and outbox writes', () => {
  it('writes the same tenant-owned domain event with an actor display-name snapshot', async () => {
    const transaction = {
      user: { findUnique: vi.fn(async () => ({ displayName: 'Ada Lovelace' })) },
      activityLog: { create: vi.fn(async () => undefined) },
      outboxEvent: { create: vi.fn(async () => undefined) },
    };
    await writeProjectDomainEvent(transaction as never, actor, 'task.updated', 'task', '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', {
      projectId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', version: 2,
    });

    expect(transaction.user.findUnique).toHaveBeenCalledWith({ where: { id: actor.userId }, select: { displayName: true } });
    expect(transaction.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: actor.organizationId, actorUserId: actor.userId, actorDisplayName: 'Ada Lovelace',
      action: 'task.updated', aggregateType: 'task',
    }) });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: actor.organizationId, eventType: 'task.updated', aggregateType: 'task',
      payload: { projectId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155', version: 2 },
    }) });
  });

  it('propagates actor lookup failure so the enclosing transaction cannot commit an unattributed event', async () => {
    const transaction = {
      user: { findUnique: vi.fn(async () => null) },
      activityLog: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
    };
    await expect(writeProjectDomainEvent(transaction as never, actor, 'project.created', 'project', actor.organizationId, {})).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_FOUND' });
    expect(transaction.activityLog.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });
});
