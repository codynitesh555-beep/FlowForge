import { describe, expect, it, vi } from 'vitest';
import { OrganizationInvitationService, type OrganizationInvitationStore } from './invitations.js';
import type { OrganizationPrincipal } from '../domain/policies.js';

const owner: OrganizationPrincipal = {
  userId: 'user-1', organizationId: 'org-1', membershipId: 'membership-1', role: 'OWNER', membershipStatus: 'ACTIVE',
};

function createHarness(send: () => Promise<void> = async () => undefined) {
  const store = {
    create: vi.fn(async (_input: Parameters<OrganizationInvitationStore['create']>[0]) => undefined),
    revoke: vi.fn(async () => undefined),
    accept: vi.fn(async () => ({ id: 'membership-2', organizationId: 'org-1', userId: 'user-2', role: 'MEMBER' as const, status: 'ACTIVE' as const })),
  };
  const delivery = { send: vi.fn(async (input: { email: string; invitationUrl: string; expiresAt: Date }) => send()) };
  const service = new OrganizationInvitationService(store as OrganizationInvitationStore, delivery, 'https://app.example.test');
  return { service, store, delivery };
}

describe('OrganizationInvitationService', () => {
  it('stores only a token hash and sends the raw invitation token through the delivery port', async () => {
    const harness = createHarness();
    const result = await harness.service.invite(owner, { email: ' NEW@Example.Test ', role: 'MEMBER' });
    const stored = vi.mocked(harness.store.create).mock.calls[0]![0];
    const sent = harness.delivery.send.mock.calls[0]?.[0];
    expect(sent).toBeDefined();
    if (!sent) throw new Error('Invitation delivery was not called.');
    expect(stored.invitedEmail).toBe('new@example.test');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.email).toBe('new@example.test');
    expect(sent.invitationUrl).toContain('https://app.example.test/accept-invitation?token=');
    expect(sent.invitationUrl).not.toContain(stored.tokenHash);
    expect(result.id).toBeTruthy();
  });

  it('requires owner-only permission to invite an OWNER', async () => {
    const harness = createHarness();
    const admin = { ...owner, role: 'ADMIN' as const };
    await expect(harness.service.invite(admin, { email: 'owner@example.test', role: 'OWNER' })).rejects.toThrow(/ROLE_FORBIDDEN/);
    expect(harness.store.create).not.toHaveBeenCalled();
  });

  it('revokes an invitation if secure delivery fails', async () => {
    const harness = createHarness(async () => { throw new Error('transport details'); });
    await expect(harness.service.invite(owner, { email: 'new@example.test', role: 'MEMBER' })).rejects.toThrow('INVITATION_DELIVERY_FAILED');
    expect(harness.store.revoke).toHaveBeenCalledOnce();
  });

  it('accepts only a syntactically valid opaque token through the persistence port', async () => {
    const harness = createHarness();
    await expect(harness.service.accept('user-2', { token: 'a'.repeat(43) })).resolves.toMatchObject({ organizationId: 'org-1', userId: 'user-2' });
    expect(harness.store.accept).toHaveBeenCalledOnce();
    await expect(harness.service.accept('user-2', { token: 'bad' })).rejects.toThrow('INVITATION_NOT_FOUND');
  });
});
