import { describe, expect, it, vi } from 'vitest';
import { PasswordResetService, type PasswordResetStore } from './password-reset.js';
import type { PasswordHasher } from './authentication.js';

function createHarness(userId: string | null, send: () => Promise<void> = async () => undefined) {
  const store = {
    findUserIdByNormalizedEmail: vi.fn(async () => userId),
    replacePending: vi.fn(async (_userId: string, _tokenHash: string, _createdAt: Date, _expiresAt: Date) => undefined),
    revokePending: vi.fn(async () => undefined),
    consumeAndChangePassword: vi.fn(async () => true),
  };
  const passwords: PasswordHasher = { hash: vi.fn(async () => 'argon2id-hash'), verify: vi.fn(async () => true) };
  const delivery = { send: vi.fn(async (input: { email: string; resetUrl: string; expiresAt: Date }) => send()) };
  const service = new PasswordResetService(store as PasswordResetStore, passwords, delivery, 'https://app.example.test');
  return { service, store, passwords, delivery };
}

describe('PasswordResetService', () => {
  it('returns the same result for unknown email without sending or storing a token', async () => {
    const harness = createHarness(null);
    await expect(harness.service.request({ email: 'missing@example.test' })).resolves.toBeUndefined();
    expect(harness.store.replacePending).not.toHaveBeenCalled();
    expect(harness.delivery.send).not.toHaveBeenCalled();
  });

  it('persists only a token hash and sends reset data through the delivery port', async () => {
    const harness = createHarness('user-1');
    await harness.service.request({ email: ' PERSON@Example.Test ' });
    const replacement = harness.store.replacePending.mock.calls[0];
    expect(replacement).toBeDefined();
    if (!replacement) throw new Error('Reset token was not persisted.');
    const [userId, tokenHash] = replacement;
    const delivery = harness.delivery.send.mock.calls[0]?.[0];
    expect(delivery).toBeDefined();
    if (!delivery) throw new Error('Reset email was not sent.');
    expect(userId).toBe('user-1');
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(delivery.email).toBe('person@example.test');
    expect(delivery.resetUrl).toContain('https://app.example.test/reset-password?token=');
    expect(delivery.resetUrl).not.toContain(tokenHash);
  });

  it('revokes an undeliverable reset token without exposing provider details', async () => {
    const harness = createHarness('user-1', async () => { throw new Error('private mail error'); });
    await expect(harness.service.request({ email: 'person@example.test' })).resolves.toBeUndefined();
    expect(harness.store.revokePending).toHaveBeenCalledOnce();
  });

  it('hashes the replacement password before asking the store to atomically consume and revoke sessions', async () => {
    const harness = createHarness('user-1');
    await expect(harness.service.complete({ token: 't'.repeat(43), newPassword: 'a secure replacement password' })).resolves.toBe(true);
    expect(harness.passwords.hash).toHaveBeenCalledWith('a secure replacement password');
    expect(harness.store.consumeAndChangePassword).toHaveBeenCalledWith(expect.any(String), 'argon2id-hash', expect.any(Date));
  });
});
