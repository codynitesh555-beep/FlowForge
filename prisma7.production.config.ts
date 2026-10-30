import { defineConfig } from 'prisma/config';
import { validateProductionMigrationDatabaseUrl } from './src/config/production-migration-target.js';

// This config intentionally reads only an explicitly injected migration URL.
// It does not load dotenv files or inherit DATABASE_URL as a fallback.
const migrationDatabaseUrl = validateProductionMigrationDatabaseUrl(process.env.MIGRATION_DATABASE_URL);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationDatabaseUrl },
});
