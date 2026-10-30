# Phase 1C.3-B — API Error Boundary & Documentation Consistency

## 1. Executive summary

Strengthened the actual Fastify error boundary tests to capture and inspect structured log output alongside response bodies. Graph diagnostics and persistence operation details are now logged only when their values are in explicit allowlists. Unknown exceptions no longer inherit arbitrary `statusCode` values; they return a generic 500 envelope. The test log stream can only be supplied in `NODE_ENV=test`, leaving production logger and redaction configuration active.

Updated project status, roadmap, testing strategy, and known limitations based on inspection of the React source. The initial project/task UI is implemented, while invitation acceptance, password reset, and membership administration UI, browser tests, and formal accessibility review remain outstanding. Phase 1D now distinguishes existing active-membership/locking/history foundations from future resource planning and allocation work.

## 2. Exact files changed

- `src/api/app.ts`
- `src/api/app.spec.ts`
- `PROJECT_STATUS.md`
- `IMPLEMENTATION_ROADMAP.md`
- `TESTING_STRATEGY.md`
- `KNOWN_LIMITATIONS.md`
- `PHASE_1C_3B_REMEDIATION.md`

No persistence adapter, domain behavior, Prisma schema, migration, or Graph Engine source was changed.

## 3. API error-boundary cases added

New cases in `src/api/app.spec.ts` exercise `createApiApp` through real Fastify `inject`, with service dependencies mocked and a writable stream capturing the configured Fastify/Pino logger:

| Test | What it proves | What it does not prove |
|---|---|---|
| `returns generic graph errors and logs only an approved graph diagnostic` | A representative `INVALID_PROJECT_GRAPH` returns `{code: INVALID_PROJECT_GRAPH}` with HTTP 500. Captured structured log contains only the stable project error code and allowlisted `GRAPH_MISSING_NODE` diagnostic among error-specific fields. SQL/message/stack/metadata sentinels do not appear in response or captured logs. | Does not run the frozen Graph Engine or persistence adapter. |
| `returns generic persistence errors and logs only the approved operation diagnostic` | Persistence invariant returns generic `{code: INTERNAL_ERROR}`/500; the known operation identifier is logged; attached SQL, stack and metadata sentinels are absent from response and output. | Does not prove production logging infrastructure delivery or inspect real DB exceptions. |
| `omits unapproved graph diagnostic text instead of logging arbitrary error details` | An arbitrary graph detail string is omitted from the captured log; response remains generic. | Does not test every possible malformed object shape. |
| `keeps Prisma SQL diagnostics out of responses and logs only a safe error type and code` | Representative `PrismaClientKnownRequestError` with P2010, SQL text, stack, constraint, and metadata returns generic 500; output includes only `errorType` and sanitized `diagnosticCode` among exception-specific fields. Sentinels and nested SQLSTATE are absent from response/output. | Uses a representative synthetic error, not a runtime Prisma adapter error. |
| `keeps unknown errors generic even if an arbitrary error carries a conflict statusCode` | Unknown exception with `statusCode: 409` cannot turn into conflict or not-found/success; response stays generic 500 and the exception message is not logged. | Does not exercise Fastify's internal parser/router errors. |
| `preserves stable domain status mapping for ...` (`it.each`) | Confirms 400 for invalid task input, 404 for task not found, 403 for inactive membership, and 409 for stale version through the real Fastify boundary. | Covers representative stable codes, not every domain error code. |

The existing graph and persistence generic-response tests remain in place.

## 4. Logger inspection and redaction evidence

Previously `NODE_ENV=test` disabled Fastify logging, so tests could not inspect actual records. `ApiDependencies.loggerStream` is a narrow test seam; `createApiApp` rejects its use outside test mode. When present, Fastify uses the same configured redaction paths and censor as production and writes records to the supplied stream. Without the seam, test logging remains disabled as before; production logger configuration remains enabled.

The error handler only logs explicitly selected fields. Graph diagnostic values are restricted to the frozen Graph Engine's known error-code set. Persistence operation values are restricted to the static operation identifiers emitted by the store. Generic exception logs contain the error class name and a syntax-validated diagnostic code only; the original exception, message, stack, and metadata are not passed to the logger. Unknown exceptions return a generic 500 response rather than trusting an arbitrary numeric `statusCode`.

Tests parse captured structured records and search the actual response and log output for synthetic SQL, stack, constraint, and credential sentinels. These are fake test markers, not real credentials. This verifies application-level field selection and the configured test logger stream; it does not verify deployment log sinks, retention, access controls, or production infrastructure.

## 5. Documentation contradictions resolved

- **Frontend status:** `web/src/main.tsx` and `web/src/api.ts` show the initial organization/project UI and project/task flows: project list/create/update/archive; task create/edit/soft-delete; dependency list/add/remove; assignment list/assign/unassign; schedule and critical-path metrics. `KNOWN_LIMITATIONS.md` now distinguishes those implemented flows from missing invitation acceptance, password-reset, and membership-administration screens, basic visual error recovery, browser-flow tests, responsive review, and formal accessibility review.
- **Phase 1D scope:** `src/modules/projects/infrastructure/prisma-project-task-store.ts` implements active target-membership validation, organization/member/project lock acquisition, assignment history, and release on membership deactivation, task deletion, project archive, and explicit unassignment. `IMPLEMENTATION_ROADMAP.md` now records these as existing foundations with PostgreSQL behavior still unverified. Phase 1D retains owner-approved resource modeling and future capacity, availability, calendar, skills, allocation-rule, and resource-conflict work.
- `PROJECT_STATUS.md` and `TESTING_STRATEGY.md` were updated with the latest offline run and error-boundary evidence.

## 6. Commands executed and exact results

Before running commands, `package.json` was inspected: `test:offline` invokes Vitest while excluding `src/infrastructure/database/schema.integration.spec.ts`; `build` is TypeScript compilation; `build:web` runs the web TypeScript check and Vite build. The excluded integration spec is gated/todo test code. The focused API test imports no database client construction or integration helper.

- `npm run test:offline -- src/api/app.spec.ts` — **passed**, 1 file, 20 tests.
- `npm run test:offline` — **passed**, 29 files, 216 tests.
- `npm run build` — **passed** (`tsc`).
- `npm run build:web` — **passed** (web TypeScript check and Vite production build).

The first focused attempt failed because the test stream was initially supplied at the wrong Fastify option level, so logs went to stdout instead of the capture stream. The stream was moved into Fastify's logger options; the focused spec and all final verification commands above then passed. No result is claimed for the failed attempt as a passing verification.

## 7. Remaining gaps and limitations

- No real Prisma error or Graph Engine-to-API persistence path was executed; dependencies at the API service boundary are mocked.
- Synthetic tests prove only the error handler's selected fields, generic response shape, and mapping behavior. They do not establish runtime PostgreSQL or Prisma adapter semantics.
- The error handler now maps unrecognized errors to 500 even when an arbitrary thrown object has a client `statusCode`. Fastify/Zod schema validation and explicit domain errors retain their known mappings; behavior for unrelated framework-generated errors was not expanded in this stage.
- No browser tests or formal accessibility audit were run. Frontend feature status was established by source inspection, not browser execution.
- Database runtime, migration, transaction, lock, and concurrency behavior remains unverified. Phase 1C is not marked PASS.

## 8. Safety confirmation

No PostgreSQL connection, Prisma CLI, migration, `db push`, database integration test, Docker command or operation, `.env` inspection, or Graph Engine modification occurred. No persistence adapter, schema, or migration was modified. No database testing is authorized by this report.

## 9. Phase 1D status

Phase 1D was not started. Work stopped after Phase 1C.3-B as requested.
