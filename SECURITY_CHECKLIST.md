# FlowForge Security Checklist

## Implemented in code

- [x] Tenant ownership is represented by composite database foreign keys;
  the organization ID used at service boundaries comes from the authenticated
  route principal.
- [x] Test and migration URLs are explicit, guarded targets with no
  `DATABASE_URL` fallback. Scratch connections require literal loopback and
  reject protected port/database names and unsafe collisions.
- [x] PrismaPg construction overrides ambient `PGSSLMODE`; remote URL TLS uses
  certificate verification and rejects insecure modes.
- [x] Passwords use Argon2id; registration/login inputs are bounded and
  normalized; unknown users follow a dummy-hash verification path.
- [x] Access JWTs have short bounded lifetimes and issuer/audience checks.
  Refresh tokens are random opaque values stored only as hashes; replay
  revokes the token family; password reset revokes sessions.
- [x] Refresh cookie is HttpOnly and SameSite Strict, Secure in production,
  scoped to auth endpoints; refresh requires an allowlisted Origin.
- [x] Explicit OWNER/ADMIN/MEMBER permission sets; active membership lookup is
  scoped by user and organization; owner-target management is owner-only.
- [x] Last-active-OWNER checks serialize under the organization lock and
  recount owners inside the transaction. Membership and assignment lock order
  is documented and implemented in the Prisma adapter.
- [x] Invitation and reset tokens are single-use/expiring hash records;
  invitation acceptance checks the signed-in account email.
- [x] Exact CORS origins, request body limits, rate limits, security headers,
  no-store responses, generic error responses and sensitive-field log
  redaction are configured.
- [x] Environment placeholder secret is rejected; production requires secure
  SMTP configuration, HTTPS app URL, and explicit CORS origins.
- [x] Project and task writes re-check the active actor membership in the
  transaction; target project/task queries are organization-scoped. Task
  changes require expected versions.
- [x] Project graph mutations serialize through a transaction-scoped advisory
  lock before graph reads. Tenant-safe composite FKs remain in schema; cycle
  checks run through the frozen Graph Engine.
- [x] Active scheduling snapshots omit soft-deleted tasks, removed dependency
  rows, and edges touching deleted tasks. Task/dependency records remain for
  history; task soft-delete releases active assignments.
- [x] Project/task/dependency/assignment mutations write actor snapshot
  ActivityLog and organization-owned OutboxEvent rows in the same transaction.
- [x] Assignment creation locks the organization and actor/target memberships
  in sorted ID order, verifies the target is ACTIVE in that tenant, then
  serializes on the project and relies on the active-assignment unique index.
- [x] Project archive releases active assignment history and emits removal
  events atomically; project archive itself remains one-way.
- [x] Phase 1C persistence adapter has offline fake-client regression tests for
  transaction rejection/commit control flow, tenant scope, query parameter
  binding, lock order, stale versions, revision failure and event failures.
  These tests do not prove PostgreSQL locking or rollback behavior.

## Required before production

- [ ] Generate and rotate signing secrets through a production secret manager;
  define key rotation and emergency revocation operations.
- [ ] Configure and verify SMTP provider, SPF/DKIM/DMARC, sender identity,
  bounce handling and delivery monitoring. Tokens/URLs must remain out of
  provider logs.
- [ ] Define email verification and account recovery support policy.
- [ ] Add browser-level CSRF/origin, cookie, accessibility and session-expiry
  tests; test deployment topology and TLS termination.
- [ ] Add account lifecycle controls (credential change, revoke all sessions,
  deletion/export) and operational audit events.
- [ ] Review rate-limit storage/consistency if multiple API replicas are
  introduced; current in-process limits are per instance.
- [ ] Validate all new schema, SQL constraints, migration replay, transaction
  races and Prisma adapters against a separately authorized disposable
  PostgreSQL scratch database.
- [ ] Confirm Phase 1C archived-project and removed-dependency custom SQL
  fields, partial unique index, Prisma schema drift and graph revision updates
  against PostgreSQL.
- [ ] Ensure project graph edits, audit records and outbox events commit
  atomically, and enforce aggregate ownership/idempotent delivery before
  enabling background workers.
- [ ] Obtain a fresh independent Phase 1C audit after remediation and complete
  scratch-database checks only with separate authorization.
- [ ] Review deployment CSP. Helmet's default CSP is disabled for the current
  Swagger UI setup; configure a restrictive CSP for deployed product surfaces.

## Not approved or not present

- No deployment topology, data retention schedule, backup encryption policy,
  incident process, AI processing policy, or resource allocation policy has
  been approved.
- No Redis, external queue, microservice boundary, or vector database is
  introduced.
