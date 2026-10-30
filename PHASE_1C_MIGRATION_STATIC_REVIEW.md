# Phase 1C Migration and Prisma Schema — Static Review

## Verdict: PARTIAL

Static inspection found no definite SQL or schema defect that blocks applying the ordered migrations to a fresh, empty PostgreSQL database. Migration dependencies and table/constraint definitions are internally consistent with the active Prisma schema, including documented custom partial indexes and database-only checks/triggers.

This is **not** runtime validation. SQL parsing/execution, migration replay, generated-client compatibility, database constraints, triggers, and Prisma/PostgreSQL behavior remain unverified. The scratch instance was not contacted. Before applying migrations, the operator must independently ensure Prisma CLI targets only the dedicated scratch databases; shadow and test databases must exist before workflows that use them.

## Scope and method

Reviewed `prisma/schema.prisma`, all migration SQL files under `prisma/migrations`, and `migration_lock.toml` by reading source only. No database connection, Docker command, Prisma CLI, migration, test, build, or file modification outside this report was performed. No environment files or credentials were inspected.

## Migration execution order

1. [`0001_initial_foundation/migration.sql`](prisma/migrations/0001_initial_foundation/migration.sql) — schema and enum setup; core organizations/users/memberships/projects/tasks/dependencies/assignments/activity/outbox tables; indexes, foreign keys, checks, PERT trigger, and active-assignment partial unique index.
2. [`0002_identity_sessions/migration.sql`](prisma/migrations/0002_identity_sessions/migration.sql) — adds auth sessions, password-reset tokens, and organization invitations; depends on `users`, `organizations`, and the `membership_role` enum from 0001.
3. [`0003_project_task_lifecycle/migration.sql`](prisma/migrations/0003_project_task_lifecycle/migration.sql) — adds project archive and dependency removal timestamps/checks; replaces the full dependency-edge unique index with an active-edge partial unique index.

[`migration_lock.toml`](prisma/migrations/migration_lock.toml) declares provider `postgresql`.

The directory names sort in dependency order. In 0001, tables are created before their foreign keys are added, so all referenced tables exist by the FK phase. Migration 0002 references only base tables/types from 0001. Migration 0003 alters tables and drops the exact dependency unique-index name created in 0001.

## Findings by severity

### Critical

None identified by static inspection.

### Major

None identified by static inspection.

### Moderate

#### M-1 — Runtime migration and schema compatibility remain unverified

**Files:** `prisma/migrations/0001_initial_foundation/migration.sql:1-270`; `prisma/migrations/0002_identity_sessions/migration.sql:1-61`; `prisma/migrations/0003_project_task_lifecycle/migration.sql:1-12`; `prisma/schema.prisma:1-244`.

The DDL is structurally consistent by inspection, but no PostgreSQL parser or migration runner was used, and Prisma schema validation/client generation were not performed. Static review cannot establish PostgreSQL execution success, Prisma-generated DDL compatibility, actual migration checksums/replay state, or that the running scratch database is empty and correctly targeted.

**Disposition:** No source-level SQL correction is identified. This remains a verification blocker before claiming migrations have been successfully applied or database behavior verified. After separate authorization, apply only to a confirmed disposable scratch target.

### Minor

None identified as requiring a migration change. Custom indexes and database-only constraints are described below.

## Schema and migration compatibility review

### Tables, columns, and ordering

Migration 0001 creates `organizations` and `users` first, followed by `memberships`, `projects`, `tasks`, `task_dependencies`, `task_assignments`, `activity_logs`, and `outbox_events` ([0001:10-136](prisma/migrations/0001_initial_foundation/migration.sql#L10)). Column names, mapped names, SQL types, nullability, defaults, and timestamp precision correspond to the active schema’s models ([schema:31-192](prisma/schema.prisma#L31)). Client-side `@default(uuid())` and `@updatedAt` fields have no SQL-side UUID/update timestamp defaults in the migration; this is consistent with Prisma-managed values, but raw SQL writers must provide required values explicitly.

Migration 0002 adds `auth_sessions`, `password_reset_tokens`, and `organization_invitations` with columns matching schema models ([0002:1-61](prisma/migrations/0002_identity_sessions/migration.sql#L1), [schema:194-244](prisma/schema.prisma#L194)). Migration 0003 adds nullable `archived_at` and `removed_at` to existing tables, matching the optional schema fields ([0003:1-12](prisma/migrations/0003_project_task_lifecycle/migration.sql#L1), [schema:80-137](prisma/schema.prisma#L80)).

### Primary keys, foreign keys, referential actions, and tenant isolation

Every created table has a UUID primary key. SQL foreign keys match the Prisma relations and declared referential actions:

- Membership to organization/user and project to organization use `RESTRICT` deletes ([0001:192-200](prisma/migrations/0001_initial_foundation/migration.sql#L192), [schema:62-94](prisma/schema.prisma#L62)).
- Task references `(project_id, organization_id)` to the corresponding project composite unique key ([0001:201-203](prisma/migrations/0001_initial_foundation/migration.sql#L201), [schema:97-120](prisma/schema.prisma#L97)).
- Both dependency endpoints reference task `(id, project_id, organization_id)` with `RESTRICT` ([0001:204-208](prisma/migrations/0001_initial_foundation/migration.sql#L204), [schema:123-137](prisma/schema.prisma#L123)).
- Assignment references both its task/project/organization composite and membership/organization/user composite, preventing tenant, project, and user mismatches at the database constraint level ([0001:210-214](prisma/migrations/0001_initial_foundation/migration.sql#L210), [schema:140-154](prisma/schema.prisma#L140)).
- ActivityLog organization is restricted; optional actor user uses `SET NULL`. Outbox organization is restricted ([0001:216-223](prisma/migrations/0001_initial_foundation/migration.sql#L216), [schema:157-191](prisma/schema.prisma#L157)).
- Session/reset-token user references and invitation organization/inviter references use `RESTRICT` ([0002:15-16](prisma/migrations/0002_identity_sessions/migration.sql#L15), [0002:32](prisma/migrations/0002_identity_sessions/migration.sql#L32), [0002:54-55](prisma/migrations/0002_identity_sessions/migration.sql#L54), [schema:194-243](prisma/schema.prisma#L194)).

The composite task and assignment foreign keys are the key database-level tenant-isolation constraints. They are present in SQL and modeled in Prisma. Enforcement is **NOT VERIFIED** without applying them to PostgreSQL.

### Unique constraints and indexes

The SQL creates the schema’s organization slug, user email, membership, project, task, session token hash, reset token hash, invitation token hash, and supporting indexes. Names/columns correspond to Prisma `@unique`, `@@unique`, and `@@index` declarations ([0001:138-190](prisma/migrations/0001_initial_foundation/migration.sql#L138), [0002:17-19](prisma/migrations/0002_identity_sessions/migration.sql#L17), [0002:34-35](prisma/migrations/0002_identity_sessions/migration.sql#L34), [0002:57-59](prisma/migrations/0002_identity_sessions/migration.sql#L57), [schema:31-243](prisma/schema.prisma#L31)).

Two partial indexes are intentional custom SQL because Prisma cannot express their predicates:

- Active task assignment uniqueness on `(task_id, user_id)` where `unassigned_at IS NULL` ([0001:265-269](prisma/migrations/0001_initial_foundation/migration.sql#L265)).
- One active dependency edge on project, organization, prerequisite, and dependent task where `removed_at IS NULL`; migration 0003 drops the earlier full uniqueness index before adding this partial index ([0003:9-12](prisma/migrations/0003_project_task_lifecycle/migration.sql#L9)).

Migration 0002 also adds one pending password-reset token per user and one unaccepted/unrevoked invitation per organization/email ([0002:36-37](prisma/migrations/0002_identity_sessions/migration.sql#L36), [0002:60-61](prisma/migrations/0002_identity_sessions/migration.sql#L60)). The invitation adapter explicitly retires expired pending rows before inserting a replacement, consistent with that predicate ([prisma-organization-invitations.ts:24-39](src/modules/identity/infrastructure/prisma-organization-invitations.ts#L24)).

### CHECK constraints and numeric definitions

Migration 0001’s database-only checks cover PERT input bounds/order, expected/variance/slack ranges and NaN rejection, positive task version, nonnegative project graph revision and outbox attempts, no self-dependency, and normalized user email/organization slug ([0001:225-248](prisma/migrations/0001_initial_foundation/migration.sql#L225)). Bounds inspected are consistent with `DECIMAL(10,4)` PERT/expected/slack values and `DECIMAL(15,4)` variance columns ([0001:60-77](prisma/migrations/0001_initial_foundation/migration.sql#L60), [schema:97-112](prisma/schema.prisma#L97)).

Migration 0002 adds lowercase-hex token hash and expiry checks for sessions, reset tokens, and invitations ([0002:11-15](prisma/migrations/0002_identity_sessions/migration.sql#L11), [0002:29-32](prisma/migrations/0002_identity_sessions/migration.sql#L29), [0002:50-55](prisma/migrations/0002_identity_sessions/migration.sql#L50)). Migration 0003 requires lifecycle timestamps to be no earlier than row creation ([0003:1-7](prisma/migrations/0003_project_task_lifecycle/migration.sql#L1)).

### PERT trigger

The trigger function computes expected hours as `(O + 4L + P) / 6` and variance as `((P - O) / 6) ^ 2`, then runs `BEFORE INSERT OR UPDATE` for each task row ([0001:250-263](prisma/migrations/0001_initial_foundation/migration.sql#L250)). It intentionally overwrites application-supplied derived values, agreeing with the comment. This is structurally valid PostgreSQL PL/pgSQL by inspection, but function creation, numeric rounding/overflow, and trigger results are **NOT VERIFIED** in a live PostgreSQL instance.

## Fresh empty scratch readiness

**Static assessment:** Migration order and dependencies are coherent for an empty database: 0001 creates the required base types/tables, 0002 adds identity tables that reference those base objects, and 0003 alters the project/dependency tables and replaces the dependency index created in 0001. No static blocker was found that calls for a schema or migration edit before a fresh-database attempt.

**Operational blocker before execution:** Confirm through an approved, secret-safe process that Prisma CLI is configured with the dedicated scratch migration target, and provision distinct scratch shadow/test databases before workflows that need them. Do not infer database contents or migration state from container health. The migration application itself remains unverified and is not authorized by this review.

## Explicitly not verified

- PostgreSQL 16 parsing or execution of any migration.
- Migration replay, checksums, or state against the currently running scratch instance.
- Generated Prisma Client/schema compatibility or Prisma CLI validation.
- Actual FK, unique/partial index, CHECK, trigger, and referential-action enforcement.
- PERT persisted values, numeric rounding, or overflow behavior.
- Transaction rollback, locking, deadlocks, isolation, or concurrent writes.
- Whether the scratch database is empty or whether shadow/test databases exist.

No source-level SQL blocker was found. Do not treat this report as authorization to execute migrations; obtain the required approval and verify the exact scratch target first.
