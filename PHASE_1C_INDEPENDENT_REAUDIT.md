# Phase 1C Independent Source-Level Re-Audit

## 1. Executive Summary

This review independently inspected the original Phase 1C audit, remediation and evidence reports, the current project/task store and its new fake-client specification, application service and API error boundary, membership lifecycle implementation, Prisma schema and hand-authored migrations, and the six project status/architecture documents. No test, build, database, Prisma CLI, or Docker command was run. No source file was changed.

The remediation materially improves the source: post-write invariant failures throw, archive attempts to release active assignments and record history in the same transaction, selected expected constraint errors map to stable domain errors, and API graph diagnostics are kept out of client responses. The new store spec exercises real store control flow with fakes. It does not implement rollback semantics: the harness only records whether the callback resolved, and its fake state is not reverted. It also aliases root and transaction delegates, so its propagation assertion cannot detect accidental root-client use. Several important mutation paths and graph-revision rules remain without direct adapter tests.

**Overall verdict: PARTIAL. Recommendation: NOT READY for Phase 1D.** Static source review did not establish a newly introduced critical tenant escape, but meaningful transaction, Prisma/migration, PostgreSQL locking, constraint, and runtime behavior remains unverified. This report does not authorize database testing.

## 2. Final Verdict

**PARTIAL** — the code-level remediation is present and selected control-flow paths have credible offline coverage, but rollback and transaction-client propagation are not demonstrated by the fake harness, multiple persistence paths lack direct tests, and PostgreSQL/Prisma runtime compatibility is explicitly unverified. No `PASS` is assigned to a claim that depends on actual database semantics.

## 3. Scope and Safety Boundaries

Read-only inspection only. No additional commands/tests that could use database configuration were run. No PostgreSQL connection, Prisma CLI, migration, Docker operation, Graph Engine edit, source change, or Git metadata assumption was made. Earlier verification figures below are attributed to existing project documentation, not presented as independently rerun results.

## 4. Original Findings — Finding-by-Finding Reassessment

The original findings are taken from `PHASE_1C_AUDIT.md`; the remediation claims are cross-checked against current source and tests rather than accepted from `PHASE_1C_REMEDIATION.md` or `PHASE_1C_REMEDIATION_EVIDENCE.md`.

| Original finding / severity | Current implementation evidence | Test evidence and whether demonstrated | Remaining gap | Verdict |
|---|---|---|---|---|
| No concrete executable persistence-adapter coverage — **Major** | `src/modules/projects/infrastructure/prisma-project-task-store.ts`: concrete store methods; notably `updateTask` 292–335, `softDeleteTask` 338–371, `archiveProject` 217–251, `addDependency` 389–435, `removeDependency` 438–461, `assignTask` 475–505, `unassignTask` 507–535. | `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts`: post-write update/project/delete cases 101–140; creation event/revision failures 142–168; archive cases 170–239; stale version 241–247; scoped lock case 249–261; missing organization 263–270; duplicate edge and assignment errors 272–306. These do invoke the concrete store. **Partly demonstrated** for these mocked control-flow branches, not real adapter/database semantics. | No direct store cases for successful PERT update/revision exactly once, assignment-only revision unchanged, removeDependency, assign/unassign success and failure, soft-delete with active assignments/history events, cross-tenant negative predicates across every operation, or Graph Engine-to-API path. | **PARTIAL** |
| `updateTask` / `softDeleteTask` missing post-write row could allow commit of a partial logical operation — **Major** | `updateTask` now throws `PERSISTENCE_INVARIANT_VIOLATION` on missing post-write task at store 325–327. `softDeleteTask` does so after revision and event preparation at 367–369. Their enclosing `withTransaction` callbacks reject on throw. | Same spec, update 101–110 and soft-delete 127–140, configures the post-write read to return null and expects rejection; soft-delete also asserts the revision raw operation was reached and no domain event was emitted. **The throw/rejection control flow is demonstrated. Actual rollback is not.** | Harness does not undo mock writes on callback rejection; it only sets `rolledBack`/`committed`. Soft-delete test uses no active assignments, so assignment-release/history rollback is not covered. Database rollback behavior remains unverified. | **PARTIAL** |
| Graph Engine error details were discarded before service/API — **Moderate** | `activeGraphIn` catches graph-build exceptions and returns generic `INVALID_PROJECT_GRAPH` at store 153–160. At the application boundary, schedule analysis preserves graph diagnostic code in `details.graphCode` at `src/modules/projects/application/project-task.service.ts` 108–127. API handling logs only safe code and responds with generic 500 at `src/api/app.ts` 106–110. Dependency-cycle errors are also mapped at store 401–405. | `src/api/app.spec.ts` 180–192 checks generic response for a mocked graph error; scheduling unit tests cover Graph Engine adapter errors, but they do not execute the complete Prisma-store → service → API flow. **Response non-disclosure is demonstrated for a mocked error; diagnostic preservation/logging and end-to-end mapping are not fully demonstrated.** | Graph-builder exceptions intentionally lose their more specific diagnostic at the store catch. No assertion verifies the logger receives the safe subcode, nor an integration-style offline test traverses actual service/API mapping from the store. | **PARTIAL** |
| Archived project could retain active assignments without a cleanup path — **Moderate** | `archiveProject` in store 217–251 locks the project, archives it if needed, locks active assignment rows ordered by ID, marks them unassigned, emits assignment removal events and emits project archive event only on first archive. Repeated archive attempts repair residual assignments. Service blocks normal writes on archived projects while this cleanup path remains available. | Store spec 170–187 asserts assignment update predicate, events and reason; 189–204 checks repeated archive avoids duplicate project event; 206–221 checks count mismatch rejects; 223–239 checks event failure rejects. **The intended calls and rejection control flow are demonstrated with fakes, not atomic commit/rollback.** | No PostgreSQL proof of `FOR UPDATE`, row counts, isolation, uniqueness, or rollback. The fakes do not revert assignment/event arrays after rejection. | **PARTIAL** |
| Generated Prisma Client, schema and migration compatibility unverified — **Moderate** | `prisma/schema.prisma` 80–154 contains `Project.archivedAt`, `TaskDependency.removedAt`, composite relations. `prisma/migrations/0003_project_task_lifecycle/migration.sql` supplies additive fields/indexes. Store uses raw SQL for custom fields because generated artifacts were not regenerated (documented in `KNOWN_LIMITATIONS.md` 7–12). | No allowed or existing evidence inspected in this pass demonstrates generated-client/migration compatibility against PostgreSQL. Documentation explicitly says it is unverified. | Need independently authorized disposable scratch-database migration replay and narrowly scoped adapter verification; none is performed or authorized here. | **NOT VERIFIED** |
| Dependency history listing includes removed rows — **Minor** | `listTaskDependencies` in store 463–473 deliberately queries history; callers can distinguish by `removedAt`. Active graph query at 142–161 filters removed edges. | No adapter test specifically asserts both historical visibility and active graph exclusion. Scheduling tests exercise exclusion at pure adapter level. | Add a store test if history endpoint behavior is contractually important; verify SQL against migration later. No evidence this is a defect under documented history-retention decision. | **PASS** for documented disposition only; DB behavior remains unverified |
| Many `ProjectTaskError` codes defaulted to conflict status — **Minor** | Error handler `src/api/app.ts` 94–139 has explicit 400/404/403/409 mapping; invariant and graph errors become generic 500; unexpected failures do not become success or not-found. | `src/api/app.spec.ts` 151–166 tests stale task version → 409; 180–206 tests graph and persistence invariant generic response. Duplicate domain mappings are tested at store fake level 272–306, not all HTTP mappings. **The principal changed branches are demonstrated; exhaustive mapping is not.** | Add table-driven API coverage for each stable domain code and ensure logger behavior is checked without including database details. | **PASS** for the original mapping defect’s disposition; broader branch coverage incomplete |

## 5. Transaction and Rollback Analysis

`withTransaction` in `src/infrastructure/database/transaction.ts` 8–10 delegates to Prisma `$transaction` and passes the callback’s transaction client. Project/task store mutation methods call it and pass `tx` into transactional queries and event creation. `writeProjectDomainEvent` at store 45–68 writes the ActivityLog and OutboxEvent through the supplied transaction client; errors are not caught there. Revision failures and row-count mismatches throw, so the callback rejects.

The source-level intended atomicity is credible for paths inspected: mutation, graph revision where relevant, ActivityLog and OutboxEvent share the callback. Archive assignment updates and removal events also share it. This is **not equivalent to demonstrated rollback**. In the new spec, `harness` at `prisma-project-task-store.spec.ts` 35–97 records a `committed` or `rolledBack` boolean after the callback settles, but does not snapshot/restore fake delegates. An ActivityLog failure after an assignment update leaves that fake update observable; the test checks callback rejection, not state rollback. The root `task` and `taskAssignment` delegate objects are aliases of transaction delegates at 78–91; tests therefore cannot distinguish a mistaken root-client write from a transaction-client write.

`unassignTask` (store 507–535) performs a root-client read before the transaction to discover which membership to lock. That read is non-mutating; all subsequent lifecycle writes and event writes use `tx`. This is a deliberate read-before-lock boundary, but the adapter test suite does not exercise the race between that lookup and the transaction. The membership lifecycle separately serializes through organization and sorted membership locks (`src/modules/identity/infrastructure/prisma-membership-lifecycle.ts` 19–45, 56–93); its application spec (`src/modules/identity/application/membership-lifecycle.service.spec.ts` 39–71) checks orchestration order and last-owner rejection with fakes, not database concurrency.

## 6. Tenant Isolation Analysis

The service derives tenant scope from the authenticated principal and forwards it to store calls (`src/modules/projects/application/project-task.service.ts` 18–185). Project/task read predicates include organization and project scope (store 181–197, 279–290). Mutation paths similarly scope project and task operations; assignment membership lookup checks the organization, user and active status; dependency endpoints are checked as active tasks within the same project and organization (store 389–435).

The Prisma schema preserves composite tenant relationships: `prisma/schema.prisma` 62–77 (Membership), 80–95 (Project), 97–120 (Task), 123–137 (TaskDependency), 140–154 (TaskAssignment). Dependency endpoints carry task ID, project ID and organization ID; assignments relate to both tenant-scoped task and membership. Those are static safeguards, not proof that the hand-authored SQL and live constraints match.

The fake spec's tenant case at 263–270 verifies that a missing organization row stops a task update, and the lock test at 249–261 inspects one organization parameter. It does not systematically test a foreign-tenant identifier against every read/write method or prove database composite-FK enforcement. No concrete cross-tenant mutation path was established in inspected source; full tenant isolation is **not runtime verified**.

## 7. Locking and Concurrency Analysis

Store actor lock order is organization `FOR SHARE`, memberships in ID order `FOR SHARE`, then project advisory lock, then project row `FOR UPDATE` (`store.ts` 70–101). `activeGraph` obtains the advisory lock before project/graph reads (374–387). Graph mutations call `lockProject` before graph reads. The membership lifecycle takes organization `FOR UPDATE`, sorted membership rows, then assignment release (membership adapter 19–45, 56–83). The organization row provides a static serialization gate between membership lifecycle changes and project assignment operations.

The current store test 249–261 checks organization before advisory/project locking on a create-task path, not the complete membership/advisory/project ordering on every mutation, nor cross-module deadlock behavior. `unassignTask` also discovers target membership before entering its transaction (store 507–516). Whether races and all transaction-client lock semantics behave as intended requires scratch PostgreSQL tests.

Task `version` predicates and stale-version prechecks are present in `updateTask` and `softDeleteTask` (store 300–321, 345–356). The fake test at 241–247 proves stale input does not issue updateMany. It does not test a concurrent version change between pre-read and conditional write, or the affected-row conflict path. Those are not proven by the precheck test.

## 8. Graph Revision and Scheduling Analysis

Static increment call sites are task create (store 269), PERT-changing task update only (329), soft-delete (365), dependency add (430), and dependency removal (455). Project metadata changes (199–215) and assignment lifecycle changes (475–535) do not increment graph revision. This matches the documented rule in `ARCHITECTURE_DECISIONS.md` 24 and `IMPLEMENTATION_ROADMAP.md` 41–43.

Scheduling adapter filters soft-deleted tasks and removed/deleted-endpoint edges (`src/modules/projects/infrastructure/scheduling.ts` 16–45); active graph SQL filters tenant/project/active lifecycle (`store.ts` 142–161). Arrays are sorted before service DTO output (`project-task.service.ts` 118–127). Frozen Graph Engine is consumed but not modified.

The new Prisma store spec checks a revision write failure on task creation and that task deletion reaches revision work before the post-write invariant failure (spec 127–168). It does **not** assert revision increments exactly once for each graph mutation, nor assert assignment-only mutations do not increment it. Pure scheduling tests do not validate SQL snapshots or transaction revision semantics. Runtime revision and scheduling persistence behavior remains unverified.

## 9. Archive and Assignment Lifecycle Analysis

Archive uses a project lock, sets `archivedAt`, then selects active assignments for the scoped project `FOR UPDATE`, ordered by ID; it updates selected rows, checks the count, writes removal events, and writes the project archive event (store 217–251). Repeated archive still checks and repairs residual active assignments while avoiding duplicate project archive events. This sequencing is atomic in the source callback if the underlying Prisma transaction works as expected.

The corresponding fake tests verify statement arguments and event intent, but the rejection case does not undo prior fake updates. Task soft-delete also releases assignments and emits events (store 352–364), but the new soft-delete test has no active assignment fixture. Assignment create/unassign implementations are present (store 475–535), but are not directly exercised by the new adapter spec. Membership deactivation releases assignments in its lifecycle adapter (membership adapter 56–83), with only orchestration-level fake tests.

No contradictory lifecycle transition was established statically. Actual partial unique index, lock/race and cascade behavior remain unverified against PostgreSQL.

## 10. API and Error Handling Analysis

Routes require a resolved principal and use strict request schemas (`src/api/project-task-routes.ts` 65–75 and route definitions 79–186). Organization identity is resolved from the principal/route context; mutation bodies do not authorize caller-supplied tenant identity. Service role checks precede mutation calls (`project-task.service.ts` 18–107).

The API error handler maps graph and persistence invariant errors to generic internal responses and logs only a whitelisted safe diagnostic (`src/api/app.ts` 36–43, 94–139). It does not return SQL messages. The API specs at 180–206 assert generic body shape for mocked graph/invariant errors. They do not prove logger redaction with actual Prisma error objects. Unknown errors map to generic internal error, not success or not-found.

`prisma-project-task-store.ts` 113–123 translates selected Prisma unique/FK codes and raw SQLSTATEs. `addDependency` handles duplicate/FK conditions (store 420–435); assignment creation handles unique/FK conditions (496–505). New tests at 272–306 use synthetic P2010/P2002 errors and assert stable domain codes. These test translator branches, not driver adapter error shape. Duplicate error mapping across every possible Prisma 7 adapter representation is unverified.

## 11. Schema and Migration Static Review

`prisma/schema.prisma` 62–154 defines the relevant tenant-scoped relations and uniqueness. `prisma/migrations/0001_initial_foundation/migration.sql` creates foundational tables, constraints and PERT trigger; `prisma/migrations/0003_project_task_lifecycle/migration.sql` adds archive/removal lifecycle fields and the partial active-edge uniqueness. The migration code is hand-authored and no database replay was performed. The generated Prisma client was not regenerated, with raw SQL used for the newer fields (`KNOWN_LIMITATIONS.md` 7–12).

No runtime claim is made about PostgreSQL syntax, trigger calculations, decimal behavior, Prisma 7 raw result mapping, `FOR UPDATE` behavior, constraint name/code delivery, or transaction rollback. Those require the separately authorized isolated scratch database work described in `TESTING_STRATEGY.md` 45–49 and `SECURITY_CHECKLIST.md` 67–77.

## 12. Test Coverage and Test-Harness Limitations

The new store spec uses Vitest mocks as fake Prisma delegates; it invokes concrete `PrismaProjectTaskStore` methods, which is materially stronger than service-only mocks. Its concrete assertions include:

- Missing post-write task/project rows reject (`prisma-project-task-store.spec.ts` 101–140).
- Project creation ActivityLog/Outbox errors reject and task creation revision error rejects (142–168).
- Archive release arguments, event payloads, repeated archive behavior, row-count mismatch and event failure (170–239).
- Stale version precheck and selected lock order/tenant parameter (241–270).
- Duplicate edge and assignment unique/FK translation (272–306).

The central limitation is the harness itself (35–97): callback rejection sets a boolean named rollback, but there is no rollback model; fake writes persist in arrays. Root and transaction delegates alias the same mock objects. Therefore tests establish promise rejection and selected call order, not rollback or transaction propagation. Also absent are direct tests for remove/unassign paths, successful revision cardinality, assignment-only revision invariance, nonempty soft-delete assignment release, full tenant-negative matrix, actual Graph Engine/API end-to-end behavior, and concurrent optimistic conflict.

Existing project documentation reports `npm run test:offline` as 29 files/192 tests and backend/frontend builds as passing (`PROJECT_STATUS.md` 57–65; `TESTING_STRATEGY.md` 5–11). These are recorded historical results; they were not rerun in this audit. Database integration tests were explicitly excluded/placeholder per the same documents.

## 13. Documentation Consistency

The six project documents mostly describe the database and fake-client limitations accurately: `PROJECT_STATUS.md` 38–49, 57–73; `IMPLEMENTATION_ROADMAP.md` 54–63; `ARCHITECTURE_DECISIONS.md` 50–55; `SECURITY_CHECKLIST.md` 48–51, 67–77; `TESTING_STRATEGY.md` 36–49; `KNOWN_LIMITATIONS.md` 17–25, 48–55.

Two inconsistencies need correction:

1. `KNOWN_LIMITATIONS.md` 30–33 says project/task flows remain to be built, while `PROJECT_STATUS.md` 51–55 and `IMPLEMENTATION_ROADMAP.md` 64–66 say the project/task frontend surface is implemented.
2. `IMPLEMENTATION_ROADMAP.md` 68–74 lists active membership validation, lock ordering and assignment history as Phase 1D work, while `ARCHITECTURE_DECISIONS.md` 21 and `SECURITY_CHECKLIST.md` 43–50 state these are implemented in current assignment/membership lifecycle paths. Phase 1D may still extend assignment/resource planning, but the remaining scope should be stated without implying those foundational behaviors are absent.

## 14. Confirmed Defects

No new critical or major source defect was conclusively established within this static, restricted review. Confirmed evidence gaps (not assertions of runtime defects) are:

- The fake transaction harness cannot prove rollback or detect root-client leakage (`prisma-project-task-store.spec.ts` 35–97).
- Several mutation paths and exact graph revision rules lack store-level test coverage (store 389–535; spec 101–306).
- Two documentation statements conflict as listed above.

## 15. Remaining Risks and NOT VERIFIED Items

- Migration replay and schema/client compatibility, including Phase 1B/1C raw SQL fields.
- Actual PostgreSQL atomic rollback on ActivityLog, OutboxEvent, revision, row-count and assignment lifecycle failures.
- Advisory/row lock acquisition, lock ordering across modules, deadlocks, last-active-owner races and assignment lifecycle races.
- Prisma 7 adapter error shapes and constraint-to-domain translation under real driver errors.
- Partial unique index and tenant composite FK enforcement.
- PERT trigger calculations, numeric precision/overflow and consistency with application writes.
- Graph revision exactly-once semantics under concurrent operations and scheduling read consistency.
- API logger redaction under real persistence exceptions.
- The historical test/build evidence was not independently rerun in this audit.

## 16. Prioritized Remediation Plan

1. Strengthen offline adapter fakes so transaction and root delegates are distinct and fake transactional state is reverted on rejection; assert observable state, not only callback rejection.
2. Add concrete store tests for `removeDependency`, `assignTask`, `unassignTask`, soft-delete with active assignment history, successful PERT update, one revision increment per graph mutation, and no revision increment for assignment-only mutation.
3. Add a full offline error-boundary test proving safe diagnostic logging and generic API responses for representative Prisma/Graph Engine failures.
4. Align `KNOWN_LIMITATIONS.md` and `IMPLEMENTATION_ROADMAP.md` with current frontend and membership/assignment implementation state.
5. After separate explicit authorization, run migration replay and focused adapter/concurrency checks only against a verified disposable scratch PostgreSQL target. Keep that work distinct from this audit; this report grants no authorization.

## 17. Phase 1D Readiness Decision

**NOT READY for Phase 1D.** The source remediation is substantial but the independent review remains PARTIAL because the key rollback and client-propagation claims are not demonstrated by current fakes, important adapter paths remain untested, and database semantics are unverified. Complete the offline evidence gaps and obtain a fresh independent review. Database verification remains a separate owner-authorized stage. Do not interpret this report as approval to connect to any database.

### Inspected files

`PHASE_1C_AUDIT.md`; `PHASE_1C_REMEDIATION.md`; `PHASE_1C_REMEDIATION_EVIDENCE.md`; `src/modules/projects/infrastructure/prisma-project-task-store.ts`; `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts`; `src/modules/projects/infrastructure/scheduling.ts`; `src/modules/projects/application/project-task.service.ts`; `src/modules/projects/domain/errors.ts`; `src/infrastructure/database/transaction.ts`; `src/api/app.ts`; `src/api/app.spec.ts`; `src/api/project-task-routes.ts`; `src/modules/identity/infrastructure/prisma-membership-lifecycle.ts`; `src/modules/identity/application/membership-lifecycle.service.spec.ts`; `prisma/schema.prisma`; `prisma/migrations/0001_initial_foundation/migration.sql`; `prisma/migrations/0003_project_task_lifecycle/migration.sql`; `PROJECT_STATUS.md`; `IMPLEMENTATION_ROADMAP.md`; `ARCHITECTURE_DECISIONS.md`; `SECURITY_CHECKLIST.md`; `TESTING_STRATEGY.md`; `KNOWN_LIMITATIONS.md`.
