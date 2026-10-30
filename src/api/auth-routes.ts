import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuthenticationService, LoginSchema, RegistrationSchema } from '../modules/identity/application/authentication.js';
import { InvalidRefreshTokenError, RefreshSessionService, RefreshTokenReplayError } from '../modules/identity/infrastructure/refresh-sessions.js';

const PublicUserSchema = z.object({ id: z.string().uuid(), email: z.string().email(), displayName: z.string() });
const AuthResponseSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
});
const TokenResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
});
const ErrorSchema = z.object({ code: z.string() });

export interface AuthRouteOptions {
  readonly authentication: AuthenticationService;
  readonly sessions: RefreshSessionService;
  readonly cookieSecure: boolean;
  readonly allowedOrigins: ReadonlySet<string>;
}

function setRefreshCookie(reply: FastifyReply, tokens: { refreshToken: string; refreshTokenExpiresAt: Date }, secure: boolean): void {
  const maxAge = Math.max(0, Math.floor((tokens.refreshTokenExpiresAt.getTime() - Date.now()) / 1000));
  reply.setCookie('flowforge_refresh', tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/v1/auth',
    maxAge,
  });
}

export const authRoutes = (options: AuthRouteOptions): FastifyPluginAsync => async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/v1/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Authentication'],
      summary: 'Register a user account',
      body: RegistrationSchema,
      response: { 201: PublicUserSchema, 400: ErrorSchema, 409: ErrorSchema },
    },
  }, async (request, reply) => {
    try {
      const user = await options.authentication.register(request.body);
      return reply.code(201).send(user);
    } catch (error) {
      if (error instanceof Error && error.name === 'RegistrationValidationError') return reply.code(400).send({ code: 'INVALID_REGISTRATION_INPUT' });
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        return reply.code(409).send({ code: 'ACCOUNT_ALREADY_EXISTS' });
      }
      throw error;
    }
  });

  app.post('/v1/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Authentication'],
      summary: 'Authenticate with email and password',
      body: LoginSchema,
      response: { 200: AuthResponseSchema, 401: ErrorSchema },
    },
  }, async (request, reply) => {
    try {
      const result = await options.authentication.login(request.body);
      setRefreshCookie(reply, result.tokens, options.cookieSecure);
      return reply.send({
        user: result.user,
        accessToken: result.tokens.accessToken,
        accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'InvalidCredentialsError' || error.name === 'RegistrationValidationError')) {
        return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
      }
      throw error;
    }
  });

  app.post('/v1/auth/refresh', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Authentication'],
      summary: 'Rotate the refresh token',
      response: { 200: TokenResponseSchema, 401: ErrorSchema, 403: ErrorSchema },
    },
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !options.allowedOrigins.has(origin)) return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN' });
    const refreshToken = request.cookies.flowforge_refresh;
    if (!refreshToken) return reply.code(401).send({ code: 'INVALID_REFRESH_TOKEN' });
    try {
      const tokens = await options.sessions.rotate(refreshToken);
      setRefreshCookie(reply, tokens, options.cookieSecure);
      return reply.send({ accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() });
    } catch (error) {
      reply.clearCookie('flowforge_refresh', { path: '/v1/auth' });
      if (error instanceof InvalidRefreshTokenError || error instanceof RefreshTokenReplayError) {
        return reply.code(401).send({ code: 'INVALID_REFRESH_TOKEN' });
      }
      throw error;
    }
  });

  app.post('/v1/auth/logout', {
    preHandler: fastify.authenticateAccessToken,
    schema: {
      tags: ['Authentication'],
      summary: 'Revoke the current refresh-token family',
      response: { 204: z.null(), 401: ErrorSchema },
    },
  }, async (request, reply) => {
    await options.sessions.logout(request.authContext!.sessionId, request.authContext!.userId);
    reply.clearCookie('flowforge_refresh', { path: '/v1/auth' });
    return reply.code(204).send(null);
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticateAccessToken: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authContext: { userId: string; sessionId: string } | null;
  }
}
