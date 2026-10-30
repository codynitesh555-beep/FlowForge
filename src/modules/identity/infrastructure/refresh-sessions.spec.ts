import { describe, expect, it } from 'vitest';
import type { AccessTokenClaims, AccessTokenCodec } from './access-tokens.js';
import {
  InvalidRefreshTokenError,
  RefreshSessionService,
  RefreshTokenReplayError,
  type AuthSessionStore,
  type RotationResult,
  type SessionGeneration,
} from './refresh-sessions.js';

class MemorySessionStore implements AuthSessionStore {
  readonly rows: Array<SessionGeneration & { consumedAt: Date | null; revokedAt: Date | null }> = [];

  async create(session: SessionGeneration): Promise<void> {
    this.rows.push({ ...session, consumedAt: null, revokedAt: null });
  }

  async rotate(input: Parameters<AuthSessionStore['rotate']>[0]): Promise<RotationResult> {
    const current = this.rows.find((row) => row.refreshTokenHash === input.presentedHash);
    if (!current) return { kind: 'invalid' };
    if (current.consumedAt) {
      for (const row of this.rows.filter((candidate) => candidate.familyId === current.familyId)) row.revokedAt = input.now;
      return { kind: 'replay' };
    }
    if (current.revokedAt || current.expiresAt <= input.now || current.familyExpiresAt <= input.now) return { kind: 'invalid' };
    current.consumedAt = input.now;
    const expiresAt = new Date(Math.min(input.refreshExpiresAt.getTime(), current.familyExpiresAt.getTime()));
    this.rows.push({
      id: input.replacement.id, familyId: current.familyId, userId: current.userId,
      refreshTokenHash: input.replacement.refreshTokenHash, createdAt: input.replacement.createdAt,
      expiresAt, familyExpiresAt: current.familyExpiresAt, consumedAt: null, revokedAt: null,
    });
    return { kind: 'rotated', session: { id: input.replacement.id, userId: current.userId, familyExpiresAt: current.familyExpiresAt } };
  }

  async revokeFamily(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const session = this.rows.find((row) => row.id === sessionId && row.userId === userId);
    if (!session) return false;
    for (const row of this.rows.filter((candidate) => candidate.familyId === session.familyId)) row.revokedAt = now;
    return true;
  }

  async isActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    return this.rows.some((row) => row.id === sessionId && row.userId === userId &&
      !row.consumedAt && !row.revokedAt && row.expiresAt > now && row.familyExpiresAt > now);
  }
}

class FakeAccessTokens implements AccessTokenCodec {
  async issue(userId: string, sessionId: string, now: Date) {
    return { token: `${userId}.${sessionId}`, expiresAt: new Date(now.getTime() + 60_000) };
  }
  async verify(token: string): Promise<AccessTokenClaims> {
    const [userId, sessionId] = token.split('.');
    return { userId: userId!, sessionId: sessionId!, expiresAt: new Date(Date.now() + 60_000) };
  }
}

describe('RefreshSessionService', () => {
  it('stores only token hashes and rotates the token within one family', async () => {
    const store = new MemorySessionStore();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const service = new RefreshSessionService(store, new FakeAccessTokens(), 60_000, 180_000, () => now);
    const first = await service.create('2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151');

    expect(store.rows[0]?.refreshTokenHash).not.toBe(first.refreshToken);
    expect(store.rows[0]?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const next = await service.rotate(first.refreshToken);
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]?.consumedAt).toEqual(now);
    expect(store.rows[1]?.familyId).toBe(store.rows[0]?.familyId);
    await expect(service.authenticateAccessToken(next.accessToken)).resolves.toEqual({
      userId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151', sessionId: next.sessionId,
    });
  });

  it('rejects refresh replay and revokes every generation in that family', async () => {
    const store = new MemorySessionStore();
    const service = new RefreshSessionService(store, new FakeAccessTokens(), 60_000, 180_000, () => new Date());
    const first = await service.create('2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151');
    const next = await service.rotate(first.refreshToken);

    await expect(service.rotate(first.refreshToken)).rejects.toBeInstanceOf(RefreshTokenReplayError);
    await expect(service.authenticateAccessToken(next.accessToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(store.rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('revokes a session family at logout and rejects later access checks', async () => {
    const store = new MemorySessionStore();
    const service = new RefreshSessionService(store, new FakeAccessTokens());
    const issued = await service.create('2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151');
    await service.logout(issued.sessionId, '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151');
    await expect(service.authenticateAccessToken(issued.accessToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects malformed and unknown refresh values before accepting a session', async () => {
    const service = new RefreshSessionService(new MemorySessionStore(), new FakeAccessTokens());
    await expect(service.rotate('not-a-token')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});
