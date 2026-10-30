# Phase 1C.3-A Offline Persistence Evidence Remediation

## Result

Implemented the requested offline evidence improvements in the Prisma project/task store spec. The fake now separates root-client delegates from transaction-client delegates, keeps writes in a transaction-local draft, commits that draft only on callback success, and discards it on rejection. New concrete store tests cover dependency removal, assignment/unassignment, task deletion with active assignments, graph revision rules, and a version race at the conditional update.

The evidence is limited to the store's control flow against this deterministic fake. It does **not** prove PostgreSQL rollback, locks, isolation, constraint enforcement, Prisma adapter behavior, or concurrency correctness.

## Exact files changed

- `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts`
- `PHASE_1C_3A_REMEDIATION.md`

No source implementation, schema, migration, Graph Engine, or other project file was modified.

## Harness changes

The helper in `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts:35-172` now models observable fake state for task/project writes, assignments, dependency removals, revision increments, ActivityLog writes, and OutboxEvent writes.

- Root delegates and transaction delegates are separately constructed objects. Root mutation delegates fail immediately with an explicit error; the root assignment lookup remains available for `unassignTask`'s documented read-before-transaction membership discovery.
- Each `$transaction` call clones the committed fake state into a draft. On callback resolution it replaces committed state with the draft; on rejection it leaves committed state unchanged and clears the active draft.
- Assertions inspect `committedState()` arrays, so failure tests check absence of observable committed mutation/history/revision rather than a rollback boolean.
- The existing lock/client test asserts root and transaction task delegates are distinct, the transactional create/event delegates were used, and root write delegates were not called.

This is a deliberately small operation ledger, not an in-memory PostgreSQL implementation. It does not model SQL semantics, actual row values, concurrent transactions, isolation levels, or database-side triggers/constraints. Its rollback behavior is the helper's own draft-discard rule and cannot establish that a real database transaction will roll back.

## Tests added

All added tests invoke concrete `PrismaProjectTaskStore` methods.

| Test name(s) | Evidence provided by the fake |
|---|---|
| `commits dependency removal, one graph revision and both domain events` (`:383`) | A returned active edge leads to a committed removal marker, exactly one fake revision increment, and ActivityLog/OutboxEvent records. |
| `returns null for a missing or already removed dependency without changing revision or events` (`:398`) | Empty conditional-update result yields `null`; no committed removal, revision, or event state. |
| `discards dependency removal, revision and events when ActivityLog fails` / `...when OutboxEvent fails` (`:407`, parameterized) | A later required event failure leaves committed removal/revision/event state empty. |
| `commits an assignment for an active same-tenant member without changing graph revision` (`:424`) | Assignment result fields and event records are committed; revision remains unchanged. |
| `rejects inactive or cross-tenant assignment targets before project/task writes` (`:438`) | Inactive target is rejected; missing target from the organization-scoped membership query is rejected; no assignment create is observed. The query contains the actor organization parameter. |
| `rejects an already active assignment without adding another row` (`:457`) | Existing active assignment produces `ASSIGNMENT_EXISTS`; no create is committed. |
| `discards an assignment when either required event write fails` (`:471`) | Outbox failure rejects and leaves assignment and event state uncommitted. |
| `unassigns through the transaction client after a root-client membership lookup` (`:486`) | Root client performs only initial assignment lookup; transaction client performs release and both event writes; history is committed and graph revision is unchanged. |
| `returns null for missing or repeated unassignment without writing history` (`:508`) | Missing initial row avoids a transaction; an already-released/missing locked row causes no update/history. |
| `discards unassignment history when a required event fails` (`:519`) | Outbox failure after update leaves no committed release or event state. |
| `releases active task assignments, retains history events and advances graph revision once on soft delete` (`:535`) | Two active assignment fixtures are released; two removal events plus task-deleted events are persisted; one task update and one revision increment are recorded. |
| `discards task deletion, assignment release, revision and event state when an assignment event fails` (`:559`) | Event failure leaves the task update, assignment release, revision and both event ledgers absent from committed fake state. |
| `increments graph revision once for a successful PERT update and not for metadata-only updates` (`:574`) | Successful PERT change records one increment; name-only task update records none. |
| `maps a version race at the conditional update to TASK_VERSION_CONFLICT and discards fake writes` (`:588`) | Simulated `updateMany` affected-row count zero after a matching pre-read maps to `TASK_VERSION_CONFLICT`; no task update or event state commits. |

Existing tests were retained and updated to assert committed fake state where they previously relied on the old `committed`/`rolledBack` flags. They continue to cover post-write missing rows, project/task creation failure paths, archive cleanup and failure, stale pre-read versions, selected tenant/lock query parameters, and duplicate/FK error translation.

## Commands run and results

The package scripts were inspected first. `test:offline` is `vitest run --exclude src/infrastructure/database/schema.integration.spec.ts`; the excluded file contains only skipped/todo integration cases. The Vitest config discovers specs/tests and does not configure database setup. `build` is `tsc`.

- `npm run test:offline -- src/modules/projects/infrastructure/prisma-project-task-store.spec.ts` — **passed**, 1 test file, 30 tests.
- `npm run test:offline` — **passed**, 29 test files, 207 tests.
- `npm run build` — **passed**, TypeScript compilation.

The first focused test run exposed two errors in the new fake fixture behavior; the harness and affected fixture were corrected, and the focused spec and full offline suite then passed. No test was skipped within the reported offline run; the database integration spec was excluded by the confirmed script.

## Safety confirmation

No database connection, PostgreSQL command, Prisma CLI, migration, `db push`, database integration test, Docker operation, `.env` inspection, or Graph Engine operation occurred. No Phase 1D or Phase 1C.3-B work was started.

## Remaining gaps and limitations

- The fake does not prove PostgreSQL rollback, row locks, advisory locks, deadlock behavior, isolation, or concurrent last-writer behavior.
- No scratch-database migration replay, composite-FK/partial-index enforcement, trigger behavior, or Prisma 7 adapter verification was performed.
- The fake tracks operation records rather than maintaining a relational state model. It verifies transaction boundary control flow and event/revision write intent only.
- Optimistic concurrency is tested with an affected-row count of zero after pre-read; no true concurrent database transaction is simulated.
- The tests cover requested assignment/dependency lifecycle outcomes but cannot prove SQL predicates or constraints match the live schema.

Phase 1C remains subject to a fresh independent audit. This remediation does not mark Phase 1C as PASS and does not authorize database testing or Phase 1D.
