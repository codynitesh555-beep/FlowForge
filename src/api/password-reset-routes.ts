import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PasswordResetService } from '../modules/identity/application/password-reset.js';

const ErrorSchema = z.object({ code: z.string() });
const AcceptedSchema = z.object({ accepted: z.literal(true) });

export const passwordResetRoutes = (service: PasswordResetService): FastifyPluginAsync => async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.post('/v1/auth/password-reset', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: {
      tags: ['Authentication'], summary: 'Request a password reset link',
      body: z.object({ email: z.string().trim().email().max(320) }).strict(),
      response: { 202: AcceptedSchema },
    },
  }, async (_request, reply) => {
    await service.request(_request.body);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/v1/auth/password-reset/complete', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Authentication'], summary: 'Complete password reset and revoke existing sessions',
      body: z.object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        newPassword: z.string().min(12).max(128),
      }).strict(),
      response: { 204: z.null(), 400: ErrorSchema },
    },
  }, async (request, reply) => {
    const completed = await service.complete(request.body);
    if (!completed) return reply.code(400).send({ code: 'INVALID_RESET_TOKEN' });
    return reply.code(204).send(null);
  });
};
