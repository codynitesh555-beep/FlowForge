# Phase 1C.4 — Membership Assignment Event Consistency

## Result

Membership deactivation now records each released assignment using the existing `assignment.removed` ActivityLog and OutboxEvent convention. Assignment selection, release, actor snapshot lookup, and event writes all use the existing transaction client. The API now returns safe 400 and 404 responses for malformed JSON and unmatched routes. Phase 1C is **not** marked PASS, and database behavior remains unverified.

## Exact files changed

- `src/modules/identity/application/contracts.ts`
- `src/modules/identity/application/membership-lifecycle.service.ts`
- `src/modules/identity/infrastructure/prisma-membership-lifecycle.ts`
- `src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts` (new)
- `src/api/app.ts`
- `src/api/app.spec.ts`
- `PHASE_1C_4_REMEDIATION.md` (this report)

No schema or migration file, Docker configuration, `.env`, or Graph Engine file was changed.

## Membership release behavior

`MembershipLifecycleUnitOfWork.releaseAssignmentsForMembership` now receives the authenticated `OrganizationPrincipal`, allowing the adapter to use the same actor snapshot convention as project/task events. The service calls it only during an active-to-non-active membership transition ([membership-lifecycle.service.ts:45-48](src/modules/identity/application/membership-lifecycle.service.ts#L45)).

The adapter selects active assignments using organization and membership predicates, orders and locks them by assignment ID, and returns without event writes when none are active ([prisma-membership-lifecycle.ts:70-83](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L70)). It conditionally releases only the selected IDs and rejects if the affected-row count differs from the locked set ([prisma-membership-lifecycle.ts:84-88](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L84)). For each selected row, it writes an ActivityLog and OutboxEvent with `assignment.removed`, aggregate type `assignment`, the assignment ID, actor display-name snapshot, and payload fields `projectId`, `taskId`, `membershipId`, `userId`, and `reason: membership_deactivated` ([prisma-membership-lifecycle.ts:90-113](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L90)). The method is called through the existing membership transaction adapter ([prisma-membership-lifecycle.ts:117-123](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L117)). A failed write propagates and rejects the transaction callback.

This follows the established project/task convention: archive and soft-delete also use `assignment.removed`, an `assignment` aggregate, and payload context with a lifecycle reason ([prisma-project-task-store.ts:230-249](src/modules/projects/infrastructure/prisma-project-task-store.ts#L230), [prisma-project-task-store.ts:353-364](src/modules/projects/infrastructure/prisma-project-task-store.ts#L353)). No lock ordering was changed: the membership lifecycle still locks organization, membership IDs, then assignment IDs.

## API boundary behavior

Malformed JSON errors with the recognized Fastify parser codes return `{ code: "INVALID_REQUEST" }` with status 400; unmatched routes return `{ code: "NOT_FOUND" }` with status 404 ([app.ts:117-123](src/api/app.ts#L117), [app.ts:165](src/api/app.ts#L165)). Existing diagnostic allowlists were not changed. Tests use `createApiApp()` and `Fastify.inject()` and assert status and generic response bodies ([app.spec.ts:79-97](src/api/app.spec.ts#L79)).

## Added test evidence

The new adapter spec wires the concrete membership service to `PrismaMembershipLifecycleTransactions` and a small fake transaction client. It asserts observable assignment, ActivityLog, and OutboxEvent state.

- `releases one active assignment and writes matching audit and outbox records`: asserts the released row, actor snapshot, action/event type, aggregate, and full payload.
- `writes one event pair for each of multiple active assignments in ID order`: asserts one record of each kind per assignment in sorted order.
- `writes no assignment events when there are no active assignments`: asserts both event collections remain empty.
- `does not duplicate release events for assignments already released`: verifies an already released row is untouched and creates no event.
- `does not emit duplicate assignment release events when deactivation is repeated`: calls deactivation twice and verifies only one event pair exists.
- `rejects and rolls back fake state when the activity event write fails` and `...outbox event write fails`: assert rejection and unchanged observable fake state.

Existing membership service tests continue to cover the transition call, last-active-owner rejection, active-to-active changes, and missing organization behavior (`membership-lifecycle.service.spec.ts`). Existing project/task store tests for archive and task deletion were included in the focused and full offline runs; their assertions still cover assignment history and event writes ([project store spec archive assertions](src/modules/projects/infrastructure/prisma-project-task-store.spec.ts#L242), [soft-delete assertions](src/modules/projects/infrastructure/prisma-project-task-store.spec.ts#L535)).

These fakes prove application control flow and the expected call/data shape only. They do **not** prove PostgreSQL rollback, row locking, transaction isolation, SQL execution, or concurrency behavior.

## Commands and results

`package.json` was inspected first. `test:offline` runs Vitest while excluding `src/infrastructure/database/schema.integration.spec.ts`; `build` runs TypeScript compilation. No database-dependent test was selected.

- `npm run test:offline -- src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts src/modules/identity/application/membership-lifecycle.service.spec.ts src/api/app.spec.ts src/modules/projects/infrastructure/prisma-project-task-store.spec.ts` — passed, 4 test files, 68 tests.
- `npm run test:offline` — passed, 30 test files, 230 tests; schema integration spec excluded by the script.
- `npm run build` — passed (`tsc`).

## Remaining limitations

- PostgreSQL rollback and event atomicity are not verified; the fake only restores its own state on rejected callbacks.
- SQL alias mapping, affected-row behavior, row-lock ordering, and interaction with concurrent assignment writers require isolated scratch-database verification.
- The recognized malformed JSON Fastify error codes are covered by the focused API test for the installed project dependency set; other framework-generated errors retain their existing handling unless explicitly mapped.
- No Phase 1D work was started. Phase 1C remains subject to independent audit and database verification.

## Safety confirmation

No PostgreSQL connection, Prisma CLI command, migration, schema synchronization, database integration test, Docker/Compose command, `.env` inspection, or Graph Engine operation occurred. No Phase 1D work was started. No database behavior is claimed as verified.
