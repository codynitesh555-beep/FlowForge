# FlowForge — Final Consolidated Phase 1C Audit

## Verdict

- **SOURCE-LEVEL PHASE 1C: PASS**
- **DATABASE VERIFICATION: PENDING / NOT VERIFIED**

The reviewed current source implements the Phase 1C mutation, tenant-scoping, event-write, and API error-handling intentions, including Phase 1C.4 membership-deactivation assignment events. F-1's test-harness gap has since been addressed: membership status is tracked in transaction-local state, and event-failure tests assert the complete modeled state remains unchanged. The reported focused offline run passed. This is a source-level PASS only. It is not a claim of runtime database correctness: PostgreSQL, Prisma adapter execution, transaction isolation, actual rollback, locks, constraints, migration replay, generated Prisma Client compatibility, and concurrency remain unverified.

## Evidence labels

- **SOURCE VERIFIED** — confirmed by reading current source; it describes intended control flow and SQL predicates, not database execution.
- **OFFLINE TEST REPORTED** — a test and prior reported run exist; this audit did not run tests. Fake-backed tests verify only their modeled behavior.
- **NOT VERIFIED (requires authorized PostgreSQL testing)** — cannot be established without a separately authorized, isolated database run.

No tests, builds, database commands, Prisma CLI, migrations, Docker/Compose commands, or `.env` inspection were performed for this audit. Only this report was created.

## Findings

### F-1 — Membership event-failure test omitted membership-row rollback state

**Severity: Moderate — RESOLVED at source/offline-test evidence level.**

The membership adapter writes membership status before releasing assignments in the same transaction callback ([membership-lifecycle.service.ts:32-49](src/modules/identity/application/membership-lifecycle.service.ts#L32)). The follow-up remediation now tracks membership status, assignment `unassignedAt`, ActivityLog rows, and OutboxEvent rows as state ([prisma-membership-lifecycle.spec.ts:19-39](src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts#L19)). The fake keeps committed state separate from a transaction-local draft, commits only after callback success, and drops the draft on rejection ([prisma-membership-lifecycle.spec.ts:63-88](src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts#L63)).

`membership.updateMany` mutates the draft membership; assignment update mutates draft assignments. The two parameterized failure cases assert membership status, assignment timestamps, ActivityLog records, and OutboxEvent records equal their pre-transaction values after ActivityLog or OutboxEvent failure ([prisma-membership-lifecycle.spec.ts:143-151](src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts#L143)). The success case asserts membership becomes `SUSPENDED` and the assignment is released ([prisma-membership-lifecycle.spec.ts:91-104](src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts#L91)).

**Evidence:** **SOURCE VERIFIED** for transaction callback propagation and awaited event writes; **OFFLINE TEST REPORTED** for all four fake-state assertions and the successful state transition. F-1 is resolved for source and the fake behavior it tests. PostgreSQL rollback remains **NOT VERIFIED (requires authorized PostgreSQL testing)** and is tracked under F-2.

**Reported focused result:** `npm run test:offline -- src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts` — 1 file passed, 7 tests passed. This report update did not rerun the test.

### F-2 — No runtime PostgreSQL evidence for Phase 1C persistence claims

**Severity: Major — OPEN; required before asserting runtime database correctness.**

The adapter source contains tenant-scoped queries, row locks, transaction-bound writes, and raw SQL. Neither the current audit nor the remediation test reports execute PostgreSQL. The fake harnesses simulate behavior in JavaScript and report operation/state outcomes; they cannot verify SQL mapping, schema compatibility, lock semantics, or database rollback.

**Evidence:** **SOURCE VERIFIED** for query and callback structure; **OFFLINE TEST REPORTED** for fake-backed scenarios; all runtime claims below are **NOT VERIFIED (requires authorized PostgreSQL testing)**.

**Remediation:** After explicit authorization, verify only against an independently validated disposable scratch database. No database testing is authorized by this report.

## Consolidated source findings

| Area / finding | Severity | Current evidence and references | Status / action |
|---|---|---|---|
| Membership deactivation transaction boundary | Runtime verification pending | Service wraps the operation in `transactions.run`, updates membership, then releases assignments only on active-to-non-active transition ([membership-lifecycle.service.ts:32-49](src/modules/identity/application/membership-lifecycle.service.ts#L32)). Adapter constructs its unit of work from the transaction callback client ([prisma-membership-lifecycle.ts:117-123](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L117)). | **SOURCE VERIFIED** for intended transaction propagation; the corrected fake tracks membership, assignment and event state. **OFFLINE TEST REPORTED**. Real rollback **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| One event pair per released assignment | No source defect found | Active assignments are selected once, ordered by ID and locked; empty result returns without events ([prisma-membership-lifecycle.ts:75-83](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L75)). After affected-row count matches, the loop awaits one ActivityLog and one OutboxEvent for each selected row ([prisma-membership-lifecycle.ts:84-113](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L84)). | **SOURCE VERIFIED** for one write pair per selected row. Exact persisted cardinality **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Tenant and membership scoping of membership release | No source defect found | Select predicate includes `organization_id`, `membership_id`, and `unassigned_at IS NULL`; update has the same tenant/membership/active predicates plus selected IDs ([prisma-membership-lifecycle.ts:75-86](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L75)). Event organization and assignment aggregate ID derive from the authenticated actor and selected assignment row ([prisma-membership-lifecycle.ts:90-110](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L90)). | **SOURCE VERIFIED**. Actual SQL execution/FK enforcement **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Lock order | No source defect found | Identity path locks organization, then memberships ordered by ID, then assignments ordered by ID ([prisma-membership-lifecycle.ts:20-38](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L20), [prisma-membership-lifecycle.ts:75-82](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L75)). Project/task paths lock organization and memberships before advisory and project-row locks ([prisma-project-task-store.ts:70-101](src/modules/projects/infrastructure/prisma-project-task-store.ts#L70)). | **SOURCE VERIFIED** for intended order; deadlock/race behavior **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Event format and actor snapshot | No source defect found | Identity release uses `assignment.removed`, aggregate `assignment`, selected assignment ID, payload context and `reason: membership_deactivated`, and resolves actor display name through the same transaction client ([prisma-membership-lifecycle.ts:90-112](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L90)). This matches the project/task event convention ([prisma-project-task-store.ts:45-68](src/modules/projects/infrastructure/prisma-project-task-store.ts#L45)). | **SOURCE VERIFIED**. Database FK/event persistence **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Event failure propagation | No source defect found | Event writes are awaited without swallowing errors, and the adapter is called inside the membership transaction callback ([membership-lifecycle.service.ts:32-49](src/modules/identity/application/membership-lifecycle.service.ts#L32), [prisma-membership-lifecycle.ts:100-112](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L100)). | **SOURCE VERIFIED** for rejection path. Corrected fake tests assert membership, assignment, activity, and outbox state remain unchanged for both event failures (**OFFLINE TEST REPORTED**). PostgreSQL rollback **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Repeated deactivation/no duplicate release events | No source defect found | Service invokes release only when the previously read status was ACTIVE and requested status is non-ACTIVE ([membership-lifecycle.service.ts:45-48](src/modules/identity/application/membership-lifecycle.service.ts#L45)); adapter selects only active rows ([prisma-membership-lifecycle.ts:78-80](src/modules/identity/infrastructure/prisma-membership-lifecycle.ts#L78)). | **SOURCE VERIFIED**. Test names for already-released and repeated deactivation are present ([membership-lifecycle adapter spec:122-141](src/modules/identity/infrastructure/prisma-membership-lifecycle.spec.ts#L122)). **OFFLINE TEST REPORTED**. |
| Project archive/task deletion assignment history | Original lifecycle gap resolved in source | Archive releases scoped active assignments, checks count, and writes assignment removal events before project-archived event ([prisma-project-task-store.ts:230-250](src/modules/projects/infrastructure/prisma-project-task-store.ts#L230)). Soft deletion releases assignments, advances graph revision, and writes events in its transaction ([prisma-project-task-store.ts:338-370](src/modules/projects/infrastructure/prisma-project-task-store.ts#L338)). | **SOURCE VERIFIED**; archive and soft-delete specs are covered in the reported offline run ([project store spec:242-276](src/modules/projects/infrastructure/prisma-project-task-store.spec.ts#L242), [project store spec:535-570](src/modules/projects/infrastructure/prisma-project-task-store.spec.ts#L535)). Runtime atomicity **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| `updateTask` and `softDeleteTask` post-write missing-row behavior | Original partial-commit findings resolved in source | Conditional update count mismatches throw version conflict; unexpected missing post-write task rows throw persistence invariant errors ([prisma-project-task-store.ts:323-329](src/modules/projects/infrastructure/prisma-project-task-store.ts#L323), [prisma-project-task-store.ts:348-367](src/modules/projects/infrastructure/prisma-project-task-store.ts#L348)). | **SOURCE VERIFIED**. Concrete store fake tests are documented in 1C.3-A report; **OFFLINE TEST REPORTED**. Actual rollback **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Optimistic concurrency | No source defect found | `updateTask` compares pre-read version and includes expected version in its tenant-scoped conditional update; count other than one conflicts ([prisma-project-task-store.ts:298-326](src/modules/projects/infrastructure/prisma-project-task-store.ts#L298)). | **SOURCE VERIFIED**. Fake race test is reported in `PHASE_1C_3A_REMEDIATION.md`; **OFFLINE TEST REPORTED**. Real concurrent behavior **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Dependency add/remove and graph revision | No source defect found | Add serializes project graph access, checks active tenant-scoped endpoints and graph cycle/duplicate state, uses tagged SQL and increments revision once after insert ([prisma-project-task-store.ts:389-435](src/modules/projects/infrastructure/prisma-project-task-store.ts#L389)). Remove conditionally updates only active scoped edges and increments/emits only when a row is returned ([prisma-project-task-store.ts:438-459](src/modules/projects/infrastructure/prisma-project-task-store.ts#L438)). | **SOURCE VERIFIED**; add/remove behaviors have fake tests reported in 1C.3-A (**OFFLINE TEST REPORTED**). Constraints, row counts, and SQL behavior **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Graph revision policy | No source defect found | Task creation, changed PERT values, soft delete, and dependency add/remove call revision increment; project metadata and assignment methods do not. Architecture decision agrees ([ARCHITECTURE_DECISIONS.md:24](ARCHITECTURE_DECISIONS.md#L24)). | **SOURCE VERIFIED**; selected counts tested by fake according to 1C.3-A (**OFFLINE TEST REPORTED**). Actual persisted increment count **NOT VERIFIED (requires authorized PostgreSQL testing)**. |
| Graph/scheduling errors | Original generic diagnostic concern addressed at API boundary | Service converts non-cycle graph errors to `INVALID_PROJECT_GRAPH` with `graphCode` ([project-task.service.ts:108-117](src/modules/projects/application/project-task.service.ts#L108)); API logs only approved graph codes and returns a generic stable response ([app.ts:132-141](src/api/app.ts#L132)). Graph engine source was not modified in this phase. | **SOURCE VERIFIED** and synthetic boundary tests **OFFLINE TEST REPORTED**. No live Graph Engine-to-DB behavior is verified. |
| Diagnostic code/type allowlists and sensitive data | 1C.3-C remediation present | `safeErrorCode` uses explicit Prisma allowlist; error logging uses fixed categories and selected fields; generic response is constant ([app.ts:43-68](src/api/app.ts#L43), [app.ts:148-162](src/api/app.ts#L148)). | **SOURCE VERIFIED**; captured Fastify boundary tests with synthetic sentinels are **OFFLINE TEST REPORTED** in `PHASE_1C_3C_REMEDIATION.md`. Production logging sinks are not assessed. |
| Malformed JSON and unmatched routes | 1C.4 implementation present | Known Fastify invalid/empty JSON parser codes map to `INVALID_REQUEST`/400; explicit not-found handler maps to `NOT_FOUND`/404 ([app.ts:117-123](src/api/app.ts#L117), [app.ts:165](src/api/app.ts#L165)). | **SOURCE VERIFIED**; actual `inject()` cases are reported in 1C.4 spec ([app.spec.ts:79-97](src/api/app.spec.ts#L79)). Other framework errors remain governed by existing fallback and are not covered by these cases. |

## Previous audit findings disposition

| Prior finding | Current disposition |
|---|---|
| No concrete Prisma project/task store tests | Addressed with concrete fake-backed store tests in `src/modules/projects/infrastructure/prisma-project-task-store.spec.ts`; SQL and PostgreSQL behavior remain unverified. |
| Post-write missing rows could return success/null after writes | Source now throws typed persistence invariant errors for update and delete post-write absence; fake tests reported. Runtime rollback remains unverified. |
| Transaction-client propagation / event atomicity | Current source passes transaction client through project/task event writes and membership adapter methods; test fakes cover selected paths. Actual database atomicity remains unverified. |
| Project archive assignment cleanup/history | Current source releases scoped active assignments and emits assignment and archive events; repeated archive only emits cleanup events for active rows. Fake tests reported. |
| Graph error diagnostic loss/exposure | Safe graph codes are retained for internal allowlisted logs; responses remain generic. Synthetic Fastify tests reported. |
| Arbitrary error names/codes in logs | 1C.3-C current code uses explicit allowlists and fixed categories; synthetic captured-log tests reported. |
| Membership-deactivation assignment event omission | Addressed in 1C.4 source: each selected row gets one `assignment.removed` ActivityLog and OutboxEvent. **SOURCE VERIFIED**; cardinality and failure behavior **OFFLINE TEST REPORTED**. |
| F-1 fake omitted membership state from rollback assertions | **RESOLVED**: fake now tracks membership status and separate transaction draft; success and both failure cases assert the requested observable state. Focused result reported as 1 file/7 tests passed. This does not establish PostgreSQL rollback. |
| Framework malformed JSON/not-found behavior | Addressed in 1C.4 with fixed response handlers and `inject()` tests reported. |
| Prisma schema/migration/client compatibility and real DB semantics | Open; not verifiable under this source-only audit. |

## Explicit NOT VERIFIED (requires authorized PostgreSQL testing)

- Migration replay and PostgreSQL schema compatibility.
- Generated Prisma Client compatibility with the checked-in schema and migration history.
- Actual rollback of domain mutation, membership status, assignment release, ActivityLog, OutboxEvent, and graph revision on transaction failure.
- Actual execution of the assignment selection/update SQL and alias mapping.
- Composite tenant FK, partial unique index, CHECK constraint, trigger, and referential-action enforcement.
- PostgreSQL advisory and row-lock behavior, lock conflicts, deadlocks, isolation, and last-owner/assignment races.
- True optimistic concurrency under concurrent transactions.
- Prisma 7 adapter behavior and real Prisma error object shapes.

## Final recommendation

**SOURCE-LEVEL PHASE 1C: PASS. DATABASE VERIFICATION: PENDING / NOT VERIFIED.** F-1 is resolved based on source review and the reported focused offline tests. F-2 remains open: PostgreSQL rollback, locks, migrations, generated Prisma Client compatibility, SQL execution, constraints, and concurrency have not been verified. This is not a claim of runtime database correctness. No database testing is authorized by this report, and Phase 1D has not started.
