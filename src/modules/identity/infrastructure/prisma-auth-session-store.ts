import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { AuthSessionStore, RotationResult, SessionGeneration } from './refresh-sessions.js';

type StoredSession = {
  id: string;
  familyId: string;
  userId: string;
  familyExpiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

/** Uses parameterized SQL so the generated Prisma client need not be regenerated
 * merely to inspect/lock the additive auth tables. All mutating operations are
 * interactive transactions. No method connects until it is called. */
export class PrismaAuthSessionStore implements AuthSessionStore {
  constructor(private readonly client: PrismaClient) {}

  async create(session: SessionGeneration): Promise<void> {
    await this.client.$executeRaw(Prisma.sql`
      INSERT INTO "auth_sessions" (
        "id", "family_id", "user_id", "refresh_token_hash", "created_at", "expires_at", "family_expires_at"
      ) VALUES (
        ${session.id}::uuid, ${session.familyId}::uuid, ${session.userId}::uuid,
        ${session.refreshTokenHash}, ${session.createdAt}, ${session.expiresAt}, ${session.familyExpiresAt}
      )
    `);
  }

  rotate(input: {
    presentedHash: string;
    replacement: { id: string; refreshTokenHash: string; createdAt: Date };
    refreshExpiresAt: Date;
    now: Date;
  }): Promise<RotationResult> {
    return this.client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<StoredSession[]>(Prisma.sql`
        SELECT "id", "family_id" AS "familyId", "user_id" AS "userId",
               "family_expires_at" AS "familyExpiresAt", "consumed_at" AS "consumedAt",
               "revoked_at" AS "revokedAt", "expires_at" AS "expiresAt"
        FROM "auth_sessions" WHERE "refresh_token_hash" = ${input.presentedHash}
        FOR UPDATE
      `);
      const current = rows[0];
      if (!current) return { kind: 'invalid' };

      if (current.consumedAt !== null) {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "auth_sessions" SET "revoked_at" = COALESCE("revoked_at", ${input.now})
          WHERE "family_id" = ${current.familyId}::uuid
        `);
        return { kind: 'replay' };
      }
      if (current.revokedAt !== null || current.expiresAt <= input.now || current.familyExpiresAt <= input.now) {
        return { kind: 'invalid' };
      }

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "auth_sessions" SET "consumed_at" = ${input.now}
        WHERE "id" = ${current.id}::uuid AND "consumed_at" IS NULL AND "revoked_at" IS NULL
      `);
      const expiresAt = new Date(Math.min(input.refreshExpiresAt.getTime(), current.familyExpiresAt.getTime()));
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "auth_sessions" (
          "id", "family_id", "user_id", "refresh_token_hash", "created_at", "expires_at", "family_expires_at"
        ) VALUES (
          ${input.replacement.id}::uuid, ${current.familyId}::uuid, ${current.userId}::uuid,
          ${input.replacement.refreshTokenHash}, ${input.replacement.createdAt}, ${expiresAt}, ${current.familyExpiresAt}
        )
      `);
      return {
        kind: 'rotated',
        session: { id: input.replacement.id, userId: current.userId, familyExpiresAt: current.familyExpiresAt },
      };
    });
  }

  async revokeFamily(sessionId: string, userId: string, now: Date): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ familyId: string }>>(Prisma.sql`
        SELECT "family_id" AS "familyId" FROM "auth_sessions"
        WHERE "id" = ${sessionId}::uuid AND "user_id" = ${userId}::uuid
        FOR UPDATE
      `);
      const familyId = rows[0]?.familyId;
      if (!familyId) return false;
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "auth_sessions" SET "revoked_at" = COALESCE("revoked_at", ${now})
        WHERE "family_id" = ${familyId}::uuid
      `);
      return true;
    });
  }

  async isActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const rows = await this.client.$queryRaw<Array<{ active: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "auth_sessions"
        WHERE "id" = ${sessionId}::uuid AND "user_id" = ${userId}::uuid
          AND "consumed_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > ${now}
          AND "family_expires_at" > ${now}
      ) AS "active"
    `);
    return rows[0]?.active === true;
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.client.$executeRaw(Prisma.sql`
      UPDATE "auth_sessions" SET "revoked_at" = COALESCE("revoked_at", ${now})
      WHERE "user_id" = ${userId}::uuid
    `);
  }
}
