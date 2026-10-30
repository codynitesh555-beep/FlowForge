import { describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '../../config/env.js';
import {
  createDatabaseClientSingleton,
  createPgPoolConfiguration,
  createPrismaClient,
  type DatabaseLifecycleClient,
  type PrismaConstructionFactories,
} from './prisma.js';
import type { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaClient } from '../../generated/prisma/client.js';

const environment = loadEnvironment({
  DATABASE_URL: 'postgresql://unit:unit-secret@127.0.0.1:65432/unit_test',
  DATABASE_POOL_MAX: '2',
  DATABASE_CONNECTION_TIMEOUT_MS: '250',
  DATABASE_IDLE_TIMEOUT_MS: '500',
});

describe('Prisma database infrastructure', () => {
  it('passes the validated URL and explicit pool settings to PrismaPg', () => {
    expect(createPgPoolConfiguration(environment)).toEqual({
      connectionString: environment.databaseUrl,
      ssl: false,
      max: 2,
      connectionTimeoutMillis: 250,
      idleTimeoutMillis: 500,
    });
  });

  it('requires certificate verification for remote application database pools', () => {
    const remoteEnvironment = loadEnvironment({
      DATABASE_URL: 'postgresql://unit:unit-secret@db.example.com:65432/unit_test?sslmode=verify-full',
    });
    expect(createPgPoolConfiguration(remoteEnvironment).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('passes the configured adapter to the PrismaClient constructor', () => {
    const adapter = {} as PrismaPg;
    const client = {} as PrismaClient;
    const factories: PrismaConstructionFactories = {
      createAdapter: vi.fn(() => adapter),
      createClient: vi.fn(() => client),
    };

    expect(createPrismaClient(environment, factories)).toBe(client);
    expect(factories.createAdapter).toHaveBeenCalledWith(createPgPoolConfiguration(environment));
    expect(factories.createClient).toHaveBeenCalledWith(adapter);
  });

  it('reuses one client until disconnect, then creates a fresh client', async () => {
    const first: DatabaseLifecycleClient = {
      $connect: vi.fn(async () => undefined),
      $disconnect: vi.fn(async () => undefined),
    };
    const second: DatabaseLifecycleClient = {
      $connect: vi.fn(async () => undefined),
      $disconnect: vi.fn(async () => undefined),
    };
    let factoryCalls = 0;
    const manager = createDatabaseClientSingleton(() => {
      factoryCalls += 1;
      return factoryCalls === 1 ? first : second;
    });

    expect(manager.get()).toBe(first);
    expect(manager.get()).toBe(first);
    expect(factoryCalls).toBe(1);
    await expect(manager.connect()).resolves.toBe(first);
    expect(first.$connect).toHaveBeenCalledOnce();

    await manager.disconnect();
    expect(first.$disconnect).toHaveBeenCalledOnce();
    expect(manager.get()).toBe(second);
    expect(factoryCalls).toBe(2);
  });
});
