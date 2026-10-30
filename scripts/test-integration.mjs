import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { loadIntegrationDatabaseTarget, loadPrismaCliEnvironment } from '../src/config/env.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratchPath = resolve(root, '.env.phase1c-scratch.local');
let scratch;
try {
  scratch = parse(readFileSync(scratchPath, 'utf8'));
} catch {
  throw new Error('Required scratch environment file ".env.phase1c-scratch.local" is missing or unreadable.');
}

loadPrismaCliEnvironment(scratch);
const testDatabaseUrl = loadIntegrationDatabaseTarget(scratch);

const safeEnvironment = { ...process.env };
for (const key of Object.keys(safeEnvironment)) {
  if (key === 'DATABASE_URL' || key === 'MIGRATION_DATABASE_URL' || key === 'SHADOW_DATABASE_URL' || key === 'TEST_DATABASE_URL' || key.startsWith('PG')) {
    delete safeEnvironment[key];
  }
}
safeEnvironment.TEST_DATABASE_URL = testDatabaseUrl;
safeEnvironment.RUN_DATABASE_INTEGRATION_TESTS = '1';
safeEnvironment.DOTENV_CONFIG_PATH = scratchPath;
safeEnvironment.NODE_ENV = 'test';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: safeEnvironment, stdio: 'inherit' });
  if (result.error) throw new Error(`Could not run ${command}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'db:test:deploy']);
run('npm', ['test', '--', 'src/infrastructure/database/schema.integration.spec.ts']);
