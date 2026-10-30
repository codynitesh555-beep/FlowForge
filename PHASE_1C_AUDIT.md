# Phase 1C Independent Architecture & Security Audit

**Audit mode:** static source and documentation inspection only. No PostgreSQL connection, Prisma CLI, migration, Docker operation, integration test, build, or source modification was performed. This report does not establish runtime database correctness.

## Verdict: FAIL

The reviewed service and SQL adapter show consistent organization scoping, parameterized SQL, transaction propagation, and graph serialization by inspection. However, Phase 1C’s critical persistence behavior has no tests at the Prisma adapter boundary, while multiple lifecycle and locking claims depend on actual PostgreSQL semantics. The report therefore cannot safely pass the implementation as independently audited. There are also two specific correctness gaps below: graph-analysis errors are discarded at the HTTP boundary, and soft-delete/unassign operations return `null` from inside a transaction after writes if an expected follow-up read returns no row, allowing a partial logical mutation to commit.

## Findings

### Critical

None established statically in the reviewed code. This is not evidence that runtime database behavior is correct.

### Major

1. **The core Prisma project/task adapter has no behavior tests.** `src/modules/projects/infrastructure/prisma-project-task-store.ts` functions `lockActor`, `lockProject`, `incrementGraphRevision`, `updateTask`, `softDeleteTask`, `activeGraph`, `addDependency`, `removeDependency`, `assignTask`, and `unassignTask` contain the tenant predicates, lock protocol, raw SQL, and transactional event writes. The project test files exercise pure graph conversion, service ports with fake stores, and `writeProjectDomainEvent`; there is no `prisma-project-task-store.spec.ts`. Static tests do not prove that Prisma emits the intended SQL, that `FOR UPDATE`/advisory locks serialize as expected, or that the SQL matches the actual migrated schema. **Impact:** isolation, exactly-once graph revision behavior, assignment uniqueness, deadlock behavior, and atomic rollback are currently assertions from code review only. **Safe reproduction:** inspect the test set: `src/modules/projects/application/project-task.service.spec.ts`, `src/modules/projects/scheduling.spec.ts`, and `src/modules/projects/infrastructure/project-events.spec.ts` contain no store construction or query-boundary tests. Add offline injected-client tests first; later perform the documented isolated-database verification only with explicit authorization.

2. **Post-write missing-row branches can commit an incomplete logical operation.** In `PrismaProjectTaskStore.updateTask`, after `updateMany` succeeds, lines 288–290 return `null` if the subsequent `taskById` read returns no row, without throwing; the transaction callback then resolves successfully and can commit the task update without revision/event writes. In `softDeleteTask`, lines 314–327 can release assignments and increment `graphRevision`, then return `null` before emitting the task-deleted event if the final read has no row. The current schema uses restrictive references and the project lock, so normal concurrent application operations should not cause this; nevertheless a database trigger, policy, or future hard-delete path could. **Impact:** partial logical state and missing audit/outbox entries instead of rollback. **Reproduction:** make a transaction-scoped fake return one row for the initial lookup, report `count: 1` for the mutation, and return no row for the post-write lookup; the callback resolves rather than rejecting. **Remediation:** throw a typed internal error on impossible post-write absence so `withTransaction` rejects and rolls back.

### Moderate

1. **Graph Engine error information is collapsed before the API response.** `DefaultProjectTaskService.analyzeProject` in `src/modules/projects/application/project-task.service.ts:113-117` maps non-cycle errors to `ProjectTaskError('INVALID_PROJECT_GRAPH', { code: result.error.code })`; dependency addition does similarly at `src/modules/projects/infrastructure/prisma-project-task-store.ts:361-365`. `createApiApp` in `src/api/app.ts:97-102` serializes only `{ code: error.code }`. **Impact:** the public API preserves a generic failure code but not the underlying graph error code/details, which limits diagnosis and does not meet a strict interpretation of preserving graph errors. No sensitive data is exposed. **Reproduction:** cause a GraphEngine result error other than cycle detection; the HTTP response contains only `INVALID_PROJECT_GRAPH`. **Remediation:** retain a safe stable subcode in the response contract or log a sanitized diagnostic identifier internally.

2. **Archived projects can retain active assignments with no project-level release path.** `archiveProject` in `src/modules/projects/infrastructure/prisma-project-task-store.ts:199-212` only stamps `archived_at`; `unassignTask` at lines 461-465 rejects an archived project before setting `unassigned_at`. The approved lifecycle makes archive terminal and blocks writes. Task soft-delete releases task assignments, and membership deactivation releases assignments, but no archive path does either. **Impact:** assignment history can continue to show active allocations for an archived project indefinitely, and users cannot remove them through the task API. This does not cross tenants or affect scheduling today, but makes lifecycle semantics and future resource reporting ambiguous. **Reproduction:** assign a member, archive the project, then call unassign; the operation receives `PROJECT_ARCHIVED` and the assignment remains active. **Remediation:** owner decision needed on whether archive should release active assignments, allow unassignment on archived projects, or intentionally retain active assignment state; encode and test the chosen invariant.

3. **Prisma Client/schema compatibility is not independently verified.** `prisma/schema.prisma:80-137` exposes `Project.archivedAt` and `TaskDependency.removedAt`; migration 0003 adds them. The adapter deliberately reads/writes these fields with raw SQL, avoiding stale generated model properties, while `Task` Prisma CRUD remains generated-client based. `ARCHITECTURE_DECISIONS.md:42-45` records the custom partial unique index and unexecuted migration. **Impact:** source inspection cannot establish that the checked-in generated client matches the schema or that Prisma 7 accepts the full schema/migration state. No Prisma CLI was run per audit restriction. **Remediation:** before DB testing, generate/validate against a scratch-only Prisma config and confirm generated-client/schema revision; do not point this at any protected URL.

### Minor

1. **Dependency history list includes removed rows by design but has no active-only filter option.** `PrismaProjectTaskStore.listTaskDependencies` at `src/modules/projects/infrastructure/prisma-project-task-store.ts:416-425` returns both active and removed rows. This is consistent with the route summary “history” and does not affect scheduling, which filters removed rows. Consider documenting that clients must inspect `removedAt`.

2. **Error status mapping treats most domain conflicts as HTTP 409.** `src/api/app.ts:97-101` maps only a short explicit set to 400/404/403 and defaults the rest to 409. This is coherent for current domain codes but should be updated alongside new codes, especially `PROJECT_ARCHIVED` and `INVALID_PROJECT_GRAPH`; the latter is currently presented as conflict even though it can represent corrupted state.

## Tenant isolation and authorization

- Project routes are nested under `/v1/organizations/:organizationId`; `requirePrincipal` in `src/api/project-task-routes.ts:67-75` authenticates the access token, resolves an active membership using authenticated `userId` plus route organization, and attaches that principal. Request bodies are strict and do not accept `organizationId` fields (`:13-24`, `:146-150`, `:164-168`).
- Application methods authorize the principal’s organization and pass that same organization ID to reads; mutation DTOs omit tenant IDs (`src/modules/projects/contracts.ts:4-21`, `90-109`).
- Store reads and writes visibly include organization/project/task predicates. The dependency SQL is parameterized with `Prisma.sql` and each dependency endpoint is protected by composite foreign keys in `prisma/schema.prisma:123-137`. Task and assignment composite relations similarly constrain tenant/project/membership identity (`:97-120`, `:140-154`).
- Assignment creation locks the acting and target memberships and checks the target as active in the actor’s organization (`prisma-project-task-store.ts:70-87`, `428-445`; `domain/assignments.ts`). The database FK also ties membership ID, organization ID, and user ID together.
- **No direct cross-tenant reference path was found by static inspection.** This conclusion depends on the actual database constraints being applied; migration execution and runtime constraint tests were not performed.
- Read operations rely on active-principal resolution at request time and do not hold a membership lock for the duration of the read. This is a point-in-time authorization model; write paths revalidate the acting membership in the transaction. No concrete IDOR path was identified.

## Database, raw SQL, transactions, and migrations

- All visible raw SQL uses Prisma tagged templates and interpolated values (`prisma-project-task-store.ts:71-100`, `109-117`, `131-136`, `206-209`, `314-318`, `336-341`, `366-381`, `398-404`, `418-425`, `466-475`, `488-497`, `502-514`). No string concatenation of request input into SQL was found.
- Referenced physical table/column names match `@map`/`@@map` declarations in the reviewed schema. Migration `prisma/migrations/0003_project_task_lifecycle/migration.sql:1-12` adds archive/removal timestamps, temporal checks, drops the prior full edge uniqueness index, and creates the active-edge partial unique index. The same active-edge predicate is used in adapter lookup and insert logic.
- The project store routes mutations through `withTransaction`; `src/infrastructure/database/transaction.ts:8-10` passes the callback’s transaction client. Event writes receive that client (`prisma-project-task-store.ts:45-68`), so mutation, ActivityLog, and OutboxEvent are intended to commit or roll back together. The code inspection did not find a root-client use inside these mutation callbacks.
- Assignment uniqueness also has a database partial unique index, `unique_active_task_assignment`, in `prisma/migrations/0001_initial_foundation/migration.sql:267-269`; the store’s pre-check is serialized under the project lock (`assignTask`, lines 428-445). Database enforcement is still unverified.
- Migration 0003 is an additive empty-database migration step and appears syntactically straightforward for PostgreSQL. It is not idempotent when replayed directly over an already-upgraded schema (normal migration runners record applied migrations). No actual replay or PostgreSQL parser validation was performed.
- Prisma cannot model the active-edge partial predicate as an `@@unique`; the custom index is documented. Prisma schema and generated client compatibility remains unverified (Moderate finding above).

## Concurrency, graph revision, and scheduling

- Mutating graph/project operations call `lockActor` before `lockProject`; `lockProject` acquires the transaction-scoped advisory lock using the documented `hashtextextended(projectId, 0)` key before selecting the project `FOR UPDATE` (`prisma-project-task-store.ts:70-101`). `activeGraph` uses the same order before reading graph rows (`:334-345`).
- Identity membership lifecycle first locks the organization `FOR UPDATE`, then membership IDs ordered by ID, then assignment IDs ordered by ID (`src/modules/identity/infrastructure/prisma-membership-lifecycle.ts:19-37`, `69-83`). Project writes take organization `FOR SHARE` before membership/project/assignment locks. This creates an organization-level gate between membership transitions and assignment writes. The order is coherent by inspection; database deadlock/race behavior was not exercised.
- Task updates use version comparison and `updateMany` guarded by tenant/project/deleted/version fields (`prisma-project-task-store.ts:259-287`). Task creation, soft-delete, edge add/remove, and changed PERT estimates increment graph revision once in their respective transaction paths; task metadata-only updates and assignment changes do not. Assignment paths do not call `incrementGraphRevision`.
- `activeGraphIn` tenant-scopes tasks and edges, and `buildActiveProjectGraph` excludes deleted nodes, removed edges, and edges touching deleted nodes (`prisma-project-task-store.ts:126-145`; `src/modules/projects/scheduling.ts:16-34`). Inputs are sorted deterministically before invoking the frozen Graph Engine; schedule DTO arrays are sorted at `project-task.service.ts:118-127`.
- Pure scheduling tests cover cycle detection, Graph Engine delegation, and lifecycle filtering (`src/modules/projects/scheduling.spec.ts`). They do not exercise database snapshot consistency, SQL row selection, advisory locking, trigger-computed expected hours, or race behavior.

## API security and error behavior

- Every route in `src/api/project-task-routes.ts:79-186` has `requirePrincipal`; tenant is resolved from the URL plus authenticated user membership. IDs use UUID schemas, bodies are strict, and project/task mutations route through the service permission checks.
- OWNER/ADMIN/MEMBER action policy is implemented in `src/modules/identity/domain/permissions.ts` and checked in `src/modules/projects/application/project-task.service.ts`. MEMBER task updates require assigned-task permission, and the adapter confirms an active assignment in transaction (`:80-96`, `prisma-project-task-store.ts:262-268`).
- Archived projects remain readable, active project lists omit them, and writes/schedule fail through `requireWritableProject` / activeGraph (`prisma-project-task-store.ts:104-107`, `165-179`, `183-220`, `334-345`). Soft-deleted tasks disappear from active reads; task deletion releases active assignments and retains task/dependency history (`:299-331`).
- Error responses contain stable codes only (`src/api/app.ts:85-108`), and authorization/provider exception details are not serialized. `PROJECT_ARCHIVED` currently falls through to 409. Graph detail loss is called out above.

## Test quality and missing offline coverage

The checked-in project tests are meaningful at the pure domain/application/API boundaries, but there are no tests for the concrete Prisma project/task adapter. Existing service tests use a fake `ProjectTaskStore`; those prove service decisions, not SQL predicates or locks. Event-writer tests prove delegate calls and lookup failure propagation, not enclosing transaction rollback. API tests use mocked services and therefore do not prove repository isolation.

High-value offline additions:

1. Inject a query/delegate boundary around `PrismaProjectTaskStore` and assert tenant/project predicates, SQL parameter bindings, and transaction-client-only use.
2. Assert lock sequence: organization, sorted memberships, project advisory lock, project row, then graph/assignment reads; assert every graph mutation increments once and assignment changes never increment.
3. Inject failures after each mutation and during ActivityLog/OutboxEvent creation; assert transaction rejection/rollback propagation, including the post-write missing-row cases.
4. Exercise update version mismatch, task deletion assignment release, repeated dependency add/remove, archived project writes, cross-tenant IDs, inactive target membership, and assignment uniqueness race behavior via deterministic transaction fakes.
5. API tests should assert each route rejects unauthenticated and non-member principals, strict tenant/body override rejection, error status/code for archived projects and graph errors, and member assignment-history filtering.

No tests were run during this audit. `TESTING_STRATEGY.md` reports a previous 175-test offline run and explicitly says the adapter is not exercised; that result is treated as documentation, not independently verified evidence.

## Recommended remediation order

1. Make impossible post-write missing-row states throw so the transaction rolls back; add regression tests.
2. Add offline Prisma adapter/query-boundary tests for tenant predicates, lock order, transaction propagation, graph revision counts, and event rollback.
3. Decide and document active assignment behavior when a project is archived; update service and tests to match.
4. Preserve safe Graph Engine failure subcodes through the application/API mapping.
5. With separate explicit approval, validate/generate Prisma Client and execute migration + concurrency/constraint checks only against an isolated disposable scratch database whose target is independently verified.

## Database verification required before claiming runtime correctness

Against an explicitly authorized, disposable PostgreSQL 16 scratch database only: replay all migrations from empty; inspect the resulting schema/indexes/check constraints; verify Prisma Client generation and adapter startup; test composite FK rejection, active-edge and active-assignment partial uniqueness, PERT trigger outputs and decimal boundaries; confirm transaction rollback for task/event failures; run concurrent graph edits and membership/assignment lifecycle cases; confirm advisory-lock ordering and graphRevision behavior. This audit does not authorize that testing and does not claim any of it has passed.
