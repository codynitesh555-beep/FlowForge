import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { assertActiveOwnerInvariant } from '../domain/policies.js';
import type { MembershipRecord } from '../application/contracts.js';
import type { OrganizationInvitationStore } from '../application/invitations.js';

type PendingInvitation = {
  id: string; organizationId: string; invitedEmail: string; role: 'OWNER' | 'ADMIN' | 'MEMBER';
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null;
};

export class PrismaOrganizationInvitationStore implements OrganizationInvitationStore {
  constructor(private readonly client: PrismaClient) {}

  async create(input: Parameters<OrganizationInvitationStore['create']>[0]): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "organizations" WHERE "id" = ${input.organizationId}::uuid FOR UPDATE
      `);
      const existingMembership = await transaction.membership.findFirst({
        where: { organizationId: input.organizationId, user: { email: input.invitedEmail } },
        select: { id: true },
      });
      if (existingMembership) throw new Error('USER_ALREADY_IN_ORGANIZATION');
      // Expired rows still satisfy the partial unique index until explicitly
      // revoked; retire them before inserting a replacement invitation.
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "organization_invitations" SET "revoked_at" = ${input.createdAt}
        WHERE "organization_id" = ${input.organizationId}::uuid
          AND "invited_email" = ${input.invitedEmail}
          AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" <= ${input.createdAt}
      `);
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "organization_invitations" (
          "id", "organization_id", "invited_email", "role", "token_hash", "invited_by_user_id", "created_at", "expires_at"
        ) VALUES (
          ${input.id}::uuid, ${input.organizationId}::uuid, ${input.invitedEmail}, ${input.role}::"membership_role",
          ${input.tokenHash}, ${input.invitedByUserId}::uuid, ${input.createdAt}, ${input.expiresAt}
        )
      `);
    });
  }

  async revoke(invitationId: string, organizationId: string, now: Date): Promise<void> {
    await this.client.$executeRaw(Prisma.sql`
      UPDATE "organization_invitations" SET "revoked_at" = COALESCE("revoked_at", ${now})
      WHERE "id" = ${invitationId}::uuid AND "organization_id" = ${organizationId}::uuid AND "accepted_at" IS NULL
    `);
  }

  accept(userId: string, tokenHash: string, now: Date): Promise<MembershipRecord | null> {
    return this.client.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) return null;
      const candidates = await transaction.$queryRaw<Array<{ id: string; organizationId: string }>>(Prisma.sql`
        SELECT "id", "organization_id" AS "organizationId" FROM "organization_invitations"
        WHERE "token_hash" = ${tokenHash} AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > ${now}
      `);
      const candidate = candidates[0];
      if (!candidate) return null;

      const organizations = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "organizations" WHERE "id" = ${candidate.organizationId}::uuid FOR UPDATE
      `);
      if (organizations.length !== 1) return null;

      const locked = await transaction.$queryRaw<PendingInvitation[]>(Prisma.sql`
        SELECT "id", "organization_id" AS "organizationId", "invited_email" AS "invitedEmail",
               "role", "expires_at" AS "expiresAt", "accepted_at" AS "acceptedAt", "revoked_at" AS "revokedAt"
        FROM "organization_invitations" WHERE "id" = ${candidate.id}::uuid AND "token_hash" = ${tokenHash}
        FOR UPDATE
      `);
      const invitation = locked[0];
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now || invitation.invitedEmail !== user.email) return null;

      const ownerCount = await transaction.membership.count({
        where: { organizationId: invitation.organizationId, role: 'OWNER', status: 'ACTIVE' },
      });
      assertActiveOwnerInvariant(ownerCount, null, { role: invitation.role, status: 'ACTIVE' });

      const membership = await transaction.membership.create({
        data: { organizationId: invitation.organizationId, userId, role: invitation.role, status: 'ACTIVE' },
        select: { id: true, organizationId: true, userId: true, role: true, status: true },
      });
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "organization_invitations" SET "accepted_at" = ${now}
        WHERE "id" = ${invitation.id}::uuid AND "accepted_at" IS NULL AND "revoked_at" IS NULL
      `);
      return membership;
    });
  }
}
