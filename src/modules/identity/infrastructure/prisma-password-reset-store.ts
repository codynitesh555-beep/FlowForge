import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { PasswordResetStore } from '../application/password-reset.js';

type ResetRow = { id: string; userId: string; expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null };

export class PrismaPasswordResetStore implements PasswordResetStore {
  constructor(private readonly client: PrismaClient) {}

  async findUserIdByNormalizedEmail(email: string): Promise<string | null> {
    const user = await this.client.user.findUnique({ where: { email }, select: { id: true } });
    return user?.id ?? null;
  }

  replacePending(userId: string, tokenHash: string, createdAt: Date, expiresAt: Date): Promise<void> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "password_reset_tokens" SET "revoked_at" = ${createdAt}
        WHERE "user_id" = ${userId}::uuid AND "consumed_at" IS NULL AND "revoked_at" IS NULL
      `);
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "password_reset_tokens" ("id", "user_id", "token_hash", "created_at", "expires_at")
        VALUES (gen_random_uuid(), ${userId}::uuid, ${tokenHash}, ${createdAt}, ${expiresAt})
      `);
    });
  }

  revokePending(userId: string, now: Date): Promise<void> {
    return this.client.$executeRaw(Prisma.sql`
      UPDATE "password_reset_tokens" SET "revoked_at" = COALESCE("revoked_at", ${now})
      WHERE "user_id" = ${userId}::uuid AND "consumed_at" IS NULL AND "revoked_at" IS NULL
    `).then(() => undefined);
  }

  consumeAndChangePassword(tokenHash: string, passwordHash: string, now: Date): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ResetRow[]>(Prisma.sql`
        SELECT "id", "user_id" AS "userId", "expires_at" AS "expiresAt",
               "consumed_at" AS "consumedAt", "revoked_at" AS "revokedAt"
        FROM "password_reset_tokens" WHERE "token_hash" = ${tokenHash} FOR UPDATE
      `);
      const token = rows[0];
      if (!token || token.consumedAt || token.revokedAt || token.expiresAt <= now) return false;

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "password_reset_tokens" SET "consumed_at" = ${now} WHERE "id" = ${token.id}::uuid
      `);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "users" SET "password_hash" = ${passwordHash}, "updated_at" = ${now}
        WHERE "id" = ${token.userId}::uuid
      `);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "auth_sessions" SET "revoked_at" = COALESCE("revoked_at", ${now})
        WHERE "user_id" = ${token.userId}::uuid
      `);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "password_reset_tokens" SET "revoked_at" = COALESCE("revoked_at", ${now})
        WHERE "user_id" = ${token.userId}::uuid AND "id" <> ${token.id}::uuid AND "consumed_at" IS NULL
      `);
      return true;
    });
  }
}
