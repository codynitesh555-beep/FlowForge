import { isIP } from 'node:net';

const SAFE_QUERY_KEYS = new Set([
  'application_name', 'connect_timeout', 'schema', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword',
]);
const ROUTING_QUERY_KEYS = new Set(['host', 'hostaddr', 'port', 'database', 'db', 'user', 'password']);

function fail(reason: string): never {
  throw new Error(`MIGRATION_DATABASE_URL ${reason}`);
}

function hasExplicitPort(value: string): boolean {
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0] ?? '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  return hostPort.startsWith('[') ? /\]:(\d+)$/.test(hostPort) : /:(\d+)$/.test(hostPort);
}

/** Validate the production migration target without loading runtime or scratch configuration. */
export function validateProductionMigrationDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === '' || value !== value.trim() || value.includes('#')) {
    return fail('must be set to a canonical PostgreSQL URL.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('must be a valid PostgreSQL URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return fail('must use PostgreSQL.');
  if (!url.username || !url.password) return fail('must include explicit credentials.');
  if (!hasExplicitPort(value) || !url.port || !Number.isInteger(Number(url.port))) return fail('must include an explicit valid port.');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4Parts = hostname.split('.').map(Number);
  const isIpv4Loopback = isIP(hostname) === 4 && ipv4Parts[0] === 127;
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
  const isProtectedDockerAlias = ['flowforge-postgres', 'postgres', 'host.docker.internal'].includes(hostname);
  if (!hostname || hostname.endsWith('.') || isLocalhost || isIpv4Loopback || hostname === '::1' || isProtectedDockerAlias) {
    return fail('must target a production database host, not loopback.');
  }

  const port = Number(url.port);
  if (port === 5433) return fail('must not use the protected PostgreSQL port.');

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return fail('must contain a valid database name.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(databaseName) || url.pathname !== `/${databaseName}`) {
    return fail('must contain one canonical database name.');
  }
  if (databaseName.toLowerCase() === 'flowforge' || databaseName.toLowerCase().endsWith('_scratch')) {
    return fail('must not target a protected or scratch database.');
  }

  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized) || ROUTING_QUERY_KEYS.has(normalized) || !SAFE_QUERY_KEYS.has(normalized)) {
      return fail('contains an unsupported or routing query parameter.');
    }
    seen.add(normalized);
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    return fail('must require sslmode=verify-full.');
  }

  return value;
}
