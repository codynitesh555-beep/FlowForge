import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface AccessTokenCodec {
  issue(userId: string, sessionId: string, now: Date): Promise<{ token: string; expiresAt: Date }>;
  verify(token: string, now?: Date): Promise<AccessTokenClaims>;
}

export interface AccessTokenConfiguration {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly lifetimeSeconds: number;
}

const ClaimsSchema = z.object({ sub: z.string().uuid(), sid: z.string().uuid(), exp: z.number().int() });

export class InvalidAccessTokenError extends Error {
  readonly name = 'InvalidAccessTokenError';
  constructor() { super('INVALID_ACCESS_TOKEN'); }
}

export class JoseAccessTokenCodec implements AccessTokenCodec {
  private readonly key: Uint8Array;

  constructor(private readonly configuration: AccessTokenConfiguration) {
    if (Buffer.byteLength(configuration.secret, 'utf8') < 32) {
      throw new Error('ACCESS_TOKEN_SECRET must contain at least 32 bytes.');
    }
    if (!Number.isSafeInteger(configuration.lifetimeSeconds) || configuration.lifetimeSeconds < 60 || configuration.lifetimeSeconds > 900) {
      throw new Error('Access-token lifetime must be between 60 and 900 seconds.');
    }
    this.key = new TextEncoder().encode(configuration.secret);
  }

  async issue(userId: string, sessionId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(now.getTime() + this.configuration.lifetimeSeconds * 1000);
    const token = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.configuration.issuer)
      .setAudience(this.configuration.audience)
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string, now = new Date()): Promise<AccessTokenClaims> {
    try {
      const result = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.configuration.issuer,
        audience: this.configuration.audience,
        currentDate: now,
      });
      const parsed = ClaimsSchema.safeParse({ ...result.payload, sub: result.payload.sub, sid: result.payload.sid });
      if (!parsed.success) throw new InvalidAccessTokenError();
      return {
        userId: parsed.data.sub,
        sessionId: parsed.data.sid,
        expiresAt: new Date(parsed.data.exp * 1000),
      };
    } catch {
      throw new InvalidAccessTokenError();
    }
  }
}
