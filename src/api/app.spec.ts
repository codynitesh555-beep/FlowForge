import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createApiApp } from './app.js';
import type { ApiConfiguration } from './config.js';
import type { AuthenticationService } from '../modules/identity/application/authentication.js';
import type { RefreshSessionService } from '../modules/identity/infrastructure/refresh-sessions.js';
import { RefreshTokenReplayError } from '../modules/identity/infrastructure/refresh-sessions.js';
import type { PrismaOrganizationApplication, PrismaOrganizationMembershipResolver } from '../modules/identity/infrastructure/prisma-organizations.js';
import type { ProjectTaskService } from '../modules/projects/contracts.js';
import { ProjectTaskError } from '../modules/projects/domain/errors.js';

const config: ApiConfiguration = {
  nodeEnv: 'test', accessTokenSecret: 'local-test-secret-with-at-least-thirty-two-bytes',
  tokenIssuer: 'flowforge-test', tokenAudience: 'flowforge-api', accessTokenLifetimeSeconds: 600,
  allowedOrigins: new Set(['http://localhost:5173']), host: '127.0.0.1', port: 3000,
};
const user = { id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd151', email: 'person@example.test', displayName: 'Person' };
const issued = {
  accessToken: 'access-token', accessTokenExpiresAt: new Date('2026-01-01T00:10:00.000Z'),
  refreshToken: 'r'.repeat(43), refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
  sessionId: '9d8b9073-5ec8-46a7-9852-1587b52f59a2',
};

function makeApp(loggerStream?: Writable, readinessCheck = vi.fn(async () => undefined), configuration: ApiConfiguration = config) {
  const authentication = {
    register: vi.fn(async () => user),
    login: vi.fn(async () => ({ user, tokens: issued })),
  } as unknown as AuthenticationService;
  const sessions = {
    rotate: vi.fn(async () => ({ ...issued, refreshToken: 'n'.repeat(43) })),
    authenticateAccessToken: vi.fn(async () => ({ userId: user.id, sessionId: issued.sessionId })),
    logout: vi.fn(async () => undefined),
  } as unknown as RefreshSessionService;
  const organizations = {
    createForUser: vi.fn(async () => ({ id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152', name: 'Org', slug: 'org' })),
    listForUser: vi.fn(async () => []),
    listMembers: vi.fn(async () => []),
    changeMember: vi.fn(async () => ({ id: '9d8b9073-5ec8-46a7-9852-1587b52f59a2', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152', userId: user.id, role: 'MEMBER', status: 'ACTIVE' })),
  } as unknown as PrismaOrganizationApplication;
  const membershipResolver = {
    resolveActivePrincipal: vi.fn(async () => ({ userId: user.id, organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152', membershipId: issued.sessionId, role: 'OWNER' as const, membershipStatus: 'ACTIVE' as const })),
  } as unknown as PrismaOrganizationMembershipResolver;
  const projectTasks = {
    createProject: vi.fn(async () => ({ id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152', name: 'Delivery', description: null, graphRevision: 0, archivedAt: null })),
    listProjects: vi.fn(async () => []), getProject: vi.fn(async () => ({ id: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152', name: 'Delivery', description: null, graphRevision: 0, archivedAt: null })),
    updateProject: vi.fn(), archiveProject: vi.fn(), createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), updateTask: vi.fn(),
    softDeleteTask: vi.fn(), analyzeProject: vi.fn(async () => ({ graphRevision: 0, projectDurationHours: 0, topologicalOrder: [], criticalTaskIds: [], criticalPaths: [], isCriticalPathsTruncated: false, taskMetrics: [] })),
    addDependency: vi.fn(), removeDependency: vi.fn(), listTaskDependencies: vi.fn(), assignTask: vi.fn(), unassignTask: vi.fn(), listTaskAssignments: vi.fn(),
  } as unknown as ProjectTaskService;
  return { app: createApiApp({ configuration, checkDatabaseReadiness: readinessCheck, authentication, sessions, organizations, membershipResolver, projectTasks, loggerStream }), authentication, sessions, organizations, membershipResolver, projectTasks, readinessCheck };
}

function captureLogs() {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) { output += chunk.toString(); callback(); },
  });
  return {
    stream,
    output: () => output,
    records: () => output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('Fastify API', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  it('serves health and generated OpenAPI documentation without database access', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    const openapi = await harness.app.inject({ method: 'GET', url: '/documentation/json' });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths['/v1/auth/login']).toBeDefined();
    expect(openapi.json().paths['/v1/organizations/{organizationId}/projects/{projectId}/schedule']).toBeDefined();
  });

  it('disables Swagger UI and OpenAPI JSON in production while retaining Helmet security headers and API CSP', async () => {
    const productionConfig: ApiConfiguration = { ...config, nodeEnv: 'production' };
    const harness = makeApp(undefined, undefined, productionConfig); close = () => harness.app.close();

    const ui = await harness.app.inject({ method: 'GET', url: '/documentation' });
    const openapi = await harness.app.inject({ method: 'GET', url: '/documentation/json' });
    const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
    const csp = health.headers['content-security-policy'];

    expect(ui.statusCode).toBe(404);
    expect(openapi.statusCode).toBe(404);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('keeps liveness independent of the database and reports readiness when the probe succeeds', async () => {
    const readinessCheck = vi.fn(async () => undefined);
    const harness = makeApp(undefined, readinessCheck); close = () => harness.app.close();

    const liveness = await harness.app.inject({ method: 'GET', url: '/healthz' });
    const readiness = await harness.app.inject({ method: 'GET', url: '/readyz' });

    expect(liveness.statusCode).toBe(200);
    expect(liveness.json()).toEqual({ status: 'ok' });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({ status: 'ready' });
    expect(readinessCheck).toHaveBeenCalledOnce();
  });

  it('returns a generic 503 readiness response without exposing database errors', async () => {
    const readinessCheck = vi.fn(async () => { throw new Error('connection password=private-value'); });
    const harness = makeApp(undefined, readinessCheck); close = () => harness.app.close();

    const response = await harness.app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    expect(response.body).not.toContain('private-value');
    expect(response.body).not.toContain('connection');
    expect(readinessCheck).toHaveBeenCalledOnce();
  });

  it('returns a safe 400 response for malformed JSON without exposing parser details', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/register', headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'INVALID_REQUEST' });
    expect(response.body).not.toMatch(/JSON|parser|Unexpected|position/i);
  });

  it('returns a safe 404 response for an unmatched route', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const response = await harness.app.inject({ method: 'GET', url: '/v1/route-that-does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND' });
    expect(response.body).not.toMatch(/stack|error|message/i);
  });

  it('validates registration through Zod and returns only public user fields', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: { origin: 'http://localhost:5173' },
      payload: { email: 'person@example.test', displayName: 'Person', password: 'this is a long password' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(user);
    expect(response.body).not.toContain('password');
  });

  it('sets refresh token only as an HttpOnly SameSite cookie, never in JSON', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { email: 'person@example.test', password: 'this is a long password' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user, accessToken: 'access-token', accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString() });
    expect(response.body).not.toContain(issued.refreshToken);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(response.headers['set-cookie']).not.toContain('Secure');
  });

  it('rotates a cookie only from an allowed origin and requires bearer auth for logout', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const blocked = await harness.app.inject({
      method: 'POST', url: '/v1/auth/refresh', headers: { origin: 'https://attacker.example', cookie: `flowforge_refresh=${issued.refreshToken}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(harness.sessions.rotate).not.toHaveBeenCalled();

    const refreshed = await harness.app.inject({
      method: 'POST', url: '/v1/auth/refresh',
      headers: { origin: 'http://localhost:5173', cookie: `flowforge_refresh=${issued.refreshToken}`, 'x-flowforge-csrf': '1' },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body).not.toContain('n'.repeat(43));
    expect(harness.sessions.rotate).toHaveBeenCalledOnce();

    const loggedOut = await harness.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: 'Bearer test-token', origin: 'http://localhost:5173' } });
    expect(loggedOut.statusCode).toBe(204);
    expect(harness.sessions.logout).toHaveBeenCalledWith(issued.sessionId, user.id);
  });

  it('rejects refresh requests without an Origin header before rotating a cookie', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/refresh', headers: { cookie: `flowforge_refresh=${issued.refreshToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'ORIGIN_FORBIDDEN' });
    expect(harness.sessions.rotate).not.toHaveBeenCalled();
  });

  it.each([undefined, 'invalid'])('rejects refresh requests with a missing or invalid CSRF header (%s)', async (csrfHeader) => {
    const harness = makeApp(); close = () => harness.app.close();
    const headers: Record<string, string> = {
      origin: 'http://localhost:5173',
      cookie: `flowforge_refresh=${issued.refreshToken}`,
    };
    if (csrfHeader) headers['x-flowforge-csrf'] = csrfHeader;

    const response = await harness.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'CSRF_FORBIDDEN' });
    expect(harness.sessions.rotate).not.toHaveBeenCalled();
  });

  it('supports an allowlisted cross-site refresh with the CSRF header and secure production cookie attributes', async () => {
    const productionConfig: ApiConfiguration = {
      ...config,
      nodeEnv: 'production',
      allowedOrigins: new Set(['https://flowforge-ui.vercel.app']),
    };
    const harness = makeApp(undefined, undefined, productionConfig); close = () => harness.app.close();

    const login = await harness.app.inject({
      method: 'POST', url: '/v1/auth/login',
      headers: { origin: 'https://flowforge-ui.vercel.app' },
      payload: { email: 'person@example.test', password: 'this is a long password' },
    });
    const loginCookie = String(login.headers['set-cookie']);
    expect(login.statusCode).toBe(200);
    expect(loginCookie).toContain('HttpOnly');
    expect(loginCookie).toContain('Secure');
    expect(loginCookie).toContain('SameSite=None');
    expect(loginCookie).toContain('Path=/v1/auth');
    expect(loginCookie).not.toMatch(/Domain=/i);

    const refreshed = await harness.app.inject({
      method: 'POST', url: '/v1/auth/refresh',
      headers: {
        origin: 'https://flowforge-ui.vercel.app',
        cookie: `flowforge_refresh=${issued.refreshToken}`,
        'x-flowforge-csrf': '1',
      },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.headers['access-control-allow-origin']).toBe('https://flowforge-ui.vercel.app');
    expect(refreshed.headers['access-control-allow-credentials']).toBe('true');

    const preflight = await harness.app.inject({
      method: 'OPTIONS', url: '/v1/auth/refresh',
      headers: {
        origin: 'https://flowforge-ui.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-flowforge-csrf',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://flowforge-ui.vercel.app');
    expect(preflight.headers['access-control-allow-headers']).toContain('X-FlowForge-CSRF');

    const loggedOut = await harness.app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { authorization: 'Bearer test-token', origin: 'https://flowforge-ui.vercel.app' },
    });
    const clearedCookie = String(loggedOut.headers['set-cookie']);
    expect(loggedOut.statusCode).toBe(204);
    expect(clearedCookie).toContain('flowforge_refresh=');
    expect(clearedCookie).toContain('HttpOnly');
    expect(clearedCookie).toContain('Secure');
    expect(clearedCookie).toContain('SameSite=None');
    expect(clearedCookie).toContain('Path=/v1/auth');
    expect(clearedCookie).not.toMatch(/Domain=/i);
  });

  it('rejects missing and untrusted Origin on login and logout', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const missingLoginOrigin = await harness.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'person@example.test', password: 'this is a long password' },
    });
    const untrustedLogoutOrigin = await harness.app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { authorization: 'Bearer test-token', origin: 'https://attacker.example' },
    });

    expect(missingLoginOrigin.statusCode).toBe(403);
    expect(untrustedLogoutOrigin.statusCode).toBe(403);
    expect(harness.authentication.login).not.toHaveBeenCalled();
    expect(harness.sessions.logout).not.toHaveBeenCalled();
  });

  it('rejects registration from an untrusted Origin before creating an account', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: { origin: 'https://attacker.example' },
      payload: { email: 'person@example.test', displayName: 'Person', password: 'this is a long password' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'ORIGIN_FORBIDDEN' });
    expect(harness.authentication.register).not.toHaveBeenCalled();
  });

  it('clears a replayed refresh cookie with matching production attributes and preserves family revocation handling', async () => {
    const productionConfig: ApiConfiguration = {
      ...config,
      nodeEnv: 'production',
      allowedOrigins: new Set(['https://flowforge-ui.vercel.app']),
    };
    const harness = makeApp(undefined, undefined, productionConfig); close = () => harness.app.close();
    vi.mocked(harness.sessions.rotate).mockRejectedValueOnce(new RefreshTokenReplayError());

    const response = await harness.app.inject({
      method: 'POST', url: '/v1/auth/refresh',
      headers: {
        origin: 'https://flowforge-ui.vercel.app',
        cookie: `flowforge_refresh=${issued.refreshToken}`,
        'x-flowforge-csrf': '1',
      },
    });
    const clearedCookie = String(response.headers['set-cookie']);

    expect(response.statusCode).toBe(401);
    expect(clearedCookie).toContain('flowforge_refresh=');
    expect(clearedCookie).toContain('HttpOnly');
    expect(clearedCookie).toContain('Secure');
    expect(clearedCookie).toContain('SameSite=None');
    expect(clearedCookie).toContain('Path=/v1/auth');
    expect(clearedCookie).not.toMatch(/Domain=/i);
  });

  it('resolves organization scope from the authenticated user and rejects missing membership', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    vi.mocked(harness.membershipResolver.resolveActivePrincipal).mockResolvedValueOnce(null);
    const denied = await harness.app.inject({
      method: 'GET', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/members',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(denied.statusCode).toBe(403);
    expect(harness.organizations.listMembers).not.toHaveBeenCalled();
  });

  it('resolves organization scope before creating a project and rejects a body tenant override', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const path = '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects';
    const created = await harness.app.inject({
      method: 'POST', url: path, headers: { authorization: 'Bearer test-token' }, payload: { name: 'Delivery' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Delivery', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152' });
    expect(harness.projectTasks.createProject).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id, organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152' }), { name: 'Delivery' });

    const denied = await harness.app.inject({
      method: 'POST', url: path, headers: { authorization: 'Bearer test-token' },
      payload: { name: 'Delivery', organizationId: '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155' },
    });
    expect(denied.statusCode).toBe(400);
    expect(harness.projectTasks.createProject).toHaveBeenCalledOnce();
  });

  it('returns JSON-safe scheduling DTOs and maps stale task versions to conflict', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    const organizationId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152';
    const projectId = '2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154';
    const schedule = await harness.app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/projects/${projectId}/schedule`, headers: { authorization: 'Bearer test-token' } });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json()).toEqual({ graphRevision: 0, projectDurationHours: 0, topologicalOrder: [], criticalTaskIds: [], criticalPaths: [], isCriticalPathsTruncated: false, taskMetrics: [] });

    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(new ProjectTaskError('TASK_VERSION_CONFLICT'));
    const stale = await harness.app.inject({
      method: 'PATCH', url: `/v1/organizations/${organizationId}/projects/${projectId}/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155`,
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'New name' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ code: 'TASK_VERSION_CONFLICT' });
  });

  it('rejects cross-organization project access before calling the project service', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    vi.mocked(harness.membershipResolver.resolveActivePrincipal).mockResolvedValueOnce(null);
    const response = await harness.app.inject({
      method: 'GET', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/schedule',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'ORGANIZATION_ACCESS_DENIED' });
    expect(harness.projectTasks.analyzeProject).not.toHaveBeenCalled();
  });

  it('keeps graph diagnostics internal and returns a stable server error', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    vi.mocked(harness.projectTasks.analyzeProject).mockRejectedValueOnce(
      new ProjectTaskError('INVALID_PROJECT_GRAPH', { graphCode: 'GRAPH_INVALID_NODE' }),
    );
    const response = await harness.app.inject({
      method: 'GET', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/schedule',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INVALID_PROJECT_GRAPH' });
    expect(response.body).not.toContain('GRAPH_INVALID_NODE');
  });

  it('maps persistence invariant failures to a generic internal error', async () => {
    const harness = makeApp(); close = () => harness.app.close();
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(
      new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'task.update.read-after-write' }),
    );
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('read-after-write');
  });

  it('returns generic graph errors and logs only an approved graph diagnostic', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const sqlMessage = 'SELECT private_sql_sentinel';
    const secret = 'private_exception_sentinel';
    const graphError = Object.assign(
      new ProjectTaskError('INVALID_PROJECT_GRAPH', { graphCode: 'GRAPH_MISSING_NODE', sql: sqlMessage }),
      { message: sqlMessage, stack: `private_stack_sentinel ${secret}`, meta: { constraint: 'private_constraint_sentinel', secret } },
    );
    vi.mocked(harness.projectTasks.analyzeProject).mockRejectedValueOnce(graphError);
    const response = await harness.app.inject({
      method: 'GET', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/schedule',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INVALID_PROJECT_GRAPH' });
    for (const value of [sqlMessage, secret, 'private_stack_sentinel', 'private_constraint_sentinel', 'GRAPH_MISSING_NODE']) {
      expect(response.body).not.toContain(value);
    }
    const record = logs.records().find((entry) => entry.msg === 'Project graph analysis failed');
    expect(record).toMatchObject({ code: 'INVALID_PROJECT_GRAPH', graphCode: 'GRAPH_MISSING_NODE' });
    expect(record).not.toHaveProperty('meta');
    expect(record).not.toHaveProperty('stack');
    for (const value of [sqlMessage, secret, 'private_stack_sentinel', 'private_constraint_sentinel']) expect(logs.output()).not.toContain(value);
  });

  it('returns generic persistence errors and logs only the approved operation diagnostic', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const sqlMessage = 'UPDATE private_table SET value = private_sql_sentinel';
    const secret = 'private_exception_sentinel';
    const invariant = Object.assign(
      new ProjectTaskError('PERSISTENCE_INVARIANT_VIOLATION', { operation: 'task.update.read-after-write', sql: sqlMessage }),
      { message: sqlMessage, stack: `private_stack_sentinel ${secret}`, meta: { constraint: 'private_constraint_sentinel', password: secret } },
    );
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(invariant);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    for (const value of [sqlMessage, secret, 'private_stack_sentinel', 'private_constraint_sentinel', 'task.update.read-after-write']) {
      expect(response.body).not.toContain(value);
    }
    const record = logs.records().find((entry) => entry.msg === 'Project persistence invariant failed');
    expect(record).toMatchObject({ code: 'PERSISTENCE_INVARIANT_VIOLATION', operation: 'task.update.read-after-write' });
    expect(record).not.toHaveProperty('meta');
    expect(record).not.toHaveProperty('stack');
    for (const value of [sqlMessage, secret, 'private_stack_sentinel', 'private_constraint_sentinel']) expect(logs.output()).not.toContain(value);
  });

  it('omits unapproved graph diagnostic text instead of logging arbitrary error details', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const unsafe = 'private_graph_message_sentinel';
    vi.mocked(harness.projectTasks.analyzeProject).mockRejectedValueOnce(
      new ProjectTaskError('INVALID_PROJECT_GRAPH', { graphCode: unsafe }),
    );
    const response = await harness.app.inject({
      method: 'GET', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/schedule',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(500);
    const record = logs.records().find((entry) => entry.msg === 'Project graph analysis failed');
    expect(record).toMatchObject({ code: 'INVALID_PROJECT_GRAPH' });
    expect(record).not.toHaveProperty('graphCode');
    expect(logs.output()).not.toContain(unsafe);
  });

  it('keeps Prisma SQL diagnostics out of responses and logs only a fixed error category and approved code', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const sqlMessage = 'private SQL statement sentinel';
    const stack = 'private stack trace sentinel';
    const constraint = 'private constraint name sentinel';
    const secret = 'private credential sentinel';
    const prismaError = Object.assign(new Error(sqlMessage), {
      name: 'PrismaClientKnownRequestError', code: 'P2010', stack,
      meta: { code: '23505', constraint, database_error: sqlMessage, password: secret },
    });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(prismaError);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    for (const value of [sqlMessage, stack, constraint, secret, '23505']) expect(response.body).not.toContain(value);
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'ERROR', diagnosticCode: 'P2010' });
    expect(record).not.toHaveProperty('meta');
    expect(record).not.toHaveProperty('stack');
    expect(record).not.toHaveProperty('err');
    for (const value of [sqlMessage, stack, constraint, secret, '23505']) expect(logs.output()).not.toContain(value);
  });

  it('keeps unknown errors generic even if an arbitrary error carries a conflict statusCode', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const unknown = Object.assign(new Error('private unknown error'), { statusCode: 409 });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(unknown);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('private unknown error');
    expect(logs.output()).not.toContain('private unknown error');
  });

  it('uses a fixed error category instead of a malicious Error.name', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const maliciousName = 'private_custom_name_sentinel';
    const malicious = Object.assign(new Error('private_custom_message_sentinel'), {
      name: maliciousName,
      stack: 'private_custom_stack_sentinel',
      sql: 'private_custom_sql_sentinel',
      constraint: 'private_custom_constraint_sentinel',
    });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(malicious);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'ERROR' });
    expect(record).not.toHaveProperty('diagnosticCode');
    for (const value of [maliciousName, 'private_custom_message_sentinel', 'private_custom_stack_sentinel', 'private_custom_sql_sentinel', 'private_custom_constraint_sentinel']) {
      expect(response.body).not.toContain(value);
      expect(logs.output()).not.toContain(value);
    }
  });

  it('uses a fixed non-error category for an unknown object with an arbitrary name', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const arbitraryName = 'private_object_name_sentinel';
    const thrown = { name: arbitraryName, stack: 'private_object_stack_sentinel', sql: 'private_object_sql_sentinel', details: { password: 'private_object_secret_sentinel' } };
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(thrown);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'NON_ERROR_THROWABLE' });
    expect(record).not.toHaveProperty('diagnosticCode');
    for (const value of [arbitraryName, 'private_object_stack_sentinel', 'private_object_sql_sentinel', 'private_object_secret_sentinel']) {
      expect(response.body).not.toContain(value);
      expect(logs.output()).not.toContain(value);
    }
  });

  it('does not promote a SQLSTATE-like meta.code into a logged diagnostic', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const thrown = Object.assign(new Error('private_meta_message_sentinel'), {
      meta: { code: '23505', constraint: 'private_meta_constraint_sentinel', sql: 'private_meta_sql_sentinel' },
      stack: 'private_meta_stack_sentinel',
    });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(thrown);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'ERROR' });
    expect(record).not.toHaveProperty('diagnosticCode');
    for (const value of ['23505', 'private_meta_message_sentinel', 'private_meta_constraint_sentinel', 'private_meta_sql_sentinel', 'private_meta_stack_sentinel']) {
      expect(response.body).not.toContain(value);
      expect(logs.output()).not.toContain(value);
    }
  });

  it('omits a syntax-valid Prisma code that is not in the diagnostic allowlist', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const thrown = Object.assign(new Error('private_unapproved_code_message'), { code: 'P9999', stack: 'private_unapproved_code_stack' });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(thrown);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'ERROR' });
    expect(record).not.toHaveProperty('diagnosticCode');
    expect(response.body).not.toContain('P9999');
    expect(logs.output()).not.toContain('P9999');
  });

  it('logs an explicitly approved Prisma diagnostic code without logging arbitrary attached properties', async () => {
    const logs = captureLogs();
    const harness = makeApp(logs.stream); close = async () => { await harness.app.close(); logs.stream.destroy(); };
    const thrown = Object.assign(new Error('private_approved_code_message'), {
      code: 'P2002', stack: 'private_approved_code_stack', meta: { code: '23505', constraint: 'private_approved_constraint' },
      sql: 'private_approved_sql', password: 'private_approved_secret',
    });
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(thrown);
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    const record = logs.records().find((entry) => entry.msg === 'Unhandled API error');
    expect(record).toMatchObject({ errorType: 'ERROR', diagnosticCode: 'P2002' });
    for (const value of ['private_approved_code_message', 'private_approved_code_stack', '23505', 'private_approved_constraint', 'private_approved_sql', 'private_approved_secret']) {
      expect(response.body).not.toContain(value);
      expect(logs.output()).not.toContain(value);
    }
  });

  it.each([
    ['INVALID_TASK_INPUT', 400],
    ['TASK_NOT_FOUND', 404],
    ['MEMBERSHIP_NOT_ACTIVE', 403],
    ['TASK_VERSION_CONFLICT', 409],
  ] as const)('preserves stable domain status mapping for %s', async (code, status) => {
    const harness = makeApp(); close = () => harness.app.close();
    vi.mocked(harness.projectTasks.updateTask).mockRejectedValueOnce(new ProjectTaskError(code));
    const response = await harness.app.inject({
      method: 'PATCH', url: '/v1/organizations/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd152/projects/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd154/tasks/2a3ebad4-60cf-4cdb-8e1c-97fb2a4bd155',
      headers: { authorization: 'Bearer test-token' }, payload: { expectedVersion: 1, name: 'Updated' },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code });
  });
});
