# Phase 1C Prisma 7 and Scratch Environment Static Preflight

## 1. Verdict: BLOCKED

The package declarations and lockfile show aligned Prisma ORM/client/adapter versions, and the scratch Compose template is textually separated from the protected container, volume, database name, and port. However, the Prisma config is named `prisma7.config.ts`, while the repository scripts invoke Prisma without an explicit `--config`; the file also imports default `dotenv/config`, which does not load `.env.phase1c-scratch.local`. Consequently, the inspected files do not demonstrate that the project’s guarded Prisma CLI config will be discovered and populated from the approved scratch environment. No Prisma command was run to test discovery. Resolve this configuration ambiguity before any Prisma CLI verification.

This review is static only. It does not establish the current process/runtime versions, scratch credentials, current database target, database contents, Prisma validation/client generation, migration behavior, or adapter behavior.

## 2. Files inspected

### Inspected

- `package.json`
- `package-lock.json`
- `prisma/schema.prisma`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/0001_initial_foundation/migration.sql`
- `prisma/migrations/0002_identity_sessions/migration.sql`
- `prisma/migrations/0003_project_task_lifecycle/migration.sql`
- `prisma7.config.ts`
- `docker-compose.phase1c-scratch.yml`
- `.env.phase1c-scratch.local.example`
- `PHASE_1C_SCRATCH_POSTGRES_README.md`
- `src/config/env.ts`
- `src/infrastructure/database/prisma.ts`
- Relevant source import locations in `src/api/main.ts` and the Prisma infrastructure modules.

### Missing

- `prisma.config.ts` — not present. The only Prisma config file found is `prisma7.config.ts`.
- `pnpm-lock.yaml` and `yarn.lock` — not present; the repository uses `package-lock.json`.
- `.nvmrc` and `.node-version` — not found.

`.env.phase1c-scratch.local` was deliberately not opened. Its current existence, contents, completeness, and values are not established by this report.

## 3. Version table

| Package/runtime | Declared in `package.json` | Lockfile-resolved | Compatibility observation |
|---|---:|---:|---|
| `prisma` | `^7.10.1` | `7.10.1` | CLI package version aligns with client and adapter. Lockfile engine: `^20.19 || ^22.12 || >=24.0`. |
| `@prisma/client` | `^7.10.1` | `7.10.1` | Version aligned. Lockfile engine: `^20.19 || ^22.12 || >=24.0`; peer requirements include Prisma (optional peer metadata) and TypeScript `>=5.4.0`. |
| `@prisma/adapter-pg` | `^7.10.1` | `7.10.1` | Version aligned. Its locked dependencies include `@prisma/driver-adapter-utils` `7.10.1` and a compatible `pg` range `^8.16.3`. |
| `pg` | `^8.23.1` | `8.23.1` | Lockfile engine `>=16.0.0`; compatible with adapter’s declared `^8.16.3` range. |
| TypeScript | `^7.0.2` | `7.0.2` | Meets Prisma package peer minimum `>=5.4.0` according to metadata. Actual generated-client compilation compatibility was not tested. |
| `dotenv` | `^17.4.2` | `17.4.2` | Used by Prisma config through `dotenv/config`; that import convention loads the default `.env`, not the separately named scratch file. |
| Node.js runtime | No project `engines` field | Not applicable | Runtime version is unknown. Prisma and client lock metadata require Node `^20.19 || ^22.12 || >=24.0`; no project pin was found. |

These are declared and lockfile-resolved versions only. No installed runtime/package versions were queried or executed.

## 4. Prisma 7 findings

### Configuration and target source

`prisma7.config.ts` imports `dotenv/config`, imports `loadPrismaCliEnvironment`, and configures schema path `prisma/schema.prisma`, migration path `prisma/migrations`, datasource URL from `migrationDatabaseUrl`, and optional `shadowDatabaseUrl` from the guarded environment object ([`prisma7.config.ts:1-17`](prisma7.config.ts#L1)).

`schema.prisma` declares only `provider = "postgresql"` in the datasource and no URL ([`schema.prisma:11-13`](prisma/schema.prisma#L11)); the Prisma 7 config supplies the URL externally, which is structurally consistent with this layout.

The loader requires `MIGRATION_DATABASE_URL`; it does not fall back to `DATABASE_URL`. It validates migration and optional shadow/test target names and rejects protected port/database targets and collisions based on port/database pair ([`src/config/env.ts:213-254`](src/config/env.ts#L213)). This is a useful fail-closed guard if the guarded config is actually used.

### Configuration blockers

1. **Config discovery ambiguity — Major.** The file is named `prisma7.config.ts`, not `prisma.config.ts`, and `package.json` Prisma scripts do not pass a config path. Static inspection therefore does not establish that normal `npm run db:*` commands use this guarded config. No CLI execution was permitted. **Next safe action:** choose a recognized config filename or explicitly pass the intended config path in every Prisma command/script, then independently review that exact invocation before authorization.
2. **Scratch environment loading ambiguity — Major.** `dotenv/config` loads the default `.env`; the scratch file is `.env.phase1c-scratch.local`, and no loader/path configuration in `prisma7.config.ts` points to it. The scratch template documents Compose’s `--env-file`, which only feeds Compose and does not export variables to a separate Prisma CLI process. Missing `MIGRATION_DATABASE_URL` should fail rather than fall back, but the inspected setup does not show a safe automatic route from the scratch template to the Prisma config. **Next safe action:** decide on a protected, explicit way to supply scratch Prisma variables and statically verify the selected config path. Do not print those values.

### Generator and imports

The schema uses the newer `prisma-client` generator with output `../src/generated/prisma` ([`schema.prisma:6-9`](prisma/schema.prisma#L6)). Application infrastructure imports `PrismaClient` and Prisma namespace/types from that generated output (for example [`src/infrastructure/database/prisma.ts:1-3`](src/infrastructure/database/prisma.ts#L1)); module type is ESM (`package.json` has `"type": "module"`).

`src/infrastructure/database/prisma.ts` constructs `PrismaPg` from a `PgPoolConfiguration` and passes it as `new PrismaClient({ adapter })` ([`prisma.ts:1-3,39-44`](src/infrastructure/database/prisma.ts#L1)). It has one lazy singleton, explicit connect/disconnect functions, pool configuration, and no direct `pg.Pool` construction in the reviewed initialization path ([`prisma.ts:48-76`](src/infrastructure/database/prisma.ts#L48)). This source pattern is consistent with the declared Prisma 7 adapter stack. **Client generation and runtime adapter compatibility are not verified.**

## 5. Migration findings

### Exact order

1. `prisma/migrations/0001_initial_foundation/migration.sql`
2. `prisma/migrations/0002_identity_sessions/migration.sql`
3. `prisma/migrations/0003_project_task_lifecycle/migration.sql`

`migration_lock.toml` declares `provider = "postgresql"`.

### Static dependency and schema observations

- 0001 creates enums and foundational organization/user/membership/project/task/dependency/assignment/activity/outbox tables, then indexes and foreign keys, then checks, trigger, and partial active-assignment uniqueness. Referenced tables are created before foreign keys are added.
- 0002 depends on `users`, `organizations`, and `membership_role` from 0001; these precede its session, password-reset, and invitation tables.
- 0003 adds nullable `projects.archived_at` and `task_dependencies.removed_at`, temporal checks, then drops the full dependency-edge unique index created in 0001 and adds active-edge partial uniqueness.
- The active schema includes the added 0002 models and 0003 lifecycle fields. Composite task/project/organization and assignment/membership/organization/user relationships are represented in Prisma and migration SQL by inspection.
- No definite static table/column/constraint mismatch was found during this review.

### Custom SQL not proven by Prisma schema alone

The migrations include PostgreSQL partial unique indexes, numeric and normalization CHECK constraints, token format/expiry checks, and a PL/pgSQL PERT trigger (`0001` and `0002`); migration `0003` alters the active dependency uniqueness predicate. These cannot be fully validated from the Prisma model declarations. SQL parsing, trigger installation/execution, precision/overflow, actual referential actions, and index enforcement remain unverified.

## 6. Scratch-safety findings

### Safe static configuration observations

- Compose declares service `postgres-phase1c-scratch`, image `postgres:16-alpine`, container `flowforge-postgres-phase1c-scratch`, fixed loopback host mapping `127.0.0.1:55432:5432`, initial database `flowforge_migration_scratch`, and dedicated named volume `flowforge_pgdata_phase1c_scratch` ([`docker-compose.phase1c-scratch.yml:1-24`](docker-compose.phase1c-scratch.yml#L1)).
- Compose requires `SCRATCH_POSTGRES_USER` and `SCRATCH_POSTGRES_PASSWORD`; it does not define defaults for them. Its database initialization target is hard-coded to the scratch database name.
- `.env.phase1c-scratch.local.example` has placeholder values only. It references `MIGRATION_DATABASE_URL`, `SHADOW_DATABASE_URL`, and `TEST_DATABASE_URL` with distinct scratch database names at loopback port 55432. The actual `.local` file was not read.
- The README states that only the migration database is initialized by this Compose service; shadow and test databases must be separately provisioned. The Compose service itself does not create those databases.
- No `DATABASE_URL`, protected database name, protected port, protected container name, or protected volume is used as a target in the scratch Compose or example file.

### Unresolved targeting ambiguity

Static files demonstrate intended scratch isolation only. They do not prove the values in the actual local environment file, the environment inherited by a future Prisma process, the currently running container/volume state, the current database contents, or which target any future command would resolve. The config filename and environment-loading issues above make the future Prisma CLI target especially important to resolve before execution.

## 7. Potential blockers

| Severity | Blocker | Evidence | Next safe action |
|---|---|---|---|
| Major | Prisma config filename is nonconventional while package scripts do not specify it. | `prisma7.config.ts` exists; `prisma.config.ts` is absent; `package.json` DB scripts invoke Prisma without `--config`. | Statically establish and use an explicit recognized config path before any Prisma CLI command. |
| Major | Scratch environment template is not the default dotenv file loaded by the config. | `prisma7.config.ts:3` imports `dotenv/config`; documented scratch env filename is `.env.phase1c-scratch.local`. | Provide Prisma variables through an explicitly reviewed protected mechanism or intentionally configure a safe env-file path; do not print credentials. |
| Moderate | Node runtime requirement is not pinned at project level. | No `engines`, `.nvmrc`, or `.node-version`; Prisma lock metadata requires Node `^20.19 || ^22.12 || >=24.0`. | Select/pin a supported Node runtime before running Prisma tooling. Runtime version remains unknown here. |
| Moderate | Actual scratch target/readiness cannot be established by static files. | Local scratch env omitted; no Docker or database inspection permitted by this directive. Shadow/test database existence is not evidenced. | Under separate authorization, verify target identity without exposing URLs and provision distinct scratch shadow/test DBs before workflows requiring them. |

## 8. Missing evidence

- Current installed package/runtime versions and actual Node version.
- Prisma config discovery and dotenv loading behavior under actual CLI invocation.
- Contents, completeness, and targets of `.env.phase1c-scratch.local`.
- Current Docker/container/volume/network status and scratch database contents; this review did not inspect any Docker resources.
- Existence and uniqueness of shadow/test databases.
- Prisma schema validation and generated client compatibility.
- PostgreSQL migration parsing/application/replay and migration history.
- Actual SQL constraints, indexes, triggers, referential actions, rollback, locks, isolation, and concurrency behavior.
- PrismaPg connection and TLS behavior at runtime.

## 9. Minimal future verification sequence

Each step requires explicit authorization for that step; none was executed here.

1. **Resolve static CLI configuration first.** Establish the exact config file selected by the approved Prisma invocation and ensure it loads only the intended migration/shadow variables. Confirm the invocation cannot select the application URL. This can be reviewed statically before execution.
2. **Verify scratch target identity without disclosing credentials.** With explicit approval, inspect only the named scratch container’s health, bind address/port, and named volume, then validate target URLs by redacted host/port/database identity. Do not inspect the protected container or database.
3. **Confirm required scratch databases exist and are distinct.** With explicit authorization, use an approved, narrowly scoped method that prints only safe database names and target identity, not credentials or full URLs. Provision shadow/test databases only with separate explicit approval if missing.
4. **Validate Prisma config and generate client.** After config/environment resolution is corrected and the target is verified, run Prisma validation and client generation only with the approved scratch-safe environment. Each Prisma CLI/code-generation action requires explicit authorization.
5. **Replay migrations.** Apply `0001`, `0002`, then `0003` only to a confirmed disposable scratch database, with a dedicated shadow database where required. Migration execution requires explicit approval.
6. **Verify schema constraints.** Inspect migration history, composite tenant FKs, partial unique indexes, CHECK constraints, PERT trigger and referential actions using approved scratch-only queries. Requires explicit database-testing approval.
7. **Run focused integration checks.** Test trigger-derived PERT values, rollback behavior, tenant-FK rejection, active assignment/dependency partial uniqueness, and critical locking/concurrency scenarios using only the isolated scratch targets. Requires explicit approval for database tests.

## 10. Execution and modification statement

Only static directory listings and source/lock/config file reads were performed. No Prisma CLI, package manager, application command, database connection/query, migration, test, build, code generation, Docker/Compose operation, or file modification occurred. No `.env` file was opened. The protected container/database/volume and frozen Graph Engine were not accessed or modified. Phase 1D was not started.
