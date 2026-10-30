import { describe, expect, it } from 'vitest';
import { requireDedicatedIntegrationDatabase } from './integration-safety.js';
import { createIntegrationPrismaClient } from './integration-prisma.js';
import type { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaClient } from '../../generated/prisma/client.js';

describe('integration database safety guard', () => {
  it('requires TEST_DATABASE_URL without requiring DATABASE_URL', () => {
    expect(() => requireDedicatedIntegrationDatabase({})).toThrow(/TEST_DATABASE_URL is required/);
    expect(requireDedicatedIntegrationDatabase({
      TEST_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch',
    })).toContain('/flowforge_test_scratch');
    expect(requireDedicatedIntegrationDatabase({
      TEST_DATABASE_URL: 'postgresql://test:test-secret@[::1]:55432/flowforge_test_scratch',
    })).toContain('@[::1]:55432/');
  });

  it('constructs only from the validated canonical TEST_DATABASE_URL without connecting', () => {
    const adapter = {} as PrismaPg;
    const client = {} as PrismaClient;
    let observedConfiguration: unknown;
    const returned = createIntegrationPrismaClient({
      TEST_DATABASE_URL: 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch',
    }, {
      createAdapter: (configuration) => { observedConfiguration = configuration; return adapter; },
      createClient: (actualAdapter) => { expect(actualAdapter).toBe(adapter); return client; },
    });
    expect(returned).toBe(client);
    expect(observedConfiguration).toEqual({
      connectionString: 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch',
      ssl: false,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
  });

  it.each([
    ['protected database name', 'postgresql://test:test-secret@127.0.0.1:55432/flowforge'],
    ['protected port', 'postgresql://test:test-secret@127.0.0.1:5433/flowforge_test_scratch'],
    ['URL host override', 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch?host=localhost'],
    ['non-allowlisted host', 'postgresql://test:test-secret@db.example.com:55432/flowforge_test_scratch'],
    ['trailing-dot host', 'postgresql://test:test-secret@127.0.0.1.:55432/flowforge_test_scratch'],
    ['empty database', 'postgresql://test:test-secret@127.0.0.1:55432/'],
  ])('rejects %s and never echoes credentials', (_name, url) => {
    let caught: unknown;
    try {
      requireDedicatedIntegrationDatabase({ TEST_DATABASE_URL: url });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('test-secret');
  });

  it('rejects test targets identical to any explicitly supplied application or CLI URL', () => {
    const testUrl = 'postgresql://test:test-secret@127.0.0.1:55432/flowforge_test_scratch';
    expect(() => requireDedicatedIntegrationDatabase({
      TEST_DATABASE_URL: testUrl,
      DATABASE_URL: testUrl,
    })).toThrow(/separate from DATABASE_URL/);
    expect(() => requireDedicatedIntegrationDatabase({
      TEST_DATABASE_URL: testUrl,
      MIGRATION_DATABASE_URL: testUrl,
    })).toThrow(/separate from MIGRATION_DATABASE_URL/);
  });
});
