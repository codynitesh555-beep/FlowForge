import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { loadIntegrationDatabaseTarget, loadPrismaCliEnvironment } from './src/config/env.js';

const scratchPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env.phase1c-scratch.local');
let environment: ReturnType<typeof parse>;
try {
  environment = parse(readFileSync(scratchPath, 'utf8'));
} catch {
  throw new Error('Required scratch environment file ".env.phase1c-scratch.local" is missing or unreadable.');
}

// Validate separation from the migration and shadow databases before the test
// database is supplied to Prisma CLI. No inherited environment is merged.
loadPrismaCliEnvironment(environment);
const testDatabaseUrl = loadIntegrationDatabaseTarget(environment);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: testDatabaseUrl },
});
