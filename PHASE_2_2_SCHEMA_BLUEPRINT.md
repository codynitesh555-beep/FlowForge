# FlowForge — Prisma 7 Schema Blueprint

## Objective
Prepare a complete implementation blueprint for the approved FlowForge
PostgreSQL architecture using Prisma ORM 7.10.1.

## Strict Rules
- PLANNING ONLY. Do not modify any file.
- Do not run migrations or generate Prisma Client.
- Do not install, remove, or upgrade dependencies.
- Preserve the approved architecture and all existing Graph Engine contracts.
- Use Prisma 7 syntax and the existing prisma7.config.ts.
- PostgreSQL 16 is the target database.

## Required Models
1. Organization
2. User
3. Membership
4. Project
5. Task
6. TaskDependency
7. TaskAssignment
8. ActivityLog
9. OutboxEvent

## Mandatory Architecture Constraints
- Strict tenant isolation.
- Tenant identity comes from authenticated context, never request body.
- Composite foreign keys must enforce organization/project ownership.
- Project must expose @@unique([id, organizationId]).
- Task must reference Project through [projectId, organizationId].
- TaskDependency must reference both endpoint tasks through
  [id, projectId, organizationId].
- TaskAssignment must reference Task and Membership through composite keys.
- ActivityLog keeps an optional direct User FK so historical logs survive
  membership removal; actorDisplayName is an immutable snapshot.
- OutboxEvent.aggregateId is intentionally polymorphic; organization FK
  remains mandatory and aggregate ownership is validated by the application.
- PERT inputs use Decimal(10,4).
- cachedExpectedHours uses Decimal(10,4).
- cachedVarianceHours uses Decimal(15,4).
- cachedSlackHours uses nullable Decimal(10,4).
- expected hours and variance are derived from PERT inputs, not independently
  editable values.
- SQL CHECK constraints must explicitly reject NaN and out-of-range values.
- Include version and graphRevision concurrency rules.
- graphRevision changes on task creation, task soft deletion, dependency
  addition/removal, and PERT estimate changes.
- Task soft deletion retains dependency records for history, but deleted
  tasks and their edges are excluded from the active graph.
- TaskAssignment changes do not affect graphRevision or CPM.
- Project-level advisory locks use hashtextextended and
  pg_advisory_xact_lock through Prisma $queryRaw, parameterized.
- Transaction order: acquire project lock before graph reads; perform graph
  validation, mutation, CPM recomputation, cache updates, graphRevision
  update, and outbox write in one transaction.
- Partial unique index: one active assignment per task/user.
- Dependency deletion uses RESTRICT where approved.
- Do not introduce unrelated models or features.

## Deliverables
1. Model-by-model field and relation table.
2. Exact Prisma relation definitions and relation names for ambiguous
   relations.
3. Composite unique constraints and foreign keys.
4. Index plan and custom PostgreSQL SQL migration requirements.
5. Numeric CHECK constraint SQL, including NaN rejection.
6. Partial unique index SQL for active assignments.
7. Advisory-lock implementation considerations for Prisma 7.
8. Soft-delete and graphRevision mutation matrix.
9. Prisma 7 generator/configuration compatibility review.
10. Risks, ambiguities, and decisions requiring approval.

## Output Requirements
- Be precise and technically critical.
- Identify anything Prisma cannot express and requires custom SQL.
- Do not silently change approved decisions.
- Do not implement anything.
- End with a list of explicit approval decisions.
