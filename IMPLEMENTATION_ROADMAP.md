# FlowForge Implementation Roadmap

This roadmap starts from the repository state and carries completed work
forward. Phase 1A and the frozen Graph Engine are foundations, not rebuild
targets.

## Phase 1A — Database and graph foundation (implemented; runtime unverified)

- PostgreSQL 16, Prisma 7.10.1, nine original core models, composite tenant
  relationships, hand-authored SQL constraints/triggers, guarded URLs, and
  PrismaPg transaction infrastructure.
- No Prisma CLI, migration, or database verification has occurred in this
  implementation pass. The additive Phase 1B migration also awaits isolated
  database review and replay.
- Graph Engine remains unchanged and is called only through its exported API.

## Phase 1B — Identity, authentication, authorization (code implemented)

- Argon2id credentials; short-lived access JWTs; rotating opaque refresh tokens
  stored as SHA-256 hashes; replay detection revokes the token family; logout
  and password reset revoke sessions.
- Organization creation, invitation creation/acceptance, organization-scoped
  membership changes, assignment release on deactivation, and serialized
  last-active-OWNER checks use the approved organization → sorted membership
  UUID → sorted assignment ID lock order.
- Fastify/Zod/OpenAPI endpoints and a React/Vite/TypeScript entry UI cover
  account registration, login, organization list/create, and logout.
- Offline unit/API tests and backend/frontend builds pass. Database adapter
  behavior, migrations, race behavior, and Prisma relation generation remain
  unverified against PostgreSQL.
- Remaining Phase 1B work: mail provider operational configuration and
  delivery verification, UI/API flows for invitations and password reset,
  browser/accessibility tests, and authorized scratch-database integration.

## Phase 1C — Projects, tasks and scheduling (application code implemented)

- Tenant-scoped project/task services and Prisma transaction adapters support
  create/list/read/update/archive, task create/read/update/soft-delete,
  version conflicts, dependency add/remove/history, assignment lifecycle and
  schedule analysis. Organization scope comes from the active principal.
- Project graph writes use the approved advisory lock before graph reads;
  graph revision advances on task create/delete, dependency change and PERT
  estimate change. Assignment-only changes do not advance it.
- Active graph snapshots exclude soft-deleted tasks, removed edges, and every
  edge touching a deleted task. The frozen Graph Engine validates cycles and
  returns PERT/CPM, slack and deterministic critical-path DTOs.
- Mutations create actor-snapshotted ActivityLog and OutboxEvent rows inside
  the same Prisma transaction. No outbox dispatcher is present.
- A small additive migration introduces Project.archivedAt and
  TaskDependency.removedAt plus a partial unique index for active edges. The
  migration is hand-authored and has not been replayed. Generated Prisma
  Client remains unchanged; those two custom fields are accessed through
  parameterized SQL.
- Offline tests/builds pass; adapter SQL, lock behavior, migration replay,
  PERT trigger interaction, constraints and concurrency remain unverified.
  Proceed to isolated database verification only after separate explicit
  authorization.
- Audit remediation now makes post-write row-count/read invariants fail the
  enclosing transaction, releases active assignments atomically on project
  archive, maps expected uniqueness/FK conflicts to stable domain errors, and
  preserves only allowlisted graph/persistence diagnostics in captured
  structured logs while returning generic internal responses. Unknown errors
  are not mapped from arbitrary `statusCode` fields. Offline API and adapter
  tests cover response/log selection and selected store control flow; they do
  not establish PostgreSQL behavior. Fresh independent audit remains pending.
- The React UI now includes organization project listing, project creation and
  archive, task estimate editing/deletion, dependency controls, assignments,
  and schedule analysis. No restore-task action is exposed.

## Phase 1D — Resource planning and allocation extensions

- Foundations already implemented in Phases 1B/1C: assignment creation checks
  that the target membership is active in the organization; organization,
  membership, project, and assignment rows use the established lock ordering;
  membership deactivation, task deletion, project archive, and unassignment
  release active assignments while retaining assignment history. These
  foundations have offline tests; PostgreSQL locking, rollback, and concurrency
  still require separately authorized scratch-database verification.
- Phase 1D should extend those foundations only as product requirements demand:
  define capacity, availability, calendars, skills, allocation rules, and
  resource conflict handling. Obtain owner approval for the resource model
  before schema changes. Do not redo the completed active-membership, lock-order,
  or history-retention baseline as though it were missing.

## Phase 1E — Activity and outbox

- Add actor authorization and immutable display-name snapshots to audit writes.
- Validate OutboxEvent aggregate ownership and implement a retry-safe dispatcher
  with idempotency and observable failure handling. Start with a database
  polling worker; add a broker only if measured requirements justify it.

## Phase 2 — Product UI and operations

- Complete invitation/password-recovery UI, project/task views, member
  administration, and responsive accessible interactions against the API.
- Add browser tests, CI, observability, deployment, backup/restore and incident
  operations after hosting and operational requirements are settled.
- API and web are separate applications in one repository, with an HTTP
  boundary. Deploy separately only if independent release/scaling requirements
  emerge; local development can run both processes.

## Phase 3 — Resource and AI capabilities

- Treat AI as an optional capability behind a narrow provider boundary. Define
  user consent, data minimization, retention, evaluation, and fallback behavior
  before choosing a provider or adding infrastructure.
- Add no Redis, queue broker, microservices, vector database, or other service
  without an observed requirement.

## Parallel work

- Frontend screens can proceed against the stable HTTP contracts and mocked API
  responses independently of Prisma adapter work.
- Project/task domain policies and DTOs can proceed independently of database
  migrations if they consume the established authenticated principal and do
  not change Prisma schema/client files.
- Schema/migration changes, generated Prisma artifacts, and database-backed
  contract verification should have one owner at a time. End-to-end database
  flows wait on explicit scratch-database authorization.

Do not begin Phase 1D until the Phase 1C remediation has received a fresh
independent audit and remaining database checks have the required authorization.
