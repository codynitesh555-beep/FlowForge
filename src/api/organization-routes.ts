import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertPermission } from '../modules/identity/domain/permissions.js';
import type { OrganizationPrincipal } from '../modules/identity/domain/policies.js';
import type { PrismaOrganizationApplication, PrismaOrganizationMembershipResolver } from '../modules/identity/infrastructure/prisma-organizations.js';
import type { OrganizationInvitationService } from '../modules/identity/application/invitations.js';

const IdSchema = z.string().uuid();
const OrganizationParams = z.object({ organizationId: IdSchema });
const MembershipParams = OrganizationParams.extend({ membershipId: IdSchema });
const OrganizationInput = z.object({ name: z.string().trim().min(1).max(160), slug: z.string().trim().min(1).max(80) }).strict();
const MembershipChangeInput = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']),
}).strict();
const OrganizationSchema = z.object({ id: IdSchema, name: z.string(), slug: z.string() });
const OrganizationListSchema = z.array(OrganizationSchema.extend({ role: z.string() }));
const MemberSchema = z.object({
  id: IdSchema, userId: IdSchema, email: z.string().email(), displayName: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']), status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']),
});
const MembersSchema = z.array(MemberSchema);
const MembershipSchema = z.object({ id: IdSchema, organizationId: IdSchema, userId: IdSchema, role: MemberSchema.shape.role, status: MemberSchema.shape.status });
const ErrorSchema = z.object({ code: z.string() });

export interface OrganizationRouteOptions {
  readonly organizations: PrismaOrganizationApplication;
  readonly membershipResolver: PrismaOrganizationMembershipResolver;
  readonly invitations?: OrganizationInvitationService;
}

export const organizationRoutes = (options: OrganizationRouteOptions): FastifyPluginAsync => async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const requireOrganizationPrincipal = async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticateAccessToken(request, reply);
    if (reply.sent || !request.authContext) return;
    const params = OrganizationParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'INVALID_REQUEST' });
    const principal = await options.membershipResolver.resolveActivePrincipal(
      request.authContext.userId,
      params.data.organizationId,
    );
    if (!principal) return reply.code(403).send({ code: 'ORGANIZATION_ACCESS_DENIED' });
    request.organizationPrincipal = principal;
  };

  app.post('/v1/organizations', {
    preHandler: fastify.authenticateAccessToken,
    schema: {
      tags: ['Organizations'], summary: 'Create an organization and its initial owner',
      security: [{ bearerAuth: [] }], body: OrganizationInput,
      response: { 201: OrganizationSchema, 400: ErrorSchema, 409: ErrorSchema, 401: ErrorSchema },
    },
  }, async (request, reply) => {
    try {
      const organization = await options.organizations.createForUser(request.authContext!.userId, request.body);
      return reply.code(201).send(organization);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_ORGANIZATION_INPUT') return reply.code(400).send({ code: 'INVALID_ORGANIZATION_INPUT' });
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        return reply.code(409).send({ code: 'ORGANIZATION_SLUG_UNAVAILABLE' });
      }
      throw error;
    }
  });

  app.get('/v1/organizations', {
    preHandler: fastify.authenticateAccessToken,
    schema: { tags: ['Organizations'], summary: 'List the authenticated user’s active organizations', security: [{ bearerAuth: [] }], response: { 200: OrganizationListSchema, 401: ErrorSchema } },
  }, async (request) => options.organizations.listForUser(request.authContext!.userId));

  app.get('/v1/organizations/:organizationId/members', {
    preHandler: requireOrganizationPrincipal,
    schema: {
      tags: ['Memberships'], summary: 'List organization members', security: [{ bearerAuth: [] }],
      params: OrganizationParams,
      response: { 200: MembersSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (request) => {
    const actor = request.organizationPrincipal!;
    assertPermission(actor, actor.organizationId, 'membership:read');
    return options.organizations.listMembers(actor);
  });

  app.patch('/v1/organizations/:organizationId/members/:membershipId', {
    preHandler: requireOrganizationPrincipal,
    schema: {
      tags: ['Memberships'], summary: 'Change a membership role or status', security: [{ bearerAuth: [] }],
      params: MembershipParams, body: MembershipChangeInput,
      response: { 200: MembershipSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
  }, async (request, reply) => {
    const actor = request.organizationPrincipal!;
    try {
      const membership = await options.organizations.changeMember(actor, request.params.membershipId, request.body);
      return reply.send(membership);
    } catch (error) {
      if (error instanceof Error && error.message === 'MEMBERSHIP_NOT_FOUND') return reply.code(404).send({ code: 'MEMBERSHIP_NOT_FOUND' });
      if (error instanceof Error && error.message === 'ACTIVE_OWNER_REQUIRED') return reply.code(409).send({ code: 'ACTIVE_OWNER_REQUIRED' });
      throw error;
    }
  });

  if (options.invitations) {
    app.post('/v1/organizations/:organizationId/invitations', {
      preHandler: requireOrganizationPrincipal,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Memberships'], summary: 'Invite a user by email', security: [{ bearerAuth: [] }],
        params: OrganizationParams,
        body: z.object({ email: z.string().trim().email().max(320), role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) }).strict(),
        response: {
          202: z.object({ id: IdSchema, expiresAt: z.iso.datetime() }),
          400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 503: ErrorSchema,
        },
      },
    }, async (request, reply) => {
      try {
        const invitation = await options.invitations!.invite(request.organizationPrincipal!, request.body);
        return reply.code(202).send({ id: invitation.id, expiresAt: invitation.expiresAt.toISOString() });
      } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_INVITATION_INPUT') return reply.code(400).send({ code: 'INVALID_INVITATION_INPUT' });
        if (error instanceof Error && error.message === 'INVITATION_NOT_FOUND') return reply.code(404).send({ code: 'INVITATION_NOT_FOUND' });
        if (error instanceof Error && error.message === 'USER_ALREADY_IN_ORGANIZATION') return reply.code(409).send({ code: 'USER_ALREADY_IN_ORGANIZATION' });
        if (error instanceof Error && error.message === 'INVITATION_DELIVERY_FAILED') return reply.code(503).send({ code: 'INVITATION_DELIVERY_UNAVAILABLE' });
        throw error;
      }
    });

    app.post('/v1/invitations/accept', {
      preHandler: fastify.authenticateAccessToken,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Memberships'], summary: 'Accept an email invitation for the authenticated account',
        security: [{ bearerAuth: [] }],
        body: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
        response: { 201: MembershipSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    }, async (request, reply) => {
      try {
        const membership = await options.invitations!.accept(request.authContext!.userId, request.body);
        return reply.code(201).send(membership);
      } catch (error) {
        if (error instanceof Error && error.message === 'INVITATION_NOT_FOUND') return reply.code(404).send({ code: 'INVITATION_NOT_FOUND' });
        if (error instanceof Error && error.message === 'ACTIVE_OWNER_REQUIRED') return reply.code(409).send({ code: 'ACTIVE_OWNER_REQUIRED' });
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
          return reply.code(409).send({ code: 'MEMBERSHIP_ALREADY_EXISTS' });
        }
        throw error;
      }
    });
  }
};

declare module 'fastify' {
  interface FastifyRequest {
    organizationPrincipal: OrganizationPrincipal | null;
  }
}
