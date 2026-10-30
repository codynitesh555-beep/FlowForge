import { describe, expect, it } from 'vitest';
import { validateProductionMigrationDatabaseUrl } from './production-migration-target.js';

const validProductionUrl = 'postgresql://migrator:example-password@db.example.test:5432/flowforge_prod?sslmode=verify-full';

describe('production migration database target', () => {
  it('accepts an explicit remote target with full TLS verification', () => {
    expect(validateProductionMigrationDatabaseUrl(validProductionUrl)).toBe(validProductionUrl);
  });

  it('requires MIGRATION_DATABASE_URL and never includes URL credentials in errors', () => {
    expect(() => validateProductionMigrationDatabaseUrl(undefined)).toThrow(/MIGRATION_DATABASE_URL/);
    try {
      validateProductionMigrationDatabaseUrl('postgresql://user:private-value@bad host/db');
      throw new Error('Expected migration target validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('MIGRATION_DATABASE_URL');
      expect((error as Error).message).not.toContain('private-value');
    }
  });

  it.each([
    'postgresql://user:secret@localhost:5432/flowforge_prod?sslmode=verify-full',
    'postgresql://user:secret@127.0.0.1:5432/flowforge_prod?sslmode=verify-full',
    'postgresql://user:secret@flowforge-postgres:5432/flowforge_prod?sslmode=verify-full',
    'postgresql://user:secret@host.docker.internal:5432/flowforge_prod?sslmode=verify-full',
    'postgresql://user:secret@db.example.test:5433/flowforge_prod?sslmode=verify-full',
    'postgresql://user:secret@db.example.test:5432/flowforge?sslmode=verify-full',
    'postgresql://user:secret@db.example.test:5432/flowforge_test_scratch?sslmode=verify-full',
    'postgresql://user:secret@db.example.test:5432/flowforge_prod?sslmode=require',
    'postgresql://user:secret@db.example.test:5432/flowforge_prod?sslmode=verify-full&host=127.0.0.1',
  ])('rejects unsafe migration targets (%s)', (url) => {
    expect(() => validateProductionMigrationDatabaseUrl(url)).toThrow(/MIGRATION_DATABASE_URL/);
  });
});
