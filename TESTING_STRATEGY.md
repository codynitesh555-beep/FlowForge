# FlowForge Testing Strategy

## Current verification

- `npm run build` type-checks backend and domain TypeScript.
- `npm run build:web` type-checks the React frontend and produces a Vite
  production bundle.
- `npm run test:offline` excludes `src/infrastructure/database/schema.integration.spec.ts`.
  The Phase 1C.3-B run passed 29 files and 216 tests.
- The excluded database integration spec remains gated/placeholder work; no
  test in this pass connected to PostgreSQL or exercised migration SQL.
- No browser or visual interaction tests exist yet.

## Test layers

1. **Pure domain tests:** all role permissions, tenant-scope checks,
   membership-state changes, active-owner invariant, Graph Engine behavior,
   and PERT/CPM boundaries. Keep policy tests independent of Prisma.
2. **Application-service tests:** fake repositories/transaction ports verify
   authorization-before-write, hash-only credentials/tokens, token rotation
   and replay revocation, reset/session revocation, invitation delivery
   behavior, owner protection, assignment release, task versions, RBAC,
   estimate validation, and schedule mapping.
3. **HTTP API tests:** Fastify inject with fakes verifies schemas, auth cookie
   flags, missing/blocked Origin, cross-organization denial, permission
   enforcement, project route OpenAPI registration, body tenant override
   rejection, schedule DTOs, stale-version error mapping, generic errors and
   absence of secrets in responses. Error-boundary tests capture Fastify's
   structured logger stream in test mode and inspect responses and emitted
   records for approved diagnostics, Prisma metadata, stack traces, and secret
   sentinels. The capture seam is test-only; production logger configuration
   remains active.
4. **Graph scheduling tests:** the frozen Graph Engine adapter validates
   dependency cycles, active graph exclusion for deleted tasks/removed edges,
   critical path mapping, and deterministic metric arrays.
5. **Frontend tests (next):** component tests with mocked `fetch`, then browser
   flows for registration/login, refresh restoration, organization creation,
   invitation acceptance, reset, expiry and logout. Include keyboard/screen
   reader and responsive checks.
6. **Adapter tests:** use injected client/query boundaries or narrowly scoped
   fakes to assert Prisma call shape, parameterization, lock order, and that
   transactions propagate errors. Never call `$connect`, execute a query, or
   use a real pool in offline tests. `prisma-project-task-store.spec.ts` now
   executes selected concrete store callbacks against fake transaction clients,
   including event/revision failure propagation, post-write invariant failures,
   archive assignment release, tenant-scoped parameter values, lock sequence,
   stale versions, and duplicate-edge mapping. Its transaction fake separates
   root and transaction delegates and commits/discards isolated draft state.
   These fakes verify code paths, not PostgreSQL rollback, locks, constraint
   enforcement, or isolation.
7. **Database integration tests:** only after explicit scratch database
   authorization. Independently confirm target safety; exercise migration
   replay, tenant FK constraints, CHECK/partial indexes, trigger arithmetic,
   duplicate token races, lock ordering, rollback and concurrent last-owner
   transitions. Never inherit `DATABASE_URL`.
8. **Security tests:** extend parser fuzzing and API boundary cases, validate
   generic auth responses, refresh replay, origin/cookie controls, access
   revocation and secret-free logs. Do not claim runtime TLS behavior without
   a separately authorized safe test environment.

## Safe offline commands

- `npm run build`
- `npm run build:web`
- `npm run test:offline`

Do not use `npm test` for routine offline checks while the gated integration
spec is included by the global test glob. Never run Prisma CLI, Docker, or
database commands as substitutes for offline verification. Every report must
separate static/code-level checks from behavior verified against PostgreSQL.
