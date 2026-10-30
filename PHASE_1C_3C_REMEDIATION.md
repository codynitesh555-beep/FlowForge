# Phase 1C.3-C — Final Diagnostic Logging Hardening

## Summary

Hardened the API error boundary so syntax-valid identifiers are not automatically considered safe diagnostics and thrown-object names are never logged. Generic logging now uses an explicit allowlist of top-level Prisma codes and fixed error categories. Nested metadata codes are ignored. Generic responses and stable domain status mappings are preserved.

## Exact files changed

- `src/api/app.ts`
- `src/api/app.spec.ts`
- `PHASE_1C_3C_REMEDIATION.md`

No documentation outside this report, domain behavior, persistence adapter, Prisma schema/migrations, or Graph Engine file was changed.

## Original findings addressed

- Phase 1C.3-B left `safeErrorCode()` accepting any regex-valid top-level or nested metadata code. It now accepts only explicitly approved top-level Prisma codes.
- Phase 1C.3-B logged `error.name` for unexpected exceptions and used runtime type names for non-Error values. These are now fixed application-controlled categories.
- The Phase 1C independent re-audit had noted that tests did not capture logger output and did not prove diagnostic field selection. The new Fastify boundary tests capture the structured logger stream and inspect serialized records and response bodies.

## Error-code policy

`safeErrorCode()` in `src/api/app.ts:59-68` reads only an own data-property `code` and accepts only `P2002`, `P2003`, `P2010`, or `P2025` (`:51`). The descriptor read is guarded; accessor properties and read errors produce no diagnostic. `meta.code` is never inspected. Therefore SQLSTATE-like values such as `23505`, other valid-looking `P` codes such as `P9999`, and arbitrary strings are omitted. The approved code may be logged as `diagnosticCode` without logging the original error object.

Existing application/domain branches remain ahead of this fallback and preserve their status mapping. Unexpected errors continue to return `{code: INTERNAL_ERROR}` with HTTP 500. The test suite exercises the approved-code path and verifies no arbitrary attached fields accompany it.

## Error-type policy

The unhandled project/task branch logs the fixed `PROJECT_TASK_ERROR` category and includes `code` only when it is in the known `ProjectTaskErrorCode` allowlist (`src/api/app.ts:52-57,146-150`). The generic error branch logs only `ERROR` for `Error` instances or `NON_ERROR_THROWABLE` for other thrown values (`:153-158`). No error path logs `error.name`. Error messages, stacks, metadata, SQL, constraint names, and arbitrary object fields are not passed to the logger.

## Added boundary tests

All tests use `createApiApp()` and `Fastify.inject()` with the existing test-only captured logger stream. Tests inspect parsed log records and responses.

| Test | What it proves |
|---|---|
| `uses a fixed error category instead of a malicious Error.name` (`src/api/app.spec.ts:333-357`) | An Error with custom `name`, stack and attached SQL/constraint fields still logs `ERROR`; response remains generic 500; those values are absent from both output channels. |
| `uses a fixed non-error category for an unknown object with an arbitrary name` (`:359-378`) | A rejected plain object logs `NON_ERROR_THROWABLE`, not its supplied name or properties, and returns generic 500. |
| `does not promote a SQLSTATE-like meta.code into a logged diagnostic` (`:380-401`) | Nested `meta.code: 23505` is omitted, with message, stack, constraint and SQL sentinels absent from logs and response. |
| `omits a syntax-valid Prisma code that is not in the diagnostic allowlist` (`:403-419`) | Top-level `P9999` is not logged despite matching Prisma-code syntax; response remains generic 500. |
| `logs an explicitly approved Prisma diagnostic code without logging arbitrary attached properties` (`:421-439`) | Top-level P2002 is logged as the allowed diagnostic, while nested SQLSTATE and message/stack/constraint/SQL/secret properties remain absent. |
| Existing `keeps Prisma SQL diagnostics out of responses and logs only a fixed error category and approved code` (`:291-316`) | P2010 is an approved top-level diagnostic; nested 23505 and all sensitive markers are not exposed. |
| Existing `keeps unknown errors generic even if an arbitrary error carries a conflict statusCode` (`:318-331`) | Unknown error with statusCode 409 stays a generic 500. |
| Existing `preserves stable domain status mapping for ...` (`:443-457`) | Invalid task input, missing task, inactive membership, and stale version remain 400, 404, 403, and 409 respectively. |

Existing tests for generic graph and persistence invariant responses, allowlisted graph diagnostics, and persistence operation allowlisting remain active. Authentication, authorization, membership, and Zod mapping branches were not changed.

## Commands and results

Inspected `package.json` before execution. `test:offline` excludes `src/infrastructure/database/schema.integration.spec.ts`; `build` is `tsc`; `build:web` runs web TypeScript compilation and Vite. No command in this verification invokes Prisma, a database, or Docker.

- `npm run test:offline -- src/api/app.spec.ts` — **passed**, 1 file, 25 tests.
- `npm run test:offline` — **passed**, 29 files, 221 tests.
- `npm run build` — **passed** (`tsc`).
- `npm run build:web` — **passed** (TypeScript check and Vite production build).

## Remaining limitations

- Tests use synthetic thrown values and prove only API boundary field selection and response mapping. They do not exercise real Prisma adapter errors or database behavior.
- The diagnostic allowlist is intentionally narrow. New Prisma identifiers require an explicit code change and test before they can appear in logs.
- The logger stream tests do not validate deployment log transport, retention, access controls, or production sink configuration.
- PostgreSQL transactions, rollback, locking, migrations, and concurrency remain unverified. This work does not mark Phase 1C PASS or authorize database testing.

## Safety confirmation

No PostgreSQL connection, Prisma CLI, migration, database integration test, Docker operation, `.env` inspection, schema/migration edit, or Graph Engine edit occurred. Phase 1D was not started. Work stopped after Phase 1C.3-C.
