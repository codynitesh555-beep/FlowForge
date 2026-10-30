import { describe, expect, it } from 'vitest';
import {
  loadEnvironment,
  loadIntegrationDatabaseTarget,
  loadPrismaCliEnvironment,
  parseDatabaseTarget,
} from './env.js';

const protectedAppUrl = 'postgresql://app:app-secret@localhost:5433/flowforge';
const scratchUrl = 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch';

function thrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the operation to throw.');
}

describe('parseDatabaseTarget', () => {
  it('accepts an explicit local scratch target and exposes parsed target metadata', () => {
    const target = parseDatabaseTarget('TEST_DATABASE_URL', scratchUrl);
    expect(target.hostname).toBe('127.0.0.1');
    expect(target.port).toBe(55432);
    expect(target.databaseName).toBe('flowforge_test_scratch');
  });

  it.each([
    ['protected hostname override', `${scratchUrl}?host=localhost`],
    ['protected port override', `${scratchUrl}?%70ort=5433`],
    ['protected database override', `${scratchUrl}?database=flowforge`],
    ['user override', `${scratchUrl}?user=attacker`],
    ['password override', `${scratchUrl}?password=other-secret`],
    ['multiple hosts', `${scratchUrl}?host=localhost%2C127.0.0.1`],
    ['multiple host parameters', `${scratchUrl}?host=localhost&host=127.0.0.1`],
    ['encoded routing parameter', `${scratchUrl}?%68ost=localhost`],
    ['conflicting duplicate parameters', `${scratchUrl}?sslmode=require&sslmode=disable`],
    ['IPv4 trailing dot', 'postgresql://test:test-secret@127.0.0.1.:55432/flowforge_test_scratch'],
    ['DNS trailing dot', 'postgresql://test:test-secret@localhost.:55432/flowforge_test_scratch'],
    ['DNS scratch hostname', 'postgresql://test:test-secret@localhost:55432/flowforge_test_scratch'],
    ['IPv4-mapped IPv6 loopback', 'postgresql://test:test-secret@[::ffff:127.0.0.1]:55432/flowforge_test_scratch'],
    ['expanded IPv4-mapped IPv6 loopback', 'postgresql://test:test-secret@[::ffff:7f00:1]:55432/flowforge_test_scratch'],
    ['short IPv4 form', 'postgresql://test:test-secret@127.1:55432/flowforge_test_scratch'],
    ['hex IPv4 form', 'postgresql://test:test-secret@0x7f000001:55432/flowforge_test_scratch'],
    ['octal IPv4 form', 'postgresql://test:test-secret@0177.0.0.1:55432/flowforge_test_scratch'],
    ['URL-encoded hostname', 'postgresql://test:test-secret@%31%32%37.0.0.1:55432/flowforge_test_scratch'],
    ['protected port', 'postgresql://test:test-secret@127.0.0.1:5433/flowforge_test_scratch'],
    ['protected database', 'postgresql://test:test-secret@127.0.0.1:55432/flowforge'],
  ])('rejects %s without returning credential material', (_case, url) => {
    const message = thrownMessage(() => [
      'protected port', 'protected database', 'DNS scratch hostname',
      'IPv4-mapped IPv6 loopback', 'expanded IPv4-mapped IPv6 loopback',
      'short IPv4 form', 'hex IPv4 form', 'octal IPv4 form', 'URL-encoded hostname',
    ].includes(_case)
      ? loadIntegrationDatabaseTarget({ TEST_DATABASE_URL: url })
      : parseDatabaseTarget('TEST_DATABASE_URL', url));
    expect(message).not.toContain('test-secret');
    expect(message).toMatch(/TEST_DATABASE_URL/);
  });

  it('accepts canonical IPv4 and bracketed IPv6 loopback targets', () => {
    expect(parseDatabaseTarget('TEST_DATABASE_URL', scratchUrl).hostname).toBe('127.0.0.1');
    expect(parseDatabaseTarget('TEST_DATABASE_URL', 'postgresql://test:test-secret@[::1]:55432/flowforge_test_scratch').hostname).toBe('::1');
  });

  it('accepts only explicit full certificate and hostname verification mode', () => {
    expect(parseDatabaseTarget('DATABASE_URL', 'postgresql://app:secret@db.example.com:55432/app_db?sslmode=verify-full', { allowSafeQuery: true }).hostname).toBe('db.example.com');
  });

  it.each(['no-verify', 'disable', 'require', 'prefer', 'made-up'])('rejects sslmode=%s even when safe URL parameters are enabled', (sslmode) => {
    const message = thrownMessage(() => parseDatabaseTarget(
      'DATABASE_URL',
      `postgresql://app:secret@db.example.com:55432/app_db?sslmode=${sslmode}`,
      { allowSafeQuery: true },
    ));
    expect(message).toMatch(/SSL mode/);
  });

  it.each([
    ['malformed URL', 'postgresql://bad secret'],
    ['empty database name', 'postgresql://test:test-secret@127.0.0.1:55432/'],
    ['missing explicit port', 'postgresql://test:test-secret@127.0.0.1/flowforge_test_scratch'],
    ['missing password', 'postgresql://test@127.0.0.1:55432/flowforge_test_scratch'],
    ['unsupported format', '/tmp/postgres.sock flowforge_test_scratch'],
  ])('rejects %s', (_case, url) => {
    const message = thrownMessage(() => parseDatabaseTarget('TEST_DATABASE_URL', url));
    expect(message).not.toContain('test-secret');
  });

});

describe('loadEnvironment', () => {
  it('requires valid credentials and does not echo malformed URL secrets', () => {
    expect(thrownMessage(() => loadEnvironment({}))).toMatch(/DATABASE_URL is required/);
    const message = thrownMessage(() => loadEnvironment({ DATABASE_URL: 'postgresql://user:top-secret@bad host/db' }));
    expect(message).not.toContain('top-secret');
    expect(message).toMatch(/DATABASE_URL/);
  });

  it('validates runtime URL, pool settings, and freezes the result', () => {
    const environment = loadEnvironment({
      DATABASE_URL: protectedAppUrl,
      TEST_DATABASE_URL: scratchUrl,
      DATABASE_POOL_MAX: '4',
      DATABASE_CONNECTION_TIMEOUT_MS: '750',
      DATABASE_IDLE_TIMEOUT_MS: '9000',
    });
    expect(environment.databasePoolMax).toBe(4);
    expect(environment.databaseConnectionTimeoutMs).toBe(750);
    expect(environment.databaseIdleTimeoutMs).toBe(9000);
    expect(environment.testDatabaseUrl).toBe(scratchUrl);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('rejects malformed pool values and test targets that are protected or aliased', () => {
    expect(thrownMessage(() => loadEnvironment({ DATABASE_URL: protectedAppUrl, DATABASE_POOL_MAX: '0' }))).toMatch(/positive integer/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: protectedAppUrl,
      TEST_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:55432/flowforge',
    }))).toMatch(/protected/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: protectedAppUrl,
      TEST_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:5433/flowforge_other_scratch',
    }))).toMatch(/protected/);
  });

  it('requires test URLs explicitly and separates application, test, and shadow targets', () => {
    expect(loadEnvironment({ DATABASE_URL: protectedAppUrl }).testDatabaseUrl).toBeUndefined();
    expect(thrownMessage(() => loadIntegrationDatabaseTarget({ DATABASE_URL: protectedAppUrl }))).toMatch(/TEST_DATABASE_URL is required/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: protectedAppUrl,
      TEST_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:5433/flowforge_test_scratch',
    }))).toMatch(/protected/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: 'postgresql://app:app-secret@db.example.com:55432/flowforge_test_scratch',
      TEST_DATABASE_URL: scratchUrl,
    }))).toMatch(/separate database/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: 'postgresql://app:app-secret@localhost:55432/flowforge_test_scratch',
      TEST_DATABASE_URL: scratchUrl,
    }))).toMatch(/separate database/);
    expect(thrownMessage(() => loadEnvironment({
      DATABASE_URL: protectedAppUrl,
      SHADOW_DATABASE_URL: 'postgresql://shadow:shadow-secret@localhost:5433/flowforge_test_scratch',
    }))).toMatch(/separate, non-protected/);
  });
});

describe('loadPrismaCliEnvironment', () => {
  it('requires a separate scratch migration URL and never falls back to DATABASE_URL', () => {
    const message = thrownMessage(() => loadPrismaCliEnvironment({ DATABASE_URL: protectedAppUrl }));
    expect(message).toMatch(/MIGRATION_DATABASE_URL is required/);
    expect(message).not.toContain('app-secret');
    expect(loadPrismaCliEnvironment({
      DATABASE_URL: protectedAppUrl,
      MIGRATION_DATABASE_URL: scratchUrl,
    }).migrationDatabaseUrl).toBe(scratchUrl);
  });

  it('rejects protected or overlapping migration and shadow targets', () => {
    expect(thrownMessage(() => loadPrismaCliEnvironment({
      MIGRATION_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:5433/flowforge_scratch',
    }))).toMatch(/protected/);
    expect(thrownMessage(() => loadPrismaCliEnvironment({
      DATABASE_URL: scratchUrl,
      MIGRATION_DATABASE_URL: scratchUrl,
    }))).toMatch(/separate from DATABASE_URL/);
    expect(thrownMessage(() => loadPrismaCliEnvironment({
      MIGRATION_DATABASE_URL: scratchUrl,
      TEST_DATABASE_URL: scratchUrl,
    }))).toMatch(/separate from all Prisma CLI databases/);
    expect(thrownMessage(() => loadPrismaCliEnvironment({
      MIGRATION_DATABASE_URL: scratchUrl,
      SHADOW_DATABASE_URL: scratchUrl,
    }))).toMatch(/separate/);
    expect(thrownMessage(() => loadPrismaCliEnvironment({
      MIGRATION_DATABASE_URL: scratchUrl,
      SHADOW_DATABASE_URL: 'postgresql://shadow:shadow-secret@[::1]:55432/flowforge_test_scratch',
    }))).toMatch(/separate/);
  });
});
