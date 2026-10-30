# FlowForge Architecture Decisions

Status labels distinguish owner-approved direction from implementation that
still needs operational verification.

| Area | Status | Decision and rationale |
|---|---|---|
| Runtime | APPROVED | Node.js, strict TypeScript, ESM. |
| Backend framework | APPROVED | Fastify v5 modular monolith. Plugin boundaries suit auth, organizations and product modules without introducing service deployment overhead. |
| Request validation | APPROVED | Zod schemas at API and application boundaries; malformed input maps to non-sensitive errors. |
| API documentation | APPROVED | OpenAPI generated from route schemas; version routes under `/v1`. |
| Frontend | APPROVED | React + TypeScript + Vite in the same repository as a separate frontend application. The API remains a separate process and deployment boundary can be chosen later. |
| Frontend/backend communication | APPROVED | Versioned JSON HTTP API; exact CORS origin allowlist; credentials included only for the refresh cookie; short access token held in memory and sent as Bearer. No browser local/session storage for credentials. |
| Database and ORM | APPROVED | PostgreSQL 16 with Prisma ORM 7 and `@prisma/adapter-pg`. Existing nine-model schema and composite tenant relations remain the baseline. Phase 1B adds AuthSession, PasswordResetToken, and OrganizationInvitation. |
| Prisma lifecycle | APPROVED | One lazy process client with explicit shutdown, adapter configured at construction, transaction-scoped writes, no root-client fallback in transaction paths. Runtime remains unverified. |
| Authentication | APPROVED | Argon2id password hashes, short-lived signed access tokens, opaque rotating refresh tokens stored as hashes, token-family revocation on replay/logout, and session revocation after password reset. |
| Refresh-token transport | APPROVED | `HttpOnly`, `SameSite=Strict`, `/v1/auth` cookie; `Secure` in production. Refresh endpoint requires an allowlisted Origin. Tradeoff: strict same-site deployment is simplest; a cross-site deployment would need a separately reviewed CSRF/cookie design. |
| Password recovery | APPROVED | Single-use short-lived hashed tokens, generic request response to reduce account enumeration, delivery through an injected SMTP adapter; reset revokes sessions. Email verification is not implemented. |
| Authorization | APPROVED | Explicit organization-scoped RBAC; server resolves active membership from authenticated user and route organization. Client-supplied tenant identity is not trusted for authorization. No implicit role inheritance. |
| RBAC matrix | APPROVED | OWNER: all current organization, membership, project, task, dependency, assignment, scheduling and analytics permissions, including owner management and org deletion. ADMIN: all except org deletion and owner management; cannot change/promote owner memberships. MEMBER: read org/membership/project/task/dependency, create tasks, update assigned tasks, read own assignments, run schedules and read analytics. Phase 1C enforces these permissions at service boundaries. |
| Organization lifecycle | APPROVED | Create organization with initial active OWNER in one transaction. Membership transitions lock organization, then membership UUIDs in ascending order, then assignment IDs in ascending order; active owners are recounted while the organization lock is held. Deactivation releases active assignments transactionally. |
| Project and task lifecycle | APPROVED | Project state is ACTIVE → ARCHIVED via `archivedAt`; archived projects remain readable and are excluded from active project lists, while writes and scheduling are blocked. Task state is ACTIVE → SOFT_DELETED via existing `deletedAt`; no restore endpoint is approved. Task rows and dependency history are retained. A dependency is ACTIVE → REMOVED via `removedAt`; the same edge may be added again after removal. |
| Project archive assignment cleanup | APPROVED | Archiving atomically releases all active task assignments in the project, retains assignment rows with `unassignedAt`, and emits assignment removal events in the same transaction. Repeating archive is idempotent and repairs any residual active assignments without duplicating the project-archived event. This is cleanup of dependent lifecycle state; it does not permit other writes to archived projects. |
| Graph revision and concurrency | APPROVED | Project advisory transaction lock uses `pg_advisory_xact_lock(hashtextextended(projectId, 0))` before graph reads/mutations. `graphRevision` advances for task create/soft-delete, dependency add/remove and PERT estimate changes; it does not advance for project metadata or assignment-only changes. Task mutations compare `version` and return conflict on stale versions. |
| Scheduling and numeric boundary | APPROVED | Active task expected hours from PostgreSQL Decimal are converted to finite non-negative JS numbers at the Graph Engine boundary. Inputs must fit Decimal(10,4), be ordered O ≤ L ≤ P, and have no more than four decimal places. The frozen Graph Engine calculates CPM; the API maps Maps/Sets into deterministic JSON arrays. Schedule reads do not persist a cache or emit events. |
| Activity and outbox | APPROVED | Every project/task/dependency/assignment mutation writes ActivityLog and OutboxEvent in the same Prisma transaction. Actor display names are read from User and stored as immutable snapshots. Outbox aggregate IDs are scoped to verified organization/project/task/dependency/assignment rows. No dispatcher is implemented yet. |
| API errors and logs | APPROVED | Stable error codes, no database/provider detail in responses, sensitive request fields redacted from logs, no-store responses and request-size/rate limits. |
| Environment management | APPROVED | Environment variables with schema validation; `.env` is local and ignored. Test/migration/shadow URLs are explicit, isolated, independently guarded; never fall back to `DATABASE_URL`. |
| Docker development | APPROVED | PostgreSQL 16, host port 5433 fallback, preserved `flowforge_pgdata` volume. No Docker operation is part of this implementation. |
| Tests | APPROVED | Offline domain/application/API tests and builds by default; DB integration only with explicit authorization and disposable isolated scratch targets. |
| Background processing | RECOMMENDED | Start with a simple database polling worker for OutboxEvent when product events require delivery; define idempotency/retry semantics first. No broker requirement demonstrated. |
| Resource planning | NEEDS OWNER APPROVAL | Resource capacity, availability, calendars, skills, allocation policies, and constraints have no approved model. Do not add schema until requirements are agreed. |
| AI integration | NEEDS OWNER APPROVAL | No concrete AI workflow, consent, retention, provider, or data policy is approved. Keep future use behind a narrow capability port. |
| Deployment/hosting | NEEDS OWNER APPROVAL | API/web can deploy together or separately. Hosting, domain, TLS termination, secrets management, monitoring and recovery targets are not specified. |

Security rationale: passwords are deliberately expensive to verify; refresh
tokens are high-entropy, opaque and stored only as SHA-256 hashes; replay
invalidates the family; access tokens have bounded lifetimes and are checked
against an active session; refresh credentials are kept out of JavaScript.
Cookie transport trades cross-site flexibility for a smaller CSRF surface and
requires exact Origin validation.

The Phase 1C schema delta adds only Project.archivedAt and
TaskDependency.removedAt. A custom PostgreSQL partial unique index enforces
one active dependency edge; Prisma cannot represent its predicate. The additive
migration is written but not executed or validated. No Redis, microservices,
queues, vector database, or other infrastructure is approved or required by
current code.

Unexpected post-write row absence and affected-row count mismatches are treated
as persistence invariant failures so the enclosing transaction rejects.
Expected dependency/assignment uniqueness violations are translated to stable
domain conflicts; safe Graph Engine subcodes are retained in internal logs and
are not returned to clients. Offline adapter tests use fake transaction clients
and do not validate PostgreSQL semantics.
