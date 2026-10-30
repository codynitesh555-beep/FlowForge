import { loadIntegrationDatabaseTarget } from '../../config/env.js';

/** Explicit opt-in guard. This module does not connect, create, or drop a database. */
export function requireDedicatedIntegrationDatabase(source: Readonly<Record<string, string | undefined>> = process.env): string {
  return loadIntegrationDatabaseTarget(source);
}
