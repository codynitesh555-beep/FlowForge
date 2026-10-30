import { describe, expect, it } from 'vitest';
import { InvalidAccessTokenError, JoseAccessTokenCodec } from './access-tokens.js';

const key = 'local-test-secret-with-at-least-thirty-two-bytes';
const userId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151';
const sessionId = '9d8b9073-5ec8-46a7-9852-1587b52f59a2';

describe('JoseAccessTokenCodec', () => {
  it('issues short-lived tokens and verifies subject and session claims', async () => {
    const codec = new JoseAccessTokenCodec({ secret: key, issuer: 'flowforge-test', audience: 'flowforge-api', lifetimeSeconds: 600 });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const issued = await codec.issue(userId, sessionId, now);
    expect(issued.expiresAt.getTime() - now.getTime()).toBe(600_000);
    await expect(codec.verify(issued.token, now)).resolves.toMatchObject({ userId, sessionId, expiresAt: issued.expiresAt });
  });

  it('rejects wrong keys, tampered tokens, expired tokens, and short signing keys', async () => {
    const config = { secret: key, issuer: 'flowforge-test', audience: 'flowforge-api', lifetimeSeconds: 60 } as const;
    const codec = new JoseAccessTokenCodec(config);
    const now = new Date('2026-01-01T00:00:00.000Z');
    const issued = await codec.issue(userId, sessionId, now);
    await expect(codec.verify(`${issued.token}x`, now)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(codec.verify(issued.token, new Date(now.getTime() + 61_000))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    expect(() => new JoseAccessTokenCodec({ ...config, secret: 'too-short' })).toThrow(/32 bytes/);
  });
});
