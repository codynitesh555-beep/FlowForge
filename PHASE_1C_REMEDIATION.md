# Phase 1C Audit Remediation

**Status:** remediation implemented; fresh independent audit pending. This document does not mark Phase 1C PASS. All tests here are offline fakes/unit/API tests. No PostgreSQL runtime correctness is claimed.

## Checklist from `PHASE_1C_AUDIT.md`

### Critical findings

- [x] Audit recorded no statically established critical finding. Runtime correctness remains unverified and is not inferred from that absence.

### Major findings

| Status | Severity / exact location | Root cause | Correction | Regression test | PostgreSQL required? |
|---|---|---|---|---|---|
| [x] | Major — `src/modules/projects/infrastructure/prisma-project-task-store.ts`: `updateTask`, `softDeleteTask`, `lockActor`, `lockProject`, `incrementGraphRevision`, `addDependency`, `removeDependency`, `assignTask`, `unassignTask` | The concrete adapter had no executable tests, so tenant predicates, row counts, transaction propagation, and error paths were review-only. | Added fake transaction-client tests that execute selected real store methods, record raw SQL and parameters, model commit/reject behavior, and exercise revision/event failures, lock ordering, tenant early rejection, stale versions, archive assignment cleanup, and uniqueness/FK mapping. | `prisma-project-task-store.spec.ts` | **Yes** for actual Prisma/PostgreSQL SQL, rollback, locking, constraints, concurrency, and isolation. The new offline suite is not a substitute. |
| [x] | Major — `prisma-project-task-store.ts`: `updateProject`, `updateTask`, `softDeleteTask` | Post-write missing-row branches returned `null`, resolving the transaction after a mutation and potentially omitting graph revision or events. | Impossible post-write absence and affected-row-count mismatch now throws `PERSISTENCE_INVARIANT_VIOLATION`; transaction callback rejection propagates through `withTransaction`. Task-delete assignment release count is checked too. | `prisma-project-task-store.spec.ts`: post-write disappearance in task update/delete, revision failure, event failures. | **Yes** to prove actual database rollback; offline tests prove the callback rejects. |

### Moderate findings

| Status | Severity / exact location | Root cause | Correction | Regression test | PostgreSQL required? |
|---|---|---|---|---|---|
| [x] | Moderate — `project-task.service.ts`: `analyzeProject`; store `addDependency`; `src/api/app.ts`: error handler | Graph errors were collapsed to a generic code and the original diagnostic was discarded by the API handler. | Store/service retain a safe `graphCode` in `ProjectTaskError.details`; handler logs that safe code and returns a stable 500 response without details. Invariant failures log only the operation identifier and also return generic `INTERNAL_ERROR`. | `src/api/app.spec.ts`: graph detail and invariant detail are not returned. | No for response mapping; **yes** to induce database-originated failures. |
| [x] | Moderate — `prisma-project-task-store.ts`: `archiveProject`, `unassignTask` | Archive blocked future writes but left active assignments that could no longer be unassigned through the project API. | Approved implementation rule recorded in `ARCHITECTURE_DECISIONS.md`: archive releases all active assignments, retains history, emits removal events in the same transaction, and repeated archive repairs residual active assignments without duplicating `project.archived`. Other writes remain blocked; no restore path added. | `prisma-project-task-store.spec.ts`: archive releases assignment and writes paired events; event failure rejects the transaction. | **Yes** for row locks, atomic persistence, and concurrent archive/assignment lifecycle behavior. |
| [ ] | Moderate — `prisma/schema.prisma`, `prisma/migrations/0003_project_task_lifecycle/migration.sql`, generated Prisma output | Schema/client compatibility and migration replay were not verified; user explicitly forbids Prisma CLI and database commands. | No generation or migration was run. Existing custom fields continue to be accessed via parameterized SQL. This is a tracked external verification item, not represented as fixed. | No offline regression can establish generated-client/schema compatibility. | **Yes / Prisma CLI against approved scratch configuration**; remains pending authorization and fresh verification. |

### Minor findings

| Status | Severity / exact location | Root cause | Correction or disposition | Regression test | PostgreSQL required? |
|---|---|---|---|---|---|
| [x] | Minor — `prisma-project-task-store.ts`: `listTaskDependencies` | History includes removed edges and has no active-only filter. | Kept behavior because endpoint is explicitly “dependency history”; clients distinguish lifecycle state using `removedAt`. This is documented in this remediation; no new filter/API policy was added. | Existing scheduling tests verify removed edges are excluded from active graph; no history filter is claimed. | No for documented contract; **yes** to verify DB row history. |
| [x] | Minor — `src/api/app.ts`: `setErrorHandler` | Most codes defaulted to 409, including internal graph/persistence errors. | Added explicit 400/403/404/409 mappings; graph diagnostics use 500 with stable graph error code, invariant/unexpected errors use generic 500 responses. Raw SQL/provider messages are not returned or logged. | `src/api/app.spec.ts`: graph and invariant error responses; existing stale-version API test. | No for mapping; **yes** for DB error source behavior. |

## Cross-cutting remediation

- All Project, Task, Dependency, Assignment, and Scheduling mutation paths were re-read. Writes inside mutation callbacks use the callback transaction client; no root Prisma client fallback was introduced. `unassignTask` retains its scoped pre-read outside the transaction only to identify the target membership lock, then re-reads and locks the assignment in the transaction before updating it.
- Raw SQL remains built with `Prisma.sql`; request values are bound parameters. The store now checks one-row updates and assignment release counts where exactly one/all selected rows are required.
- Optimistic task updates still compare `expectedVersion` in both the precondition and `updateMany` predicate. A stale version rejects with `TASK_VERSION_CONFLICT` before update.
- Prisma `P2002` and raw SQL `P2010`/`23505` uniqueness failures are translated contextually to `DEPENDENCY_EXISTS` or `ASSIGNMENT_EXISTS`; corresponding FK failures map to scoped `TASK_NOT_FOUND`. Other database exceptions propagate and are returned only as generic internal errors by the API.
- Graph revision remains unchanged for assignment-only and project metadata changes. Archive assignment cleanup does not increment graph revision. Task creation/deletion, dependency add/remove, and changed PERT estimates retain their existing revision rules.
- Frozen Graph Engine files were not modified. Identity/authentication files were not modified.

## Files modified

- `src/modules/projects/infrastructure/prisma-project-task-store.ts`
- `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts` (new)
- `src/modules/projects/domain/errors.ts`
- `src/modules/projects/application/project-task.service.ts`
- `src/api/app.ts`
- `src/api/app.spec.ts`
- `PROJECT_STATUS.md`
- `IMPLEMENTATION_ROADMAP.md`
- `ARCHITECTURE_DECISIONS.md`
- `SECURITY_CHECKLIST.md`
- `TESTING_STRATEGY.md`
- `KNOWN_LIMITATIONS.md`
- `PHASE_1C_REMEDIATION.md` (new)

## Verification

- `npm run test:offline`: **passed**, 29 test files and 192 tests. This command excludes `src/infrastructure/database/schema.integration.spec.ts`.
- `npm run build`: **passed** (`tsc`).
- `npm run build:web`: **passed** (TypeScript check and Vite production build).
- An earlier focused run of the adapter and API specs passed 23 tests; the full offline run above includes those tests and is authoritative.
- No PostgreSQL connection, Prisma CLI, migration, database integration test, Docker command, container/volume change, protected port access, or Graph Engine edit is part of this remediation.

## Remaining PostgreSQL-only checks

- Replay migrations from empty PostgreSQL 16 scratch DB and inspect indexes/check constraints and generated Prisma compatibility.
- Verify actual database rollback for ActivityLog, OutboxEvent, graph revision, assignment-release, and post-write failure paths.
- Verify composite tenant foreign keys, partial unique indexes, trigger arithmetic, exact SQL column/table names, and affected-row result semantics.
- Exercise concurrent task updates, dependency edits, assignment creation/unassignment, archive, task deletion, membership deactivation, and schedule snapshots under real locks.
- Confirm deterministic schedule reads against trigger-computed expected-hour values.

These checks require separate authorization and an independently verified disposable scratch target. This remediation does not authorize database testing and does not begin Phase 1D.
