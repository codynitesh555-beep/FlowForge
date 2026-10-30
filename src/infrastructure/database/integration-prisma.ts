import { PrismaClient } from '../../generated/prisma/client.js';
import { loadEnvironment } from '../../config/env.js';
import { requireDedicatedIntegrationDatabase } from './integration-safety.js';
import { createPrismaClient, type PrismaConstructionFactories } from './prisma.js';

/** Creates an unconnected test client using only the validated scratch URL. */
export function createIntegrationPrismaClient(
  source: Readonly<Record<string, string | undefined>> = process.env,
  factories?: PrismaConstructionFactories,
): PrismaClient {
  const validatedTestUrl = requireDedicatedIntegrationDatabase(source);
  const environment = loadEnvironment({
    ...source,
    DATABASE_URL: validatedTestUrl,
    TEST_DATABASE_URL: undefined,
    SHADOW_DATABASE_URL: undefined,
    DATABASE_POOL_MAX: '2',
  });
  return createPrismaClient(environment, factories);
}
