# Phase 1A.2 — Database URL Safety Policy

- Scratch integration, migration, and shadow targets accept only literal
  `127.0.0.1` or `[::1]`; DNS names and alternate loopback spellings are not
  accepted.
- Port `5433` and database name `flowforge` remain protected.
- Two configured targets are treated as potentially identical when their
  numeric port and database name match, regardless of hostname. This
  intentionally rejects some truly separate databases to avoid treating
  hostname-string differences as proof of server isolation.
- Application, test, migration, and shadow targets are validated separately.
  `TEST_DATABASE_URL` and `MIGRATION_DATABASE_URL` have no fallback to
  `DATABASE_URL` in their respective authorization paths.
- URL query parameters that can redirect connection routing are rejected.
  Only `sslmode=verify-full` is allowed; modes with ambiguous or disabled
  certificate verification and unknown modes are rejected. Remote application
  connections explicitly require certificate verification, and ambient
  `PGSSLMODE` is overridden by the PrismaPg pool configuration.
- `sslrootcert`, when supplied for an application URL, is read by the installed
  `pg-connection-string` parser and passed as the TLS CA certificate. It
  replaces the default CA set used by Node TLS. `sslmode=verify-full` still
  verifies both the chain against that CA and the server hostname. Without
  `sslrootcert`, Node's configured/default trust store is used.
- CA, client-certificate, and client-key paths are read on the application
  host. An unreadable or malformed file causes pool configuration or TLS
  setup to fail; it must not be handled by retrying with verification disabled.
  An invalid/untrusted server certificate or hostname mismatch fails the TLS
  handshake. There is no insecure fallback in the current PrismaPg pool
  configuration.
- URL validation checks the canonical hostname and database path that are
  passed to PrismaPg; it never trims a trailing dot into an allowed target.
