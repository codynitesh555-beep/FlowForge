import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { AuthenticationUserRepository, CredentialUser } from '../application/authentication.js';

export class PrismaAuthenticationUserRepository implements AuthenticationUserRepository {
  constructor(private readonly client: PrismaClient) {}

  findByNormalizedEmail(email: string): Promise<CredentialUser | null> {
    return this.client.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, passwordHash: true },
    });
  }

  createUser(input: { email: string; displayName: string; passwordHash: string }): Promise<CredentialUser> {
    return this.client.user.create({
      data: input,
      select: { id: true, email: true, displayName: true, passwordHash: true },
    });
  }
}
