import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client.js';
import { loadEnvironment, type AppEnvironment } from '../../config/env.js';

export interface PgPoolConfiguration {
  readonly connectionString: string;
  readonly ssl: false | { readonly rejectUnauthorized: true };
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
}

export interface DatabaseLifecycleClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

export interface PrismaConstructionFactories {
  readonly createAdapter: (configuration: PgPoolConfiguration) => PrismaPg;
  readonly createClient: (adapter: PrismaPg) => PrismaClient;
}

export type DatabaseClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;

export function createPgPoolConfiguration(environment: AppEnvironment): PgPoolConfiguration {
  return {
    connectionString: environment.databaseUrl,
    // Override ambient PGSSLMODE. The URL validator rejects modes that disable
    // certificate checks; this keeps remote connections verifying by default.
    ssl: environment.databaseTls === 'verify-full' ? { rejectUnauthorized: true } : false,
    max: environment.databasePoolMax,
    connectionTimeoutMillis: environment.databaseConnectionTimeoutMs,
    idleTimeoutMillis: environment.databaseIdleTimeoutMs,
  };
}

export function createPrismaClient(
  environment: AppEnvironment,
  factories: PrismaConstructionFactories = {
    createAdapter: (configuration) => new PrismaPg(configuration),
    createClient: (adapter) => new PrismaClient({ adapter }),
  },
): PrismaClient {
  const adapter = factories.createAdapter(createPgPoolConfiguration(environment));
  return factories.createClient(adapter);
}

export function createDatabaseClientSingleton<T extends DatabaseLifecycleClient>(factory: () => T) {
  let client: T | undefined;
  const get = (): T => {
    if (!client) client = factory();
    return client;
  };
  return {
    get,
    async connect(): Promise<T> {
      const current = get();
      await current.$connect();
      return current;
    },
    async disconnect(): Promise<void> {
      if (!client) return;
      const current = client;
      client = undefined;
      await current.$disconnect();
    },
  };
}

const prismaSingleton = createDatabaseClientSingleton(() => createPrismaClient(loadEnvironment()));

export const getPrismaClient = (): PrismaClient => prismaSingleton.get();
export const connectDatabase = (): Promise<PrismaClient> => prismaSingleton.connect();
export const disconnectDatabase = (): Promise<void> => prismaSingleton.disconnect();
