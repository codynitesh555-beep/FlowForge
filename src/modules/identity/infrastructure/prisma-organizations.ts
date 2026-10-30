import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { MembershipLifecycleService, MembershipRecord, MembershipChange } from '../application/contracts.js';
import { assertPermission } from '../domain/permissions.js';
import { assertOrganizationAccess, type OrganizationPrincipal } from '../domain/policies.js';

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface OrganizationMemberSummary {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: MembershipRecord['role'];
  readonly status: MembershipRecord['status'];
}

export class PrismaOrganizationApplication {
  constructor(private readonly client: PrismaClient, private readonly lifecycle: MembershipLifecycleService) {}

  async createForUser(userId: string, input: { name: string; slug: string }): Promise<OrganizationSummary> {
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();
    if (!name || name.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new Error('INVALID_ORGANIZATION_INPUT');
    }
    return this.client.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name, slug },
        select: { id: true, name: true, slug: true },
      });
      await transaction.membership.create({
        data: { organizationId: organization.id, userId, role: 'OWNER', status: 'ACTIVE' },
      });
      return organization;
    });
  }

  async listForUser(userId: string): Promise<(OrganizationSummary & { role: string })[]> {
    const rows = await this.client.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ organization: { name: 'asc' } }, { organizationId: 'asc' }],
    });
    return rows.map((row) => ({ ...row.organization, role: row.role }));
  }

  async listMembers(actor: OrganizationPrincipal): Promise<OrganizationMemberSummary[]> {
    assertOrganizationAccess(actor, actor.organizationId);
    assertPermission(actor, actor.organizationId, 'membership:read');
    const rows = await this.client.membership.findMany({
      where: { organizationId: actor.organizationId },
      select: {
        id: true, userId: true, role: true, status: true,
        user: { select: { email: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ user, ...membership }) => ({ ...membership, ...user }));
  }

  changeMember(actor: OrganizationPrincipal, membershipId: string, change: MembershipChange): Promise<MembershipRecord> {
    return this.lifecycle.changeMembership(actor, membershipId, change);
  }
}

export class PrismaOrganizationMembershipResolver {
  constructor(private readonly client: PrismaClient) {}

  async resolveActivePrincipal(userId: string, organizationId: string): Promise<OrganizationPrincipal | null> {
    const membership = await this.client.membership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
      select: { id: true, userId: true, organizationId: true, role: true, status: true },
    });
    return membership ? {
      userId: membership.userId,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      membershipStatus: membership.status,
    } : null;
  }
}

export class PrismaMembershipChangeAuthorizer {
  async assertCanChangeMembership(
    actor: OrganizationPrincipal,
    target: MembershipRecord,
    change: MembershipChange,
  ): Promise<void> {
    if (target.organizationId !== actor.organizationId) throw new Error('MEMBERSHIP_NOT_FOUND');
    const affectsOwner = target.role === 'OWNER' || change.role === 'OWNER';
    assertPermission(actor, actor.organizationId, affectsOwner ? 'membership:manage-owner' : 'membership:change');
  }
}
