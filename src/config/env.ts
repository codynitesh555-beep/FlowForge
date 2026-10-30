import { isIP } from 'node:net';

export interface AppEnvironment {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrl: string;
  readonly databaseTls: 'disabled' | 'verify-full';
  readonly shadowDatabaseUrl?: string;
  readonly testDatabaseUrl?: string;
  readonly databasePoolMax: number;
  readonly databaseConnectionTimeoutMs: number;
  readonly databaseIdleTimeoutMs: number;
}

export interface PrismaCliEnvironment {
  readonly migrationDatabaseUrl: string;
  readonly shadowDatabaseUrl?: string;
}

export interface ParsedDatabaseTarget {
  readonly url: URL;
  readonly hostname: string;
  readonly port: number;
  readonly databaseName: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const SAFE_QUERY_KEYS = new Set([
  'application_name', 'connect_timeout', 'schema', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword',
]);
const ROUTING_QUERY_KEYS = new Set(['host', 'hostaddr', 'port', 'database', 'db', 'user', 'password']);
const SCRATCH_LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);
// pg-connection-string compatibility modes can vary by parser configuration
// and version. Require unambiguous certificate and hostname verification.
const SECURE_SSL_MODES = new Set(['verify-full']);

function fail(name: string, reason: string): never {
  // Do not include the supplied URL: it may contain credentials.
  throw new Error(`${name} ${reason}`);
}

function rawExplicitPort(value: string): string | undefined {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd < 0) return undefined;
  const authorityStart = schemeEnd + 3;
  const authorityEnd = value.slice(authorityStart).search(/[/?#]/);
  const authority = authorityEnd < 0
    ? value.slice(authorityStart)
    : value.slice(authorityStart, authorityStart + authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) return /\]:(\d+)$/.exec(hostPort)?.[1];
  return /:(\d+)$/.exec(hostPort)?.[1];
}

function rawAuthorityHost(value: string): string | undefined {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd < 0) return undefined;
  const authorityStart = schemeEnd + 3;
  const authorityEnd = value.slice(authorityStart).search(/[/?#]/);
  const authority = authorityEnd < 0
    ? value.slice(authorityStart)
    : value.slice(authorityStart, authorityStart + authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const closingBracket = hostPort.indexOf(']');
    return closingBracket < 0 ? undefined : hostPort.slice(0, closingBracket + 1);
  }
  const portSeparator = hostPort.lastIndexOf(':');
  return portSeparator < 0 ? hostPort : hostPort.slice(0, portSeparator);
}

/**
 * Accept a deliberately narrow PostgreSQL URI subset. In particular, routing
 * overrides supported by pg-connection-string are rejected before the string
 * reaches PrismaPg/node-postgres.
 */
export function parseDatabaseTarget(
  name: string,
  value: string | undefined,
  options: { readonly allowSafeQuery?: boolean } = {},
): ParsedDatabaseTarget {
  if (value === undefined || value.trim() === '') fail(name, 'is required.');
  if (value !== value.trim() || value.includes('#')) fail(name, 'must be a canonical PostgreSQL URL.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(name, 'must be a valid PostgreSQL URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    fail(name, 'must use the postgres or postgresql scheme.');
  }
  if (!url.username || !url.password) fail(name, 'must include explicit username and password credentials.');

  const explicitPort = rawExplicitPort(value);
  if (!explicitPort) fail(name, 'must include an explicit port.');
  const port = Number(explicitPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== explicitPort) {
    fail(name, 'must include a canonical port from 1 to 65535.');
  }
  if (url.port && Number(url.port) !== port) fail(name, 'contains conflicting port values.');
  const urlHostname = url.hostname.toLowerCase();
  if (urlHostname.endsWith('.')) fail(name, 'must not use a trailing-dot hostname.');
  const hostname = urlHostname.startsWith('[') && urlHostname.endsWith(']')
    ? urlHostname.slice(1, -1)
    : urlHostname;
  const validHost = isIP(hostname) !== 0 || hostname.split('.').every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
  if (!hostname || !validHost || hostname.includes(',')) fail(name, 'must contain exactly one valid hostname or IP address.');
  const canonicalAuthorityHost = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  if (rawAuthorityHost(value) !== canonicalAuthorityHost) {
    fail(name, 'must use a canonical hostname or IP representation.');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return fail(name, 'must contain a valid database name.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(databaseName)) {
    fail(name, 'must contain one non-empty canonical database name.');
  }

  if (url.search) {
    if (!options.allowSafeQuery) fail(name, 'must not contain query parameters.');
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.toLowerCase();
      if (seen.has(normalizedKey)) fail(name, 'contains duplicate or conflicting query parameters.');
      seen.add(normalizedKey);
      if (ROUTING_QUERY_KEYS.has(normalizedKey)) fail(name, 'contains a prohibited connection-routing override.');
      if (!SAFE_QUERY_KEYS.has(normalizedKey)) fail(name, 'contains an unsupported query parameter.');
      if (normalizedKey === 'sslmode' && !SECURE_SSL_MODES.has(url.searchParams.get(key) ?? '')) {
        fail(name, 'contains an unsupported or certificate-verification-disabling SSL mode.');
      }
    }
  } else if (value.includes('?')) {
    // WHATWG URL normalizes a trailing question mark to an empty search string.
    fail(name, 'must not contain an empty query string.');
  }

  if (url.pathname !== `/${databaseName}`) fail(name, 'must use a canonical database path.');
  return Object.freeze({ url, hostname, port, databaseName });
}

function isProtectedTarget(target: ParsedDatabaseTarget): boolean {
  return target.port === 5433 || target.databaseName.toLowerCase() === 'flowforge';
}

function samePortAndDatabase(a: ParsedDatabaseTarget, b: ParsedDatabaseTarget): boolean {
  // Hostnames can alias or change resolution. Treat equal port/database pairs
  // as potentially shared, even when their host strings differ.
  return a.port === b.port && a.databaseName.toLowerCase() === b.databaseName.toLowerCase();
}

function validateScratchTarget(name: string, value: string | undefined): ParsedDatabaseTarget {
  const target = parseDatabaseTarget(name, value);
  if (!SCRATCH_LOOPBACK_ADDRESSES.has(target.hostname)) {
    fail(name, 'must target the canonical literal loopback address 127.0.0.1 or ::1.');
  }
  if (isProtectedTarget(target)) fail(name, 'must not target the protected FlowForge database or port.');
  if (!target.databaseName.toLowerCase().endsWith('_scratch')) {
    fail(name, 'must use a dedicated database name ending in _scratch.');
  }
  return target;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function loadEnvironment(source: EnvironmentSource = process.env): AppEnvironment {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const app = parseDatabaseTarget('DATABASE_URL', source.DATABASE_URL, { allowSafeQuery: true });
  const shadow = source.SHADOW_DATABASE_URL
    ? parseDatabaseTarget('SHADOW_DATABASE_URL', source.SHADOW_DATABASE_URL)
    : undefined;
  const test = source.TEST_DATABASE_URL
    ? validateScratchTarget('TEST_DATABASE_URL', source.TEST_DATABASE_URL)
    : undefined;

  if (shadow && (isProtectedTarget(shadow) || samePortAndDatabase(shadow, app))) {
    throw new Error('SHADOW_DATABASE_URL must identify a separate, non-protected database.');
  }
  if (test && (samePortAndDatabase(test, app) || (shadow && samePortAndDatabase(test, shadow)))) {
    throw new Error('TEST_DATABASE_URL must identify a separate database.');
  }

  return Object.freeze({
    nodeEnv,
    databaseUrl: app.url.toString(),
    databaseTls: SCRATCH_LOOPBACK_ADDRESSES.has(app.hostname) ? 'disabled' : 'verify-full',
    ...(shadow ? { shadowDatabaseUrl: shadow.url.toString() } : {}),
    ...(test ? { testDatabaseUrl: test.url.toString() } : {}),
    databasePoolMax: positiveInteger('DATABASE_POOL_MAX', source.DATABASE_POOL_MAX, 10),
    databaseConnectionTimeoutMs: positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', source.DATABASE_CONNECTION_TIMEOUT_MS, 5000),
    databaseIdleTimeoutMs: positiveInteger('DATABASE_IDLE_TIMEOUT_MS', source.DATABASE_IDLE_TIMEOUT_MS, 10000),
  });
}

export function loadIntegrationDatabaseTarget(source: EnvironmentSource = process.env): string {
  const test = validateScratchTarget('TEST_DATABASE_URL', source.TEST_DATABASE_URL);
  for (const [name, value] of [
    ['DATABASE_URL', source.DATABASE_URL],
    ['MIGRATION_DATABASE_URL', source.MIGRATION_DATABASE_URL],
    ['SHADOW_DATABASE_URL', source.SHADOW_DATABASE_URL],
  ] as const) {
    if (!value) continue;
    const other = parseDatabaseTarget(name, value, { allowSafeQuery: true });
    if (samePortAndDatabase(test, other)) {
      throw new Error(`TEST_DATABASE_URL must identify a database separate from ${name}.`);
    }
  }
  return test.url.toString();
}

/** Prisma CLI gets a separate explicit, non-protected target, never DATABASE_URL. */
export function loadPrismaCliEnvironment(source: EnvironmentSource = process.env): PrismaCliEnvironment {
  const migration = validateScratchTarget('MIGRATION_DATABASE_URL', source.MIGRATION_DATABASE_URL);
  const app = source.DATABASE_URL
    ? parseDatabaseTarget('DATABASE_URL', source.DATABASE_URL, { allowSafeQuery: true })
    : undefined;

  const shadow = source.SHADOW_DATABASE_URL
    ? validateScratchTarget('SHADOW_DATABASE_URL', source.SHADOW_DATABASE_URL)
    : undefined;
  const test = source.TEST_DATABASE_URL
    ? validateScratchTarget('TEST_DATABASE_URL', source.TEST_DATABASE_URL)
    : undefined;
  if (shadow && (isProtectedTarget(shadow) || samePortAndDatabase(shadow, migration))) {
    throw new Error('SHADOW_DATABASE_URL must identify a separate, non-protected database.');
  }
  if (app && (samePortAndDatabase(app, migration) || (shadow && samePortAndDatabase(app, shadow)))) {
    throw new Error('Prisma CLI databases must be separate from DATABASE_URL.');
  }
  if (test && (
    samePortAndDatabase(test, migration) ||
    (shadow && samePortAndDatabase(test, shadow)) ||
    (app && samePortAndDatabase(test, app))
  )) {
    throw new Error('TEST_DATABASE_URL must be separate from all Prisma CLI databases.');
  }

  return Object.freeze({
    migrationDatabaseUrl: migration.url.toString(),
    ...(shadow ? { shadowDatabaseUrl: shadow.url.toString() } : {}),
  });
}
