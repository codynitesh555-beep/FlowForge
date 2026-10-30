import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { RefreshSessionService, IssuedTokens } from '../infrastructure/refresh-sessions.js';

const passwordSchema = z.string().min(12).max(128).superRefine((value, context) => {
  if (Buffer.byteLength(value, 'utf8') > 1024) {
    context.addIssue({ code: 'custom', message: 'Password exceeds the byte limit.' });
  }
});

export const RegistrationSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(160),
  password: passwordSchema,
}).strict();

export const LoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: passwordSchema,
}).strict();

export interface CredentialUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
}

export interface AuthenticationUserRepository {
  findByNormalizedEmail(email: string): Promise<CredentialUser | null>;
  createUser(input: { email: string; displayName: string; passwordHash: string }): Promise<CredentialUser>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export class InvalidCredentialsError extends Error {
  readonly name = 'InvalidCredentialsError';
  constructor() { super('INVALID_CREDENTIALS'); }
}

export class RegistrationValidationError extends Error {
  readonly name = 'RegistrationValidationError';
  constructor() { super('INVALID_REGISTRATION_INPUT'); }
}

export type PublicUser = Pick<CredentialUser, 'id' | 'email' | 'displayName'>;
export interface AuthenticatedUser {
  readonly user: PublicUser;
  readonly tokens: IssuedTokens;
}

/** Credentials are verified with Argon2id; a dummy hash avoids an obvious
 * fast path for unknown users. No password or hash is included in errors. */
export class AuthenticationService {
  constructor(
    private readonly users: AuthenticationUserRepository,
    private readonly passwords: PasswordHasher,
    private readonly sessions: RefreshSessionService,
    private readonly dummyPasswordHash: string,
  ) {}

  static async create(
    users: AuthenticationUserRepository,
    passwords: PasswordHasher,
    sessions: RefreshSessionService,
  ): Promise<AuthenticationService> {
    const randomDummyPassword = randomBytes(32).toString('base64url');
    const dummyPasswordHash = await passwords.hash(randomDummyPassword);
    return new AuthenticationService(users, passwords, sessions, dummyPasswordHash);
  }

  async register(input: unknown): Promise<PublicUser> {
    const parsed = RegistrationSchema.safeParse(input);
    if (!parsed.success) throw new RegistrationValidationError();
    const email = parsed.data.email.toLowerCase();
    const passwordHash = await this.passwords.hash(parsed.data.password);
    const user = await this.users.createUser({
      email,
      displayName: parsed.data.displayName,
      passwordHash,
    });
    return this.publicUser(user);
  }

  async login(input: unknown): Promise<AuthenticatedUser> {
    const parsed = LoginSchema.safeParse(input);
    if (!parsed.success) throw new InvalidCredentialsError();
    const email = parsed.data.email.toLowerCase();
    const user = await this.users.findByNormalizedEmail(email);
    const candidateHash = user?.passwordHash ?? this.dummyPasswordHash;
    let valid = false;
    try {
      valid = await this.passwords.verify(candidateHash, parsed.data.password);
    } catch {
      // Malformed stored hashes and bad credentials share the same response.
      valid = false;
    }
    if (!user || !user.passwordHash || !valid) throw new InvalidCredentialsError();

    return {
      user: this.publicUser(user),
      tokens: await this.sessions.create(user.id),
    };
  }

  private publicUser(user: CredentialUser): PublicUser {
    return { id: user.id, email: user.email, displayName: user.displayName };
  }
}
