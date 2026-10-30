import { describe, expect, it, vi } from 'vitest';
import { AuthenticationService, InvalidCredentialsError, type AuthenticationUserRepository, type CredentialUser, type PasswordHasher } from './authentication.js';
import type { RefreshSessionService } from '../infrastructure/refresh-sessions.js';

const user: CredentialUser = {
  id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151',
  email: 'person@example.test',
  displayName: 'Person',
  passwordHash: 'argon-hash',
};

describe('AuthenticationService', () => {
  it('normalizes registration email, hashes the password, and returns no credential data', async () => {
    const users: AuthenticationUserRepository = {
      findByNormalizedEmail: vi.fn(async () => user),
      createUser: vi.fn(async (input) => ({ ...user, ...input })),
    };
    const passwords: PasswordHasher = {
      hash: vi.fn(async () => 'new-hash'),
      verify: vi.fn(async () => true),
    };
    const sessions = { create: vi.fn() } as unknown as RefreshSessionService;
    const service = new AuthenticationService(users, passwords, sessions, 'dummy-hash');

    const result = await service.register({ email: ' PERSON@Example.Test ', displayName: ' Person ', password: 'a secure long password' });
    expect(users.createUser).toHaveBeenCalledWith({ email: 'person@example.test', displayName: 'Person', passwordHash: 'new-hash' });
    expect(result).toEqual({ id: user.id, email: user.email, displayName: user.displayName });
    expect(JSON.stringify(result)).not.toContain('hash');
  });

  it('performs one password verification for unknown users and returns the same credential error', async () => {
    const users: AuthenticationUserRepository = {
      findByNormalizedEmail: vi.fn(async () => null),
      createUser: vi.fn(),
    };
    const passwords: PasswordHasher = { hash: vi.fn(), verify: vi.fn(async () => false) };
    const sessions = { create: vi.fn() } as unknown as RefreshSessionService;
    const service = new AuthenticationService(users, passwords, sessions, 'dummy-hash');
    await expect(service.login({ email: 'missing@example.test', password: 'a secure long password' }))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(passwords.verify).toHaveBeenCalledWith('dummy-hash', 'a secure long password');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rejects malformed login input with a generic credential error', async () => {
    const users: AuthenticationUserRepository = { findByNormalizedEmail: vi.fn(), createUser: vi.fn() };
    const passwords: PasswordHasher = { hash: vi.fn(), verify: vi.fn() };
    const sessions = { create: vi.fn() } as unknown as RefreshSessionService;
    const service = new AuthenticationService(users, passwords, sessions, 'dummy-hash');
    await expect(service.login({ email: 'not-email', password: 'short' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.findByNormalizedEmail).not.toHaveBeenCalled();
  });
});
