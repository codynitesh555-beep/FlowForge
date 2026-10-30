import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessTokenCodec } from './access-tokens.js';

export interface SessionGeneration {
  readonly id: string;
  readonly familyId: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly familyExpiresAt: Date;
}

export type RotationResult =
  | { readonly kind: 'rotated'; readonly session: { readonly id: string; readonly userId: string; readonly familyExpiresAt: Date } }
  | { readonly kind: 'replay' }
  | { readonly kind: 'invalid' };

export interface AuthSessionStore {
  create(session: SessionGeneration): Promise<void>;
  /** Must atomically consume the old hash and insert a new generation. */
  rotate(input: {
    presentedHash: string;
    replacement: { readonly id: string; readonly refreshTokenHash: string; readonly createdAt: Date };
    refreshExpiresAt: Date;
    now: Date;
  }): Promise<RotationResult>;
  revokeFamily(sessionId: string, userId: string, now: Date): Promise<boolean>;
  isActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly sessionId: string;
}

export class InvalidRefreshTokenError extends Error {
  readonly name = 'InvalidRefreshTokenError';
  constructor() { super('INVALID_REFRESH_TOKEN'); }
}

export class RefreshTokenReplayError extends Error {
  readonly name = 'RefreshTokenReplayError';
  constructor() { super('INVALID_REFRESH_TOKEN'); }
}

export class RefreshSessionService {
  constructor(
    private readonly store: AuthSessionStore,
    private readonly accessTokens: AccessTokenCodec,
    private readonly refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000,
    private readonly familyLifetimeMs = 90 * 24 * 60 * 60 * 1000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (refreshLifetimeMs <= 0 || familyLifetimeMs < refreshLifetimeMs) {
      throw new Error('Refresh lifetimes must be positive and family lifetime must cover one refresh lifetime.');
    }
  }

  async create(userId: string): Promise<IssuedTokens> {
    const now = this.clock();
    const familyId = randomUUID();
    const familyExpiresAt = new Date(now.getTime() + this.familyLifetimeMs);
    const refreshToken = this.newRefreshToken();
    const generation: SessionGeneration = {
      id: randomUUID(), familyId, userId,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      createdAt: now,
      expiresAt: new Date(Math.min(now.getTime() + this.refreshLifetimeMs, familyExpiresAt.getTime())),
      familyExpiresAt,
    };
    await this.store.create(generation);
    return this.issueTokens(generation.id, userId, refreshToken, generation.expiresAt, now);
  }

  async rotate(refreshToken: string): Promise<IssuedTokens> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) throw new InvalidRefreshTokenError();
    const now = this.clock();
    const newRefreshToken = this.newRefreshToken();
    const replacement = {
      id: randomUUID(),
      refreshTokenHash: this.hashRefreshToken(newRefreshToken),
      createdAt: now,
    };
    const result = await this.store.rotate({
      presentedHash: this.hashRefreshToken(refreshToken),
      replacement,
      refreshExpiresAt: new Date(now.getTime() + this.refreshLifetimeMs),
      now,
    });
    if (result.kind === 'replay') throw new RefreshTokenReplayError();
    if (result.kind !== 'rotated') throw new InvalidRefreshTokenError();
    const expiry = new Date(Math.min(now.getTime() + this.refreshLifetimeMs, result.session.familyExpiresAt.getTime()));
    return this.issueTokens(result.session.id, result.session.userId, newRefreshToken, expiry, now);
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.store.revokeFamily(sessionId, userId, this.clock());
  }

  async authenticateAccessToken(token: string): Promise<{ userId: string; sessionId: string }> {
    const claims = await this.accessTokens.verify(token, this.clock());
    if (!await this.store.isActive(claims.sessionId, claims.userId, this.clock())) {
      throw new InvalidRefreshTokenError();
    }
    return { userId: claims.userId, sessionId: claims.sessionId };
  }

  private async issueTokens(sessionId: string, userId: string, refreshToken: string, refreshExpiresAt: Date, now: Date): Promise<IssuedTokens> {
    const access = await this.accessTokens.issue(userId, sessionId, now);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
      sessionId,
    };
  }

  private newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
