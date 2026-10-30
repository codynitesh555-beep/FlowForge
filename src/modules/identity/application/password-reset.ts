import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PasswordHasher } from './authentication.js';

const RequestSchema = z.object({ email: z.string().trim().email().max(320) }).strict();
const CompleteSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: z.string().min(12).max(128).superRefine((value, context) => {
    if (Buffer.byteLength(value, 'utf8') > 1024) context.addIssue({ code: 'custom', message: 'Password exceeds the byte limit.' });
  }),
}).strict();

export interface PasswordResetStore {
  findUserIdByNormalizedEmail(email: string): Promise<string | null>;
  replacePending(userId: string, tokenHash: string, createdAt: Date, expiresAt: Date): Promise<void>;
  revokePending(userId: string, now: Date): Promise<void>;
  consumeAndChangePassword(tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;
}

export interface PasswordResetDelivery {
  send(input: { email: string; resetUrl: string; expiresAt: Date }): Promise<void>;
}

export class PasswordResetService {
  constructor(
    private readonly store: PasswordResetStore,
    private readonly passwords: PasswordHasher,
    private readonly delivery: PasswordResetDelivery,
    private readonly applicationBaseUrl: string,
    private readonly lifetimeMs = 30 * 60 * 1000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const url = new URL(applicationBaseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Password-reset links must use HTTPS outside localhost.');
  }

  /** Always resolves with no account-existence information. */
  async request(input: unknown): Promise<void> {
    const parsed = RequestSchema.safeParse(input);
    if (!parsed.success) return;
    const email = parsed.data.email.toLowerCase();
    const userId = await this.store.findUserIdByNormalizedEmail(email);
    if (!userId) return;
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const token = randomBytes(32).toString('base64url');
    await this.store.replacePending(userId, this.hash(token), now, expiresAt);
    const resetUrl = new URL('/reset-password', this.applicationBaseUrl);
    resetUrl.searchParams.set('token', token);
    try {
      await this.delivery.send({ email, resetUrl: resetUrl.toString(), expiresAt });
    } catch {
      await this.store.revokePending(userId, this.clock());
      // Do not reveal whether an account existed or expose mail provider details.
    }
  }

  async complete(input: unknown): Promise<boolean> {
    const parsed = CompleteSchema.safeParse(input);
    if (!parsed.success) return false;
    const passwordHash = await this.passwords.hash(parsed.data.newPassword);
    return this.store.consumeAndChangePassword(this.hash(parsed.data.token), passwordHash, this.clock());
  }

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
