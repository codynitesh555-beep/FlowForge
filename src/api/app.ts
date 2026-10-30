import Fastify, { type FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthenticationService } from '../modules/identity/application/authentication.js';
import { RefreshSessionService } from '../modules/identity/infrastructure/refresh-sessions.js';
import { authRoutes } from './auth-routes.js';
import { organizationRoutes } from './organization-routes.js';
import type { PrismaOrganizationApplication, PrismaOrganizationMembershipResolver } from '../modules/identity/infrastructure/prisma-organizations.js';
import type { OrganizationInvitationService } from '../modules/identity/application/invitations.js';
import type { PasswordResetService } from '../modules/identity/application/password-reset.js';
import { passwordResetRoutes } from './password-reset-routes.js';
import type { ApiConfiguration } from './config.js';
import { AuthorizationError, MembershipInvariantError } from '../modules/identity/domain/policies.js';
import { MembershipNotFoundError } from '../modules/identity/application/membership-lifecycle.service.js';
import type { ProjectTaskService } from '../modules/projects/contracts.js';
import { ProjectTaskError } from '../modules/projects/domain/errors.js';
import { projectTaskRoutes } from './project-task-routes.js';

export interface ApiDependencies {
  readonly configuration: ApiConfiguration;
  readonly checkDatabaseReadiness: () => Promise<void>;
  readonly authentication: AuthenticationService;
  readonly sessions: RefreshSessionService;
  readonly organizations: PrismaOrganizationApplication;
  readonly membershipResolver: PrismaOrganizationMembershipResolver;
  readonly invitations?: OrganizationInvitationService;
  readonly passwordReset?: PasswordResetService;
  readonly projectTasks: ProjectTaskService;
  /** Test-only log capture. Production logging cannot be overridden through this seam. */
  readonly loggerStream?: Writable;
}

const redactedLogPaths = [
  'req.headers.authorization', 'req.headers.cookie', 'req.body.email', 'req.body.password',
  'req.body.newPassword', 'req.body.refreshToken', 'req.body.token',
];
const allowedGraphCodes = new Set([
  'GRAPH_CYCLE_DETECTED', 'GRAPH_MISSING_NODE', 'GRAPH_INVALID_DURATION',
  'GRAPH_DUPLICATE_NODE_ID', 'GRAPH_EMPTY_NODE_ID', 'GRAPH_NUMERICAL_OVERFLOW',
]);
const allowedPersistenceOperations = new Set([
  'project.update.read-after-write', 'project.archive.assignment-release',
  'task.update.read-after-write', 'task.delete.assignment-release', 'task.delete.read-after-write',
]);
const allowedPrismaDiagnosticCodes = new Set(['P2002', 'P2003', 'P2010', 'P2025']);
const allowedProjectTaskCodes = new Set([
  'INVALID_PROJECT_INPUT', 'INVALID_TASK_INPUT', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED',
  'TASK_NOT_FOUND', 'TASK_VERSION_CONFLICT', 'TASK_DELETED', 'DEPENDENCY_NOT_FOUND',
  'DEPENDENCY_EXISTS', 'DEPENDENCY_CYCLE', 'INVALID_PROJECT_GRAPH', 'ASSIGNMENT_NOT_FOUND',
  'ASSIGNMENT_EXISTS', 'MEMBERSHIP_NOT_ACTIVE', 'MEMBERSHIP_NOT_FOUND', 'PERSISTENCE_INVARIANT_VIOLATION',
]);

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return typeof code === 'string' && allowedPrismaDiagnosticCodes.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function createApiApp(dependencies: ApiDependencies): FastifyInstance {
  const { configuration } = dependencies;
  if (dependencies.loggerStream && configuration.nodeEnv !== 'test') {
    throw new Error('loggerStream is available only in test mode.');
  }
  const app = Fastify({
    logger: configuration.nodeEnv === 'test' && !dependencies.loggerStream ? false : {
      redact: { paths: redactedLogPaths, censor: '[REDACTED]' },
      ...(dependencies.loggerStream ? { stream: dependencies.loggerStream } : {}),
    },
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('authContext', null);
  app.decorate('authenticateAccessToken', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      reply.code(401).send({ code: 'UNAUTHENTICATED' });
      return;
    }
    try {
      request.authContext = await dependencies.sessions.authenticateAccessToken(header.slice(7));
    } catch {
      reply.code(401).send({ code: 'UNAUTHENTICATED' });
    }
  });

  void app.register(cookie);
  void app.register(helmet, configuration.nodeEnv === 'production' ? {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  } : { contentSecurityPolicy: false });
  void app.register(cors, {
    origin: [...configuration.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-FlowForge-CSRF'],
  });
  void app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  if (configuration.nodeEnv !== 'production') {
    void app.register(swagger, {
      openapi: {
        info: { title: 'FlowForge API', version: '1.0.0', description: 'FlowForge organization and engineering workflow API.' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
      transform: jsonSchemaTransform,
    });
    void app.register(swaggerUi, { routePrefix: '/documentation' });
  }

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' });
    }
    if (error instanceof Error && ['FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY'].includes((error as Error & { code?: string }).code ?? '')) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' });
    }
    if (error instanceof AuthorizationError) {
      const status = error.code === 'AUTHENTICATION_REQUIRED' ? 401 : 403;
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof MembershipInvariantError) return reply.code(409).send({ code: error.code });
    if (error instanceof MembershipNotFoundError || (error instanceof Error && error.message === 'MEMBERSHIP_NOT_FOUND')) {
      return reply.code(404).send({ code: 'MEMBERSHIP_NOT_FOUND' });
    }
    if (error instanceof ProjectTaskError) {
      if (error.code === 'INVALID_PROJECT_GRAPH') {
        const graphCode = error.details?.graphCode;
        request.log.warn({ code: error.code, ...(typeof graphCode === 'string' && allowedGraphCodes.has(graphCode) ? { graphCode } : {}) }, 'Project graph analysis failed');
        return reply.code(500).send({ code: 'INVALID_PROJECT_GRAPH' });
      }
      if (error.code === 'PERSISTENCE_INVARIANT_VIOLATION') {
        const operation = error.details?.operation;
        request.log.error({ code: error.code, ...(typeof operation === 'string' && allowedPersistenceOperations.has(operation) ? { operation } : {}) }, 'Project persistence invariant failed');
        return reply.code(500).send({ code: 'INTERNAL_ERROR' });
      }
      const status = ['INVALID_PROJECT_INPUT', 'INVALID_TASK_INPUT'].includes(error.code) ? 400
        : ['PROJECT_NOT_FOUND', 'TASK_NOT_FOUND', 'DEPENDENCY_NOT_FOUND', 'ASSIGNMENT_NOT_FOUND', 'MEMBERSHIP_NOT_FOUND'].includes(error.code) ? 404
        : error.code === 'MEMBERSHIP_NOT_ACTIVE' ? 403
        : ['PROJECT_ARCHIVED', 'TASK_VERSION_CONFLICT', 'DEPENDENCY_EXISTS', 'DEPENDENCY_CYCLE', 'ASSIGNMENT_EXISTS'].includes(error.code) ? 409
        : 500;
      if (status === 500) {
        request.log.error({
          errorType: 'PROJECT_TASK_ERROR',
          ...(allowedProjectTaskCodes.has(error.code) ? { code: error.code } : {}),
        }, 'Unhandled project/task error');
        return reply.code(500).send({ code: 'INTERNAL_ERROR' });
      }
      return reply.code(status).send({ code: error.code });
    }
    const diagnosticCode = safeErrorCode(error);
    request.log.error({
      errorType: error instanceof Error ? 'ERROR' : 'NON_ERROR_THROWABLE',
      ...(diagnosticCode ? { diagnosticCode } : {}),
    }, 'Unhandled API error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND' }));

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  app.get('/healthz', { schema: { tags: ['Health'], response: { 200: z.object({ status: z.literal('ok') }) } } }, async () => ({ status: 'ok' }));
  app.get('/readyz', {
    schema: {
      tags: ['Health'],
      summary: 'Check whether the API can serve requests using its database',
      response: {
        200: z.object({ status: z.literal('ready') }),
        503: z.object({ status: z.literal('not_ready') }),
      },
    },
  }, async (request, reply) => {
    try {
      await dependencies.checkDatabaseReadiness();
      return reply.send({ status: 'ready' });
    } catch (error) {
      const prismaError = error as {
        code?: unknown;
        meta?: { code?: unknown; message?: unknown; database_error?: unknown };
      };

      request.log.error({
        errorType: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        diagnosticCode: safeErrorCode(error) ?? 'UNCLASSIFIED',
        databaseCode: typeof prismaError.meta?.code === 'string' ? prismaError.meta.code : undefined,
        databaseMessage: typeof prismaError.meta?.message === 'string'
          ? prismaError.meta.message.slice(0, 300)
          : typeof prismaError.meta?.database_error === 'string'
            ? prismaError.meta.database_error.slice(0, 300)
            : undefined,
      }, 'Database readiness check failed');

      return reply.code(503).send({ status: 'not_ready' });
    }
  });
  void app.register(authRoutes({
    authentication: dependencies.authentication,
    sessions: dependencies.sessions,
    cookieSecure: configuration.nodeEnv === 'production',
    allowedOrigins: configuration.allowedOrigins,
  }));
  void app.register(organizationRoutes({
    organizations: dependencies.organizations,
    membershipResolver: dependencies.membershipResolver,
    invitations: dependencies.invitations,
  }));
  void app.register(projectTaskRoutes({ service: dependencies.projectTasks, membershipResolver: dependencies.membershipResolver }));
  if (dependencies.passwordReset) void app.register(passwordResetRoutes(dependencies.passwordReset));
  return app;
}
