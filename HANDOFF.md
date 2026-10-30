# FlowForge Handoff

## Phase 3A Git readiness preparation (2026-10-30)

Added `README.md` with fresh-checkout setup and actual package commands, and
expanded `.gitignore` to exclude local credentials, keys/certificates,
database artifacts, temp/cache output, and workstation assistant skill
bundles while explicitly allowing the three safe environment templates.
Prisma migration SQL and hand-authored application source/configuration remain
eligible for tracking; generated `src/generated/prisma/` remains ignored.

There is no `npm run db` script. The real client-generation script is
`npm run db:generate`; it needs a populated `.env.phase1c-scratch.local` for
configuration validation, but does not connect to the database. `npm ci` does
not generate the client, and no `postinstall` lifecycle script was added.
Fresh setup instructions now make this explicit.

This was preparation only: Git remains uninitialized; no files were staged,
committed, pushed, or deleted; no database was accessed; and application
logic, Prisma schema/migrations, and the frozen Graph Engine were not changed.

## Current status

Phase 1C Prisma 7 configuration hardening and authorized scratch-database
verification are complete:

- `prisma7.config.ts` loads only `.env.phase1c-scratch.local` by an absolute
  path relative to the config file and fails closed if it cannot read the
  file.
- The guarded Prisma environment loader receives only the parsed scratch file
  values; default `.env` and inherited environment values are not merged.
- Prisma scripts in `package.json` explicitly select
  `--config prisma7.config.ts`.

`npm run db:validate` and `npm run db:generate` passed with Prisma 7.10.1.
`npm run db:status` reported the migration database up to date, and
`npm run db:deploy` reported no pending migrations. `npm run test:integration`
deployed the test target (also no pending migrations) and passed all 7 database
integration tests. `npm run build` passed for the API and web app after client
generation. All database targets are on the isolated scratch container. The
three migrations were already recorded as applied before `db:deploy`, so this
did not verify a fresh migration replay.

## Application workflow verification

On 2026-10-30, the API at `127.0.0.1:3000` and Vite at `127.0.0.1:5173`
responded with HTTP 200. A second pair on ports 3001/5174 isolated browser
cookies while testing a disposable user on the same scratch database.

Manual browser checks passed for registration, login, refresh-cookie session
restoration after reload, logout, protected endpoints, organization creation
and access, project create/list/details/update/archive, task create/list/update/
soft-delete, assignment/unassignment, dependency add/remove/history, schedule
display, and rejection of a dependency that created a cycle. A second account
had no organizations and received 403 when requesting the first account's
workspace; unauthenticated organization and project requests received 401.
Created records were still visible after reload from the scratch-backed API.

Two bugs were fixed during the workflow checks: refresh calls now coalesce so
React Strict Mode cannot rotate one refresh cookie twice concurrently, and the
organization/project/task create handlers capture their form element before
awaits so successful writes reset cleanly without a false network error. The
unsupported invitation prompt was replaced with a working project-start hint.

`npm run test:offline` passed 231 tests across 30 files, and the final
`npm run build` passed for API and web. The existing 7 database integration
tests passed in the preceding authorized database verification and were not
rerun for these frontend-only changes.

## Dependency cycle prevention evidence (2026-10-30)

The user-provided screenshots show the existing `Design Database Schema →
Implement Backend APIs` edge remains active while the UI rejects the reverse
edge. The backend path is independently guarded: the Prisma store loads the
persisted active graph inside the transaction and runs
`analyzeDependencyAddition` before SQL insertion, graph revision update, or
domain event writes. The API maps `DEPENDENCY_CYCLE` to HTTP 409.

Added a regression test that starts from an active `A → B` edge and asks the
store to add `B → A`. It verifies the persisted active edge is read, the
operation rejects with `DEPENDENCY_CYCLE`, no dependency INSERT or graph
revision UPDATE is sent, and graph revision/activity/outbox fake transaction
state remains unchanged. The existing scheduling test also verifies that the
graph analyzer detects a closing edge. Relevant offline tests passed: 4 files,
71 tests. No Graph Engine files or database state were changed; no migrations,
resets, or protected database access occurred. The test uses a transaction
fake, so the no-write guarantee is verified at the backend store boundary but
was not re-exercised against PostgreSQL in this focused pass.

## Next work

Core workflows requested in this handoff have been exercised. The main dev API
and Vite servers remain available on ports 3000 and 5173. The isolated browser
test pair on ports 3001 and 5174 has been stopped. The scratch instance remains
running. Any future database operation must use only the designated isolated
scratch resources and confirm target identity first.

Do not access or modify the protected `flowforge-postgres` container, the
`flowforge` database, or the `flowforge_pgdata` volume. Do not start Phase 1D
as part of this handoff. The frozen Graph Engine remains untouched.

## Verification limitations

The scratch container was confirmed as `flowforge-postgres-phase1c-scratch`,
bound to `127.0.0.1:5543` and mounted on
`flowforge_pgdata_phase1c_scratch`. PostgreSQL 16.15 hosted separate migration,
shadow, and test databases. The integration tests cover PERT trigger
calculation, tenant foreign keys, uniqueness and normalized identifiers, PERT
ordering, self-dependency, active dependency/assignment uniqueness, dependency
history, and transaction rollback. Phase 2 below subsequently verified a fresh
three-migration replay and schema diff on a new scratch database. Lock ordering,
concurrent mutation behavior, and production database behavior remain
unverified. Invitation acceptance, password reset, and membership
administration are API capabilities without frontend screens. Project archive
and task soft-delete have no restore UI. No automated browser-flow suite or
formal accessibility review exists. The scratch README's former `55432` port
reference was stale; the configured and observed port is `5543`.

## Pre-deployment QA update (2026-10-30)

This audit did not repeat browser checks, touch the frozen Graph Engine, or
inspect the protected PostgreSQL target. It changed only the API production
CORS validation and its regression tests. The guarded
scratch test URL resolved to `127.0.0.1:5543/flowforge_test_scratch`; a read-only
server query confirmed that exact database on PostgreSQL 16.15 and found 3
applied migrations with no pending rows. `npm run test:integration` reported no
pending migrations and passed 7/7 database tests without resetting data.

Current automated verification: after the production CORS fix below,
`npm run test:offline` passed 235 tests across 31 files; `npm run build` passed
API and web compilation plus Vite bundling.
Auth rotation/replay/logout and invalidation, project/task store invariants,
role policies, API request validation/error sanitization, graph algorithms,
PERT/CPM and selected database constraints are represented in those tests.
Password reset has service-level tests but no live SMTP/database end-to-end
check. Cross-tenant negative tests do not enumerate every individual operation.
Rate-limit 429 behavior and concurrent database mutation behavior are not
verified. The persisted cycle rejection regression uses a store transaction
fake, in addition to graph analyzer tests.

The audit found that production CORS configuration required an explicit origin
but accepted `http://` origins. `loadApiConfiguration` now requires every
production origin to use HTTPS. New tests cover HTTPS acceptance, HTTP-only
rejection, and mixed-list rejection. Offline tests and build passed after the
fix. The integration suite was not rerun because the change is limited to API
configuration and does not affect database code.

Before Phase 1, production readiness remained **blocked** by the lack of
database readiness and deployment packaging. Phase 1 adds `/readyz` as recorded
below; it has only been tested with a simulated DB failure. No production
runtime, secret manager, SMTP provider, proxy/TLS configuration, or database
was available for verification. The existing
Compose files are for local PostgreSQL; do not start the root Compose file since
it exposes protected port 5433. Exact evidence and per-area PASS/PARTIAL/FAIL
results are in `PROJECT_STATUS.md`.

Next actions before deployment:

1. Verify `/readyz` healthy and unavailable responses in staging without
   exposing database errors.
2. Decide and add the production application packaging/deployment workflow,
   including public binding/proxy, TLS, migrations, secure secret injection,
   production CORS, and health/readiness wiring.
3. Add automated API tests for rate-limit responses and a route-by-route
   cross-tenant/role matrix; add database-backed auth/reset and concurrent graph
   mutation verification on isolated scratch targets.
4. Add frontend browser automation for API failure and expired-session states;
   keep prior completed manual workflows as historical evidence.
5. Reassess these blockers, then request deployment review. Do not deploy yet.

## Production-readiness assessment (2026-10-30)

This follow-up was read-only except for documentation. No tests were repeated,
no database connection was made, and no GitHub push or deployment was attempted.
The full item-by-item classification, variable names, and expected future files
are recorded in `PROJECT_STATUS.md`.

Recommended minimum architecture: static Vite frontend at `https://app.<domain>`,
Node API at `https://api.<domain>` on the same site, and managed PostgreSQL 16+
on private networking with verified TLS, backups/PITR, and separate runtime
and migration roles. Put the API behind HTTPS termination with explicitly
trusted proxy addresses. Keep `SameSite=Strict` by using same-site subdomains.

Phase 1 now provides a separate production Prisma config and
`db:deploy:production`, while preserving the scratch scripts. The new config
requires `MIGRATION_DATABASE_URL` and refuses loopback/protected/scratch
targets. Its schema/config validation passed with a synthetic target; no
migration was run. Production is still blocked: there is no app Dockerfile,
CI/release workflow, or hosting manifest. Production Vite mode now requires
`VITE_API_BASE_URL`; the local dev fallback remains. `/readyz` now probes the
database while `/healthz` remains liveness-only. The fixed `trustProxy=false`
setting remains unsuitable for client-IP-aware throttling behind a reverse
proxy without explicit trusted-proxy configuration.
The rate-limit plugin uses its in-memory default store (global 100/min with
tighter auth limits), so replicas do not share counters; actual 429 behavior
has not been tested. Helmet CSP is explicitly disabled and no static-host CSP
is configured. A secret rotation procedure is also undefined.
At the time of the prior audit, the migration sequence appeared fresh-compatible
by inspection but had not been replayed. Phase 2 below verified that replay on
fresh scratch PostgreSQL. Migration 0003 swaps an index without
`CONCURRENTLY`, so lock impact on populated production data is unknown.

Before GitHub push, use the actual Git checkout to inspect the full diff,
staging state, remote, branch, and commit history and run secret scanning; this
workspace has no `.git` metadata, so none of those could be verified. Before
production deployment, verify the production migration config against staging
(the Phase 2 fresh replay used the scratch-only config); choose hosting/domain;
configure proxy trust and rate-limit policy;
establish DB backup/recovery and least-privilege roles; add CSP and minimal
CI/release automation; and verify staging behavior.
The migration runbook should take and verify a backup, rehearse the ordered
migrations on disposable fresh and staging databases, execute one serialized
`prisma migrate deploy` job with a dedicated DDL role, verify migration history
and readiness, then roll out a compatible API build. Recover by rolling back
application code and using forward migrations for schema fixes; never run
`prisma migrate dev` in production. Rehearse migration 0003's index swap lock
impact on representative data.

Safest next action: approve production-like staging verification and deployment
configuration work. The fresh history replay is complete. Do not use port 5433.

### Phase 1 implementation evidence (2026-10-30)

`npm run test:offline` passed 252 tests across 33 files. The production build
passed with `VITE_API_BASE_URL` set to a non-secret HTTPS example.
`npm run build:web` with the URL empty failed as intended.
`prisma validate --config prisma7.production.config.ts` passed with a
synthetic remote URL and did not connect to a database. Focused API/config
tests cover successful/unavailable readiness, safe 503 responses, production
migration URL validation, and the frontend URL guard. No migration or database
integration test ran in Phase 1.

`/readyz` is wired to Prisma `SELECT 1`; its failure behavior was simulated in
API tests. No live database readiness check was made. Neither the protected
PostgreSQL target/port 5433 nor the frozen Graph Engine was touched. Deployment
automation remains out of scope and requires separate approval.

### Phase 2 fresh migration rehearsal (2026-10-30)

Created and retained `flowforge_rehearsal_20261030_c8a51f2e_scratch` on the
verified scratch instance only: host binding `127.0.0.1:5543`, PostgreSQL 16.15
(server-side port 5432, address `172.19.0.2/32`), container
`flowforge-postgres-phase1c-scratch`, dedicated volume
`flowforge_pgdata_phase1c_scratch`. Before migration it was empty (zero public
tables). Existing migration, shadow, and test databases were not altered.

A private temporary copy of the existing scratch `prisma7.config.ts` and its
`loadPrismaCliEnvironment` guard targeted only this new `_scratch` database;
the production config was not used. `prisma migrate deploy` applied all three
migrations from zero. `prisma migrate status` reported up to date, schema diff
reported no difference, and all three database ledger checksums matched the
repository SQL. The integration spec passed **7/7 tests** against this new
database. Afterward, all 12 application tables had zero rows, confirming test
fixture rollback. The temporary config and its credential-bearing env file
were deleted. No migration or schema files were changed.

Exact commands and full evidence are recorded in the Phase 2 section of
`PROJECT_STATUS.md`. This establishes fresh replay on the isolated scratch
PostgreSQL version, not production provider permissions or lock behavior on
populated data. Port 5433, the protected container/volume, and the frozen Graph
Engine remain untouched.
