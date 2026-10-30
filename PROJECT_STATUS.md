# FlowForge Project Status

Assessment date: 2026-10-30

## Phase 3A: Git readiness preparation (2026-10-30)

- Added a developer README with the verified architecture, scripts, isolated
  scratch setup, frontend API URL requirement, security guidance, and current
  limitations. The generic Compose file targets port 5433 and is explicitly
  distinguished from the isolated scratch setup.
- Expanded `.gitignore` for dotenv-by-default handling with three example
  template exceptions, private keys/certificates, local database artifacts,
  temporary/editor files, caches, and workstation-provided assistant bundles.
  Prisma migration SQL remains trackable; generated Prisma Client remains
  excluded.
- There is no `npm run db` script. `npm run db:generate` is the actual client
  generation command. `npm ci` followed by `npm run db` is therefore not a
  valid fresh-checkout workflow. Client generation requires a populated
  `.env.phase1c-scratch.local` because the Prisma config loads and validates
  that file; generation itself does not require database access. No lifecycle
  script was added.
- No Git initialization, staging, database access, or application/schema/
  migration/Graph Engine changes were made in this phase.

## Current implementation

- **Phase 1A database foundation:** PostgreSQL 16 / Prisma 7.10.1 baseline has
  the original nine tenant-safe models and a manually authored additive Phase
  1B migration for sessions, password resets, and invitations. All three
  migrations are applied on the isolated migration and test scratch databases;
  database integration checks passed as described below. Fresh migration
  replay is still unverified.
- **Database safety:** application, migration, shadow, and test target guards,
  explicit TLS policy, PrismaPg construction, and transaction helpers are in
  place. Scratch target routing, schema constraints/triggers, rollback, and
  migration state were verified against the isolated PostgreSQL instance.
- **Graph Engine:** deterministic graph validation, cycle detection,
  topological ordering, CPM, critical path and PERT remain frozen and are
  consumed through the public scheduling adapter.
- **Identity and access:** Argon2id registration/login, short-lived signed
  access tokens, hash-only rotating refresh tokens, replay-family revocation,
  logout, password reset, invitations, organization creation, scoped
  membership changes, explicit OWNER/ADMIN/MEMBER permissions, and
  last-active-owner protection are implemented. Prisma adapters use explicit
  transaction boundaries and the documented organization → membership UUID →
  assignment ID lock order.
- **HTTP API:** Fastify v5 provides Zod-validated versioned auth, organization,
  membership, invitation, and password-reset routes; OpenAPI docs; origin/CORS
  checks; rate limits; safe error envelopes; health endpoint; request-log
  redaction; and graceful shutdown.
- **Frontend:** React + TypeScript + Vite provides account registration/login,
  refresh-cookie session restoration, organization listing/creation, and
  logout. Access tokens are held in memory; the refresh token is in an
  HttpOnly SameSite cookie. The initial project/task surface also supports
  project create/read/update/archive, task create/edit/soft-delete, dependency
  controls, assignment/unassignment, and schedule/critical-path display. It does
  not yet provide invitation acceptance, password reset, or membership
  administration screens. Manual browser workflows passed on 2026-10-30, but
  an automated browser-flow suite and formal accessibility review are not
  present.
- **Project/task implementation:** tenant-scoped application services and
  Prisma transaction adapters cover project create/list/read/update/archive;
  task create/read/update/soft-delete; dependency history and cycle-safe
  mutation; active-member assignment/unassignment; and JSON-safe schedule
  analysis. Mutations write actor-snapshotted ActivityLog and OutboxEvent rows
  in one transaction.
- **Phase 1C audit remediation:** post-write invariant failures now reject the
  transaction; project archive releases active assignments with history events;
  graph diagnostics are logged with safe subcodes while API responses remain
  non-sensitive; duplicate persistence constraints map to stable domain
  conflicts. Offline transaction-boundary tests now exercise the Prisma store
  with fakes. The consolidated source-level audit is recorded as PASS; this
  does not establish runtime database correctness.
- **Phase 1C schema delta:** Project.archivedAt and TaskDependency.removedAt
  are represented in Prisma schema and an additive migration. A partial unique
  index allows only one active edge while retaining removed edges. No Task
  fields were added. Prisma Client was generated successfully; database
  integration checks verified active-edge uniqueness and dependency history.
  These new fields continue to use parameterized SQL where required.
- **Prisma 7 config hardening:** `prisma7.config.ts` explicitly reads and
  parses `.env.phase1c-scratch.local` using a path resolved from the config
  file location. Missing/unreadable file errors stop config loading, and only
  parsed scratch-file values are passed to the existing target guard; default
  `.env` and inherited `process.env` are not merged. All Prisma scripts in
  `package.json` explicitly pass `--config prisma7.config.ts`.
- **Database verification status:** Scratch verification completed on
  2026-10-30. Prisma validation and client generation passed; migration status
  was up to date and deploy found no pending migrations; all 7 database
  integration tests passed. The migrations were already present in migration
  history before deploy, so fresh replay is unverified. Lock ordering,
  concurrency, and production database behavior also remain unverified.
- **Frontend project surface:** organization project navigation, project
  creation/archive, task create/edit/soft-delete, dependency controls,
  assignment management and schedule metrics/critical paths are implemented.
  Task restore is not approved or exposed. Resource planning, outbox delivery,
  and AI features remain unimplemented.

## Previously reported verification

- Earlier `npm run test:offline`: 29 files and 216 tests. The database
  integration spec was excluded by the script; see the later current result
  below.
- `npm run build`: passed (`tsc`).
- `npm run build:web`: passed (web TypeScript check and Vite production build).
- These results are historical reports from the earlier Phase 1C remediation;
  they are not verification of the later Prisma config hardening.

## Phase 1C scratch database verification (2026-10-30)

- Confirmed container `flowforge-postgres-phase1c-scratch`, host binding
  `127.0.0.1:5543`, and dedicated volume `flowforge_pgdata_phase1c_scratch`.
- Confirmed separate `flowforge_migration_scratch`,
  `flowforge_shadow_scratch`, and `flowforge_test_scratch` databases on
  PostgreSQL 16.15.
- `npm run db:validate` and `npm run db:generate` passed with Prisma 7.10.1.
- `npm run build` passed for the API and web app after client generation.
- `npm run db:status` reported up to date; `npm run db:deploy` found no pending
  migrations. Migration history contained all three migrations before deploy.
- `npm run test:integration` passed all 7 database integration tests, covering
  database triggers, tenant and uniqueness constraints, estimate checks,
  dependency/assignment constraints and history, and transaction rollback.
- Fresh migration replay, lock ordering, concurrency, and production database
  behavior were not tested. The scratch README's former `55432` port reference
  was corrected to match the configured and observed `5543` port.

## Application workflow verification (2026-10-30)

- API `127.0.0.1:3000` and Vite `127.0.0.1:5173` both responded HTTP 200.
  An isolated second API/Vite pair on 3001/5174 was used for the disposable
  browser account so the existing browser session was not revoked.
- Registered a disposable user in the UI, logged in, reloaded to verify refresh
  cookie session restoration, logged out, reloaded to verify logout persisted,
  and logged back in. The 12-character minimum security policy was preserved.
- Through the UI, created and opened organizations; created, listed, updated,
  and archived a project; created and listed tasks; updated and soft-deleted a
  task; assigned and unassigned a member; added and removed dependencies;
  verified dependency history and schedule updates; and confirmed a cycle
  attempt was rejected with the expected user-facing message.
- After reload, the scratch-backed API still returned the created organization,
  updated project, renamed task, remaining task, assignment/dependency history.
  A second disposable user had zero organizations and received 403 on the
  first user's workspace. Unauthenticated organization/project requests
  returned 401.
- Fixed a React Strict Mode refresh race by coalescing concurrent refresh calls.
  Fixed organization/project/task create forms so they capture form elements
  before asynchronous requests. Replaced the misleading invitation prompt in
  the organization screen with a project-start hint.
- Final `npm run test:offline`: 30 files and 231 tests passed. Final
  `npm run build`: API typecheck, web typecheck, and Vite production build
  passed. The database integration suite was not repeated because no database
  code or schema changed.

## Dependency cycle prevention regression (2026-10-30)

- The POST dependency route delegates to `ProjectTaskService.addDependency`;
  the Prisma store loads the persisted active graph and calls
  `analyzeDependencyAddition` before inserting the edge, incrementing graph
  revision, or writing activity/outbox events. A detected graph cycle becomes
  `DEPENDENCY_CYCLE`, which the API maps to HTTP 409.
- Existing `scheduling.spec.ts` already checks that the graph analyzer rejects
  an edge that closes a cycle. Added a store regression test for existing
  `A → B` plus attempted `B → A`; it asserts the active edge was read, no
  dependency INSERT or graph-revision UPDATE was issued, and no graph revision,
  activity, or outbox changes were committed.
- The user-provided browser screenshots show the UI error and the original
  dependency still active. The backend regression test passed without a live
  database. No Graph Engine code, database state, migrations, resets, or
  protected PostgreSQL resources were changed or accessed.
- Relevant offline tests passed: 4 files, 71 tests (`prisma-project-task-store`,
  `scheduling`, `project-task.service`, and `api/app`). The full offline suite
  was not rerun for this focused change.

## Phase 1C.3-B verification

- API error-boundary tests capture the Fastify logger stream in test mode and
  inspect emitted records as well as response bodies. The test-only stream seam
  is rejected outside `NODE_ENV=test`; production logger configuration remains
  enabled with the existing redaction paths.
- Unknown thrown errors now receive a generic 500 envelope rather than having
  arbitrary `statusCode` values trusted. Graph and persistence log diagnostics
  are allowlisted.
- At the time of the Phase 1C.3-B report, `npm run test:offline` passed with 29
  files and 216 tests, and the build commands passed. Later workflow results are
  recorded above.

## Readiness

Core account, organization, project, task, assignment, dependency, scheduling,
and tenant-isolation workflows have passed manual browser/API checks against
the isolated scratch database. Prisma validation/client generation, the 7
database integration tests, 231 offline tests, and the production build passed.
Actual remaining gaps are the unimplemented invitation acceptance, password
reset, and membership-management screens; lack of automated browser tests and
accessibility review; no archive/task restore UI; and unverified fresh
migration replay, locking/concurrency stress, and production database behavior.

## Pre-deployment backend and security QA (2026-10-30)

### Verification performed

- `npm run test:offline`: **PASS**, 31 files and 235 tests after the security
  regression fix described below.
- `npm run build`: **PASS**, API TypeScript compile, web TypeScript compile,
  and Vite production bundle.
- Before connecting to a database, the validated integration target was
  checked in-process to be `127.0.0.1:5543/flowforge_test_scratch`; the server
  reported PostgreSQL 16.15 and `current_database()` matched that name. Only
  migration metadata was read before tests: three applied migrations and zero
  pending migrations.
- `npm run test:integration`: **PASS**, the runner confirmed no pending
  migrations and all 7 database integration tests passed. No reset or destructive
  database action was run. Docker socket inspection was unavailable in this
  environment; database identity was established from the repository-validated
  target plus the server-side database identity query.
- No browser actions were repeated. Existing manual browser evidence remains
  the evidence documented above.

### Audit results

| Area | Result | Evidence and remaining scope |
| --- | --- | --- |
| Registration, login, refresh rotation/replay, logout/session invalidation | **PASS** | Authentication, refresh-session, and API tests cover password normalization/hashing, generic credential failures, rotation, replay family revocation, logout, cookie policy, and protected requests. No separate full auth-to-PostgreSQL end-to-end suite. |
| Password reset | **PARTIAL** | Service tests cover generic unknown-account response, hashed reset token, delivery failure, token consumption, password change, and session revocation. SMTP delivery and reset persistence/API flow were not exercised against a real provider/database. No reset UI. |
| Organization authorization and roles | **PASS / PARTIAL** | Role-policy and membership lifecycle tests pass; API tests verify authenticated tenant scope and reject missing membership/body tenant override. Exhaustive role-by-role route matrix was not run. |
| Multi-tenant project/task/assignment/dependency operations | **PARTIAL** | Tenant predicates and composite tenant foreign keys are present; API cross-organization project rejection, store assignment target rejection, and database project/organization FK checks are covered. There is no automated cross-tenant negative test for every operation/route. |
| Project/task CRUD, archive, version conflicts, soft deletion, assignments | **PASS (domain/store)** | Offline service/store/API tests cover these paths, rollback boundaries, conditional task versions, assignment lifecycle, archive release, and soft-delete retention. Only selected schema invariants are exercised in PostgreSQL integration tests. |
| Graph Engine and scheduling | **PASS (functional coverage)** | Frozen graph algorithms, invalid nodes/edges, cycle prevention, deleted-node filtering, PERT, CPM, slack, critical path, and schedule delegation tests passed. Persisted-cycle regression asserts the store rejects before insert/revision/event writes using a transaction fake. PostgreSQL concurrency/race behavior was not tested. No Graph Engine changes made. |
| Database constraints, indexes, foreign keys, trigger, transaction behavior | **PASS (tested subset)** | Schema and migrations statically contain tenant composite FKs, indexes, CHECK constraints, active-edge/assignment uniqueness and PERT trigger. Seven PostgreSQL integration tests passed, including tenant FK, ordering, uniqueness, trigger derivation, history retention, and rollback. Phase 2 applied all three migrations from zero on a new scratch database; status is current and schema diff is empty. Concurrent transaction stress remains **NOT VERIFIED**. |
| API validation, malformed requests, safe errors, CORS | **PASS (tested subset)** | API tests cover malformed JSON, Zod validation, no-store responses, protected routes, origin-gated refresh, sanitized errors, and HTTPS-only production origin policy. Production traffic was not exercised. |
| Rate limiting | **NOT VERIFIED** | Global and sensitive-route limits are configured in Fastify; no project test asserts 429 behavior or production/multi-instance limiter semantics. |
| Frontend/backend failure and session-expiry UX | **PARTIAL** | Existing manual workflow evidence is retained; frontend API retry/session refresh and error/loading handling were inspected, and build passed. No automated browser suite, no repeated browser test, and no forced-expiry/error UI run in this audit. |
| Logging/error sanitization | **PASS (automated)** | API tests verify credentials and arbitrary error details are not returned/logged; allowlisted diagnostics only. |
| Environment/database secret configuration | **PASS (code/config checks); runtime NOT VERIFIED** | Database URL validation rejects protected/shared scratch targets and remote TLS is `verify-full`; API configuration requires a strong non-placeholder token secret, production CORS and secure SMTP/public HTTPS settings. Local production env file is ignored and startup permits injected secrets. No real production secret store or production environment was inspected. |
| Health/readiness | **PASS (mocked boundary); NOT VERIFIED (live database)** | `/healthz` is liveness-only. `/readyz` performs a `SELECT 1` probe and returns 503 on failure; the route was tested with a simulated failing probe, but not against an unavailable live database. |
| Deployment packaging/orchestration | **FAIL (not prepared)** | No application Dockerfile or deployment workflow/configuration is present. Compose files describe local PostgreSQL only; production hosting, proxy/TLS termination, binding, migrations, and secret injection have not been provisioned or verified. |

The audit found and fixed a production CORS policy gap: configuration required
an explicit production origin but allowed canonical `http://` origins. API
configuration now rejects HTTP and mixed HTTP/HTTPS origin lists in production;
three regression tests cover accepted HTTPS, rejected HTTP, and rejected mixed
origins. `npm run test:offline` then passed 235 tests across 31 files and
`npm run build` passed again. The 7 database integration tests had passed
before this API-configuration-only change and were not repeated because it did
not alter persistence or database behavior.

The API still omits invitation, password-reset, and membership-management
screens; restore flows, automated browser tests, production deployment setup,
live staging readiness verification, and concurrency stress remain open. Do
not deploy until deployment configuration and remaining production-specific
checks are addressed.

## Production-readiness assessment (2026-10-30)

This is a read-only assessment. No deployment-related code was changed, no
database was contacted, no GitHub action was taken, and no test suite was
repeated. The statuses below distinguish code/configuration evidence from
unprovisioned production infrastructure.

| Item | Status | Assessment |
| --- | --- | --- |
| Static frontend hosting | **NOT IMPLEMENTED** | Vite produces `dist/web`; no static host, domain, CDN, or deploy configuration is selected. |
| Node API hosting | **NOT IMPLEMENTED** | `dist/api/main.js` and `npm run start:api` exist; there is no application container or deployment service configuration. Container hosting must set `API_HOST=0.0.0.0`; current default/example is loopback. |
| Managed production PostgreSQL | **NOT VERIFIED** | Runtime code requires a valid PostgreSQL URL and enforces verified TLS for non-loopback. No production cluster, private networking, backup policy, or recovery test exists in the repository/evidence. |
| Runtime environment validation | **PASS (code only)** | Set `NODE_ENV=production` to enable production validation. In that mode the app requires database URL, token secret of at least 32 bytes (randomness is operator-managed), explicit HTTPS CORS origin, SMTPS URL, sender, and HTTPS public app URL; token lifetime is bounded. Optional pool settings are validated. Runtime values were not inspected. |
| Frontend API target | **PASS (guard implemented/tested); NOT VERIFIED (hosting)** | Production Vite mode requires `VITE_API_BASE_URL`, requires HTTPS, and rejects loopback hosts. Local development retains the localhost fallback. No production host has been configured. |
| Production CORS | **PASS (policy tests)** | Exact origins, credentials, and HTTPS-only production origins are enforced. Use the actual HTTPS frontend origin with no path. Production hosting behavior is not verified. |
| API liveness/readiness | **PASS (mocked boundary); NOT VERIFIED (live database)** | `/healthz` remains liveness-only. `/readyz` performs an injected `SELECT 1` Prisma query and returns generic 503 `{status:"not_ready"}` on failure. Both status paths have API tests; no database was contacted in this phase. |
| Session cookies and JWT | **PASS (code/tests), NOT VERIFIED (live HTTPS)** | Production refresh cookie is HttpOnly, Secure, SameSite=Strict, host-only, and scoped to `/v1/auth`. Access JWTs are short lived (default 600 seconds, 60–900 allowed), HMAC-SHA-256 signed, issuer/audience checked, and tied to active server-side sessions. Tokens are not stored in browser local storage by the inspected client. Live HTTPS cookie behavior was not tested in this audit. |
| Refresh-token storage/rotation | **PASS (code/tests)** | Opaque 32-byte refresh tokens are stored as SHA-256 hashes, rotated on refresh, replay revokes the family, and family lifetime is capped at 90 days. |
| Rate limiting | **NOT VERIFIED** | Configured limits are global 100/min, register/login 5/min, refresh 20/min, reset request 3/min, reset completion 5/min, and invitation actions 10/min. No 429 test or distributed limiter is present; the plugin is registered without a shared-store configuration. With multiple replicas counters will not be coordinated. |
| Proxy/client IP handling | **FAIL (deployment gap)** | `trustProxy` is fixed false. Behind a reverse proxy, rate limits may see the proxy address for all users; blindly trusting forwarded headers would permit spoofing. An explicit trusted-proxy configuration is needed for the chosen host. |
| Content Security Policy | **NOT IMPLEMENTED** | Helmet is enabled but its CSP is explicitly disabled. No frontend static-host CSP policy is present. Define and test a policy at the API or static host before production. |
| Secret rotation | **NOT VERIFIED** | HMAC JWT signing uses one configured secret with no key identifier or overlap/rotation mechanism. A secret change invalidates existing access JWTs; the operator recovery/rotation procedure is undefined. |
| Secrets/logging/errors | **PASS (code/tests) / NOT VERIFIED (operations)** | Secret-bearing local env files are ignored; startup supports injected variables and suppresses raw startup errors. Log redaction/error sanitization tests pass. No production secret manager, rotation procedure, or Git-history scan is available from this checkout. |
| Production migration command/config | **PASS (config validation only); NOT VERIFIED (migration execution)** | Added independent `prisma7.production.config.ts` and `db:deploy:production` using required `MIGRATION_DATABASE_URL`. It does not load dotenv or import the scratch config. URL validation rejects loopback, known protected local aliases, port 5433, `flowforge`, `_scratch`, unsupported routing overrides, and TLS modes weaker than `verify-full`. `prisma validate` passed with a synthetic URL; no migration command ran. |
| Safe production migration procedure | **NOT IMPLEMENTED** | No production-only migrate job, pre/post checks, backup/restore rehearsal, or rollback/forward-fix runbook exists. |
| Fresh database migration chain | **PASS (isolated scratch rehearsal)** | A new empty database applied `0001_initial_foundation`, `0002_identity_sessions`, and `0003_project_task_lifecycle` in order using the existing scratch-safe config. `migrate status` is up to date, `migrate diff` found no schema difference, and all three ledger checksums match repository SQL. Production provider/permissions and populated-data locking remain unverified. |
| Migration risk | **NOT VERIFIED** | Fresh schema application succeeded. `0003` drops a full unique index and creates a partial unique index without `CONCURRENTLY`; lock impact on populated production data, provider behavior, and rollback procedure remain unknown. |
| CI and deployment automation | **NOT IMPLEMENTED** | No `.github/workflows`, application Dockerfile, deployment manifest, or release/migration script was found. Compose files are PostgreSQL-only local setups. |

### Recommended minimum architecture

Serve the Vite `dist/web` bundle as static files at `https://app.<domain>` and
run the Node API at `https://api.<domain>` on the same site, behind HTTPS
termination and an explicit trusted proxy. Use a managed PostgreSQL 16+ service
on private networking, TLS certificate/hostname verification, automated
backups/PITR, and separate least-privilege runtime and migration roles. Same-site
subdomains preserve the current `SameSite=Strict` refresh-cookie behavior.
Avoid adding a queue, Redis, or Kubernetes until product requirements justify
them; first make rate-limit semantics explicit for a single or multiple API
replicas.

### Environment variable names

Runtime API: `NODE_ENV`, `DATABASE_URL`, `ACCESS_TOKEN_SECRET`,
`CORS_ALLOWED_ORIGINS`, `SMTP_URL`, `SMTP_FROM`, `PUBLIC_APP_URL`; set
`API_HOST` and `API_PORT` for the host (for a container, `API_HOST=0.0.0.0`).
Optional API settings: `ACCESS_TOKEN_ISSUER`, `ACCESS_TOKEN_AUDIENCE`,
`ACCESS_TOKEN_LIFETIME_SECONDS`, `DATABASE_POOL_MAX`,
`DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_IDLE_TIMEOUT_MS`.

Frontend build: `VITE_API_BASE_URL` must be set to the HTTPS API base URL without
a trailing slash. Release migration job (not supported by current config):
`MIGRATION_DATABASE_URL` with DDL rights, separate from the least-privilege
runtime `DATABASE_URL`. `SHADOW_DATABASE_URL` is only relevant for development
migration workflows; `TEST_DATABASE_URL` is test-only. Do not put any secret
values in frontend build variables.

### Blockers

Before GitHub push: this workspace has no `.git` metadata, so current diff,
staging state, remote, branch, and commit history cannot be reviewed here. The
actual Git checkout must be used to review the complete diff and history and
run secret scanning before push. `.env` and `.env.*.local` are ignored by the
current `.gitignore`, but that alone does not establish that prior commits are
clean. No push was attempted.

Before production deployment: exercise the production migration config on a
production-like staging database (the fresh history replay below used the
scratch-only config); choose hosting/domains; configure trusted proxy
behavior and coordinated/shared rate limits; establish production database
backups/recovery and least-privilege roles; add CSP and a minimal CI/release
workflow. Verify SMTP, cookies, CORS, migration locking, readiness, and startup
against staging. Do not connect to port 5433.

The eventual migration runbook should use expand/contract changes: back up and
verify restore, rehearse the identical release against isolated staging/fresh
database targets, run a single serialized `prisma migrate deploy` release job
with the dedicated migration role, verify the migration ledger and readiness,
then roll out the compatible API build. Roll back application code separately;
use forward migrations for schema correction. Never use `prisma migrate dev`
against production, and do not use the current scratch-only `db:deploy` script.

### Files expected to change in a future approved implementation

Likely next implementation files are `package.json`, `src/config/env.ts`,
`src/api/config.ts`, `src/api/app.ts`, `src/api/main.ts`, `vite.config.ts`,
`.env.production.local.example`, plus a minimal API Dockerfile and GitHub
Actions workflow after the target host and CI secret model are chosen. Phase 1
already added the production Prisma config and frontend URL guard. The Graph
Engine does not need changes.

## Phase 1: Production-safe configuration (2026-10-30)

- Added `prisma7.production.config.ts` plus an independent production target
  validator and `db:deploy:production`. The config requires
  `MIGRATION_DATABASE_URL`, does not load dotenv or the scratch config, demands
  `sslmode=verify-full`, and refuses loopback, protected port/name, known local
  protected Docker aliases, and scratch database targets. Existing scratch and
  test configs were not changed. Only `prisma validate` was run with a
  synthetic target; **no production migration or database connection was run**.
- Production Vite builds now require `VITE_API_BASE_URL`, require HTTPS, and
  reject localhost/loopback targets. Development mode keeps the existing
  localhost fallback. A build with the variable unset failed with the expected
  configuration error; a build with a non-secret HTTPS example URL passed.
- Kept `/healthz` as liveness and added `/readyz`. Production wiring runs
  Prisma `SELECT 1`; success returns 200 `{status:"ready"}`, and failures
  return 503 `{status:"not_ready"}` without internal error details. Success and
  simulated failure are covered by API tests; no live database probe was made.
- Verification: focused tests passed before final changes; final
  `npm run test:offline` passed 252 tests across 33 files. Production build
  passed API/web type checks and Vite bundle. Production Prisma config schema
  validation passed. Missing-URL build guard failed as expected (negative
  check). No full database integration suite was run.
- Source changes: `prisma7.production.config.ts`, `package.json`,
  `src/config/production-migration-target.ts` and its spec,
  `src/config/frontend-api-url.ts` and its spec, `vite.config.ts`,
  `src/api/app.ts`, `src/api/app.spec.ts`, and `src/api/main.ts`.
- Remaining pre-deployment blockers: production-like staging verification,
  actual production host/database/secrets/SMTP, proxy trust and distributed
  rate-limit policy, CSP, backup/recovery, and CI/release automation. The frozen
  Graph Engine and protected
  PostgreSQL on port 5433 were not accessed or modified.

## Phase 2: Fresh database migration rehearsal (2026-10-30)

### Safety checks and identity

- Read-only `docker inspect flowforge-postgres-phase1c-scratch` confirmed the
  running `postgres:16-alpine` container, a host-only binding
  `127.0.0.1:5543` to container port 5432, and the dedicated volume
  `flowforge_pgdata_phase1c_scratch`.
- The repository-validated migration URL identifies
  `127.0.0.1:5543/flowforge_migration_scratch`; separate configured DBs are
  `flowforge_shadow_scratch` and `flowforge_test_scratch` on that same scratch
  instance. No existing database was selected as the rehearsal target.
- Read-only pre-create probe confirmed database `flowforge_migration_scratch`,
  server address `172.19.0.2/32`, server port 5432, PostgreSQL 16.15, permission
  to create a database, and no collision for
  `flowforge_rehearsal_20261030_c8a51f2e_scratch`.
- Created only the new database
  `flowforge_rehearsal_20261030_c8a51f2e_scratch` on host port 5543. Before
  migration it reported zero public tables. Its subsequent connection reported
  the same server address, port 5432, and PostgreSQL 16.15.

### Commands and results

- `docker inspect flowforge-postgres-phase1c-scratch --format '{{.Name}} image={{.Config.Image}} state={{.State.Status}} ports={{json .NetworkSettings.Ports}} mounts={{json .Mounts}}'` — PASS;
  read-only identity/binding/volume inspection.
- `CREATE DATABASE "flowforge_rehearsal_20261030_c8a51f2e_scratch"` — PASS,
  issued over the verified scratch connection after checking target absence
  and `CREATEDB` capability.
- Applied with a private temporary copy of the existing `prisma7.config.ts`
  and its existing `loadPrismaCliEnvironment` scratch safeguards, pointing
  only at the new database:
  `./node_modules/.bin/prisma migrate deploy --config "$TEMP_SCRATCH_CONFIG/prisma7.config.ts"`
  — PASS; applied `0001_initial_foundation`, `0002_identity_sessions`, and
  `0003_project_task_lifecycle` from zero. The temporary config and its
  credential-bearing env file were removed after use. No production Prisma
  config was used.
- `./node_modules/.bin/prisma migrate status --config "$TEMP_SCRATCH_CONFIG/prisma7.config.ts"`
  — PASS; “Database schema is up to date!”
- `./node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config "$TEMP_SCRATCH_CONFIG/prisma7.config.ts"`
  — PASS; “No difference detected.”
- Read-only ledger verification found exactly three successful, non-rolled-back
  migrations, and each database checksum matched the corresponding repository
  SQL file.
- Ran the existing integration spec directly with the repository's
  `TEST_DATABASE_URL` guard pointed at the new database:
  `./node_modules/.bin/vitest run src/infrastructure/database/schema.integration.spec.ts`
  — PASS, 1 test file and 7 tests passed. This avoided the existing
  `scripts/test-integration.mjs`, which is hardwired to the pre-existing
  `flowforge_test_scratch` and runs its migration deploy step there.
- Post-test read-only checks confirmed all 12 application tables have zero
  rows and the migration ledger still has exactly three successful entries.

The rehearsal database is intentionally retained; it was not reset or dropped.
No existing scratch/test database was reset or overwritten. No migration,
schema, source, or Graph Engine file was modified. Protected PostgreSQL on port
5433, container `flowforge-postgres`, and volume `flowforge_pgdata` were not
accessed. No production database, migration, GitHub push, or deployment was
used.
