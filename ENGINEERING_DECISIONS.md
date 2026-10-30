# FlowForge Engineering Decisions

## Phase 1C Prisma 7 configuration and scratch isolation

- **Prisma config entry point:** The repository uses `prisma7.config.ts` as its
  explicit Prisma 7 config path. Every Prisma-related package script in
  `package.json` passes `--config prisma7.config.ts`.
- **Prisma CLI environment source:** The config resolves
  `.env.phase1c-scratch.local` to an absolute path relative to the config file,
  reads and parses that file explicitly, and passes only those parsed values
  to `loadPrismaCliEnvironment`. It does not merge inherited `process.env` or
  load the default `.env` file. A missing or unreadable scratch env file fails
  config loading.
- **Target guard:** `loadPrismaCliEnvironment` requires the migration target,
  validates scratch loopback/database rules, rejects protected targets, and
  checks configured migration/shadow/test targets for collisions. On
  2026-10-30 Prisma 7.10.1 validation and client generation passed against
  this configuration. Migration status was up to date and deploy found no
  pending migrations. The 7 database integration checks passed on the
  isolated scratch test database. All three migrations were already recorded
  as applied; a clean replay was not tested.
- **Protected resources:** Any future database verification must use only the
  isolated Phase 1C scratch resources after rechecking the exact target. The
  protected `flowforge-postgres` container, `flowforge` database, and
  `flowforge_pgdata` volume are out of scope and must remain untouched.
- **Graph Engine:** Frozen; no change is included in this configuration work.

## Verification boundary

Live workflow verification on 2026-10-30 found and fixed two frontend issues:
duplicate refresh rotation under React Strict Mode could revoke the session
family, and create forms read `event.currentTarget` after an await, causing
successful writes to display a generic error. Refresh calls now share one
in-flight request, and create handlers capture their form elements before
awaiting. Manual browser workflows passed against the isolated scratch-backed
API. `npm run test:offline` passed 231 tests across 30 files and `npm run build`
passed. Fresh migration replay, lock ordering, concurrency stress, production
database behavior, and automated browser-flow coverage remain unverified.

## Pre-deployment QA boundary (2026-10-30)

The comprehensive audit ran `npm run test:offline` (31 files, 235 tests
passing after a configuration regression fix), `npm run build` (API/web type
checks and Vite bundle passing), and `npm run test:integration` against the
guarded test scratch database. Before
integration, the target was required in-process to be
`127.0.0.1:5543/flowforge_test_scratch`; PostgreSQL reported database identity
`flowforge_test_scratch`, version 16.15, three applied migrations, and zero
pending migrations. The runner found no pending migrations and all 7 database
integration tests passed. Existing scratch state was not reset or destroyed.

The audit found that production CORS validation required an explicit origin
but accepted `http://` origins. `loadApiConfiguration` now rejects any
production CORS origin that does not use HTTPS; its three regression tests
passed in that audit. Only `src/api/config.ts` and the new
`src/api/config.spec.ts` changed in that source patch. Manual browser tests
were not repeated. The frozen Graph Engine remains untouched. Phase 1 later
added database-aware `/readyz`; application Docker/deployment workflow is
still absent. Therefore a successful build is not deployment readiness. Rate-limit
429 behavior, exhaustive route-by-route tenant/role denial, production SMTP and
secret-store behavior and database concurrency were not established by that
audit. Phase 2 subsequently verified fresh migration replay and schema diff.
Keep deployment blocked until
production packaging, migration rehearsals, and staging verification are
completed.

## Production deployment boundaries (2026-10-30)

Recommended minimum: static Vite frontend at `app.<domain>`, Node API at
`api.<domain>` on the same HTTPS site, and private managed PostgreSQL 16+ with
verified TLS, backups/PITR, a least-privilege runtime role, and a separate DDL
migration role. Same-site subdomains keep the current Secure, HttpOnly,
SameSite=Strict host-only refresh cookie usable. Avoid adding infrastructure
such as Kubernetes or Redis before requirements call for it; decide whether
rate limits are single-instance or shared across replicas first.

Phase 1 added a separate production Prisma config and `db:deploy:production`;
the existing scratch and test configs remain separate. Production URL
validation requires remote PostgreSQL with `sslmode=verify-full` and blocks
loopback, known protected local aliases, port 5433, protected DB naming, and
scratch DB names. `prisma validate` passed with a synthetic URL; no migration
or database connection occurred. Production Vite builds now require
`VITE_API_BASE_URL` and reject insecure/loopback values; the local development
fallback remains. `/healthz` is liveness-only and `/readyz` performs a DB probe.
`trustProxy=false` does not support accurate client-IP throttling behind a
reverse proxy, while unbounded forwarded-header trust would be unsafe. There
is no app Dockerfile, CI workflow, or release/deployment config. Phase 2 has
now applied the three migrations from zero on a new scratch database and found
no Prisma schema diff. Migration 0003 uses a blocking index drop/recreate
pattern whose production impact is unknown.

No production environment, secrets, SMTP provider, or database was inspected.
The current working directory has no Git metadata, so Git history and secret
exposure could not be assessed; inspect the actual clone before pushing.
The next approved work should verify the production migration config on staging,
decide hosting/domain and proxy/rate-limit policy, add CSP and minimal CI/release
automation, and validate backups/recovery and staging behavior.

The installed rate-limit plugin uses its default in-memory store; configured
limits are global 100/min with tighter auth/reset/invitation limits, but 429
behavior is not tested and counters are not shared across replicas. Fastify is
configured with `trustProxy=false`; production proxy trust must be explicit.
Helmet is enabled with CSP disabled, so a production CSP must be provided and
validated at the application or static-host layer. JWT key rotation has no
overlap mechanism and needs an operational procedure.

### Phase 1 verification

Final `npm run test:offline` passed 252 tests across 33 files. The production
build passed with a non-secret HTTPS API URL. The build with an empty
`VITE_API_BASE_URL` failed as required. Prisma schema validation loaded the new
production config with a synthetic remote URL and did not connect to a database.
No migration or database integration suite ran. Readiness failure behavior was
tested with a simulated failing probe; the live database was not checked.
Protected PostgreSQL port 5433 and the frozen Graph Engine remained untouched.

## Phase 2 fresh migration rehearsal (2026-10-30)

A new database, `flowforge_rehearsal_20261030_c8a51f2e_scratch`, was created
only on the verified scratch instance at `127.0.0.1:5543` (PostgreSQL 16.15,
server port 5432). With a private temporary copy of the existing scratch Prisma
config and unchanged scratch URL guard, `prisma migrate deploy` applied
migrations 0001, 0002, and 0003 from zero. `migrate status` reported up to date;
`migrate diff` found no difference; all three ledger checksums matched the
migration files. The seven PostgreSQL integration tests passed against this new
database, and post-test checks confirmed all application tables remained empty.
The new database was retained, and the temporary config/env file were deleted.

No production config, migration, schema, Graph Engine, protected PostgreSQL
port 5433, or existing scratch/test database was modified. No production
migration was run. Production-provider behavior and populated-table migration
locking remain unverified.
