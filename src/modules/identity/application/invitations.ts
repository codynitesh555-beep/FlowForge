import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertPermission } from '../domain/permissions.js';
import type { OrganizationPrincipal } from '../domain/policies.js';
import type { MembershipRecord } from './contracts.js';

const InvitationInputSchema = z.object({ email: z.string().trim().email().max(320), role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) }).strict();
const InvitationAcceptanceSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export interface OrganizationInvitationStore {
  create(input: {
    id: string; organizationId: string; invitedEmail: string; role: 'OWNER' | 'ADMIN' | 'MEMBER';
    tokenHash: string; invitedByUserId: string; createdAt: Date; expiresAt: Date;
  }): Promise<void>;
  revoke(invitationId: string, organizationId: string, now: Date): Promise<void>;
  accept(userId: string, tokenHash: string, now: Date): Promise<MembershipRecord | null>;
}

export interface InvitationDelivery {
  send(input: { email: string; invitationUrl: string; expiresAt: Date }): Promise<void>;
}

export interface InvitationResult { readonly id: string; readonly expiresAt: Date }

export class InvitationNotFoundError extends Error {
  readonly name = 'InvitationNotFoundError';
  constructor() { super('INVITATION_NOT_FOUND'); }
}

export class InvitationDeliveryError extends Error {
  readonly name = 'InvitationDeliveryError';
  constructor() { super('INVITATION_DELIVERY_FAILED'); }
}

export class OrganizationInvitationService {
  constructor(
    private readonly store: OrganizationInvitationStore,
    private readonly delivery: InvitationDelivery,
    private readonly applicationBaseUrl: string,
    private readonly lifetimeMs = 7 * 24 * 60 * 60 * 1000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const url = new URL(applicationBaseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Invitation links must use HTTPS outside localhost.');
  }

  async invite(actor: OrganizationPrincipal, input: unknown): Promise<InvitationResult> {
    const parsed = InvitationInputSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_INVITATION_INPUT');
    assertPermission(actor, actor.organizationId, 'membership:invite');
    if (parsed.data.role === 'OWNER') assertPermission(actor, actor.organizationId, 'membership:manage-owner');

    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    await this.store.create({
      id, organizationId: actor.organizationId, invitedEmail: parsed.data.email.toLowerCase(),
      role: parsed.data.role, tokenHash, invitedByUserId: actor.userId, createdAt: now, expiresAt,
    });

    const invitationUrl = new URL('/accept-invitation', this.applicationBaseUrl);
    invitationUrl.searchParams.set('token', token);
    try {
      await this.delivery.send({ email: parsed.data.email.toLowerCase(), invitationUrl: invitationUrl.toString(), expiresAt });
    } catch {
      await this.store.revoke(id, actor.organizationId, this.clock());
      throw new InvitationDeliveryError();
    }
    return { id, expiresAt };
  }

  async accept(userId: string, input: unknown): Promise<MembershipRecord> {
    const parsed = InvitationAcceptanceSchema.safeParse(input);
    if (!parsed.success) throw new InvitationNotFoundError();
    const membership = await this.store.accept(userId, this.hash(parsed.data.token), this.clock());
    if (!membership) throw new InvitationNotFoundError();
    return membership;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
