# FlowForge

FlowForge is a multi-tenant project planning application for organizing work,
estimating task duration, and modeling task dependencies. It calculates PERT
estimates and critical-path schedule metrics from the active project graph.

## Current capabilities

- Account registration and login with refresh-cookie session restoration.
- Organizations/workspaces, membership roles, and tenant-scoped access.
- Project creation, listing, updates, and archiving.
- Task creation, estimates, updates, soft deletion, and member assignments.
- Dependency creation/removal, cycle prevention, dependency history, and
  schedule/critical-path analysis.
- Password reset and invitation API workflows when mail delivery is configured.

The frontend does not yet provide invitation acceptance, password-reset, or
membership-administration screens. Resource planning, capacity/calendar
allocation, outbox delivery, and AI features are not implemented. Task restore
is deliberately not exposed.

## Architecture and stack

- React, TypeScript, and Vite frontend in `web/`.
- Fastify v5 and TypeScript API in `src/api/`.
- PostgreSQL with Prisma ORM 7, PrismaPg, and SQL migrations in `prisma/`.
- Domain modules for identity, projects, and graph/scheduling logic in `src/`.
- Vitest for unit, API, and database integration tests.

The generated Prisma Client is written to `src/generated/prisma/` and is
ignored by Git. Local generation uses the scratch configuration. Deployment
generation uses the independent schema-only configuration and needs no
database URL or credentials.

## Prerequisites

- Node.js 24.x and npm. `package.json` declares the supported Node range.
- Docker Compose for the isolated local PostgreSQL option below, or a separate
  PostgreSQL instance configured for this project.

The project does not declare a Node.js `engines` range. Use a current Node.js
LTS release compatible with the lockfile dependencies.

## Install and configure

From a fresh checkout:

```sh
npm ci
cp .env.phase1c-scratch.local.example .env.phase1c-scratch.local
```

Edit `.env.phase1c-scratch.local` locally and replace every placeholder with
credentials and URLs for your own isolated scratch PostgreSQL instance. The
migration, shadow, and test URLs must identify separate databases, use a
loopback host, use a port other than `5433`, and end in `_scratch`. The
environment guard rejects protected targets. Never commit the resulting local
environment file.

`.env.example` documents runtime and configuration variable names; it contains
placeholders and is not a usable credential file. The local API development
runner and Prisma CLI read `.env.phase1c-scratch.local` explicitly. Production
startup uses injected environment variables or `.env.production.local`; the
production migration config requires `MIGRATION_DATABASE_URL` to be injected
separately.

## Database setup

### Isolated local scratch PostgreSQL

The repository includes a dedicated scratch Compose file with a loopback-only
port (`5543`) and a separately named container and volume. To start this
isolated service after preparing its environment file:

```sh
docker compose \
  --project-name flowforge-phase1c-scratch \
  --file docker-compose.phase1c-scratch.yml \
  --env-file .env.phase1c-scratch.local \
  up -d --wait
```

This Compose service creates the migration database only. Provision distinct
shadow and integration-test databases on that same isolated local instance
before running Prisma development migrations or database integration tests.
Review [the scratch PostgreSQL runbook](PHASE_1C_SCRATCH_POSTGRES_README.md)
and independently verify the target container, port, and volume before any
database operation.

Keep development and test databases on the isolated scratch instance and use a
port other than `5433`. The application and migration environment guards
reject the protected target.

Generate Prisma Client and apply already-authored migrations only to the
configured isolated scratch migration database:

```sh
npm run db:generate
npm run db:deploy
```

For a cloud build, use `npm run db:generate:deploy`. It generates Prisma
Client from the schema without loading scratch configuration or connecting to
a database.

`npm run db:generate` runs Prisma Client generation. There is no `npm run db`
script. `npm run db:migrate` invokes `prisma migrate dev` and can create or
apply migrations; use it only when intentionally developing schema changes on
the isolated scratch environment. Do not use production migration commands
against a local database.

The application is multi-tenant at the organization level. Use separate
database instances for production and local development; never point local
development or tests at a production database.

## Run the application

Start the API in one terminal:

```sh
npm run dev:api
```

Start the Vite frontend in another terminal:

```sh
npm run dev:web
```

The local API defaults to `127.0.0.1:3000`; Vite defaults to
`127.0.0.1:5173`. The development frontend defaults to the local API URL.
Production builds require `VITE_API_BASE_URL` to be an absolute HTTPS API URL
and reject loopback hosts. For example, in a production build environment:

```sh
VITE_API_BASE_URL=https://api.example.com npm run build:web
```

Set the actual deployment API origin; do not use the example hostname above.

## Tests and production build

```sh
npm run test:offline
npm run test:integration
npm run typecheck
npm run build
```

`test:offline` excludes the PostgreSQL integration spec. The integration
script deploys migrations to the configured `TEST_DATABASE_URL` and runs
database tests. Use it only after verifying that the integration target is a
disposable, isolated scratch database separate from the application,
migration, and shadow databases. Do not reset or reuse a database containing
valuable data.

`npm run build` compiles the API and runs the production frontend build, so
`VITE_API_BASE_URL` must be set to an HTTPS URL for the target API. No
deployment automation is included yet. For Render's backend build, use
`npm run build:render`; its start command is `npm run start:api`. Production
binds to `0.0.0.0` and requires Render's injected `PORT`. See
[Render deployment setup](RENDER_DEPLOYMENT.md) for the production variable
names and service settings.

## Security and production readiness

- Never commit real `.env` files, database URLs, passwords, signing keys,
  provider credentials, certificates, or private keys. Commit only the safe
  `.env*.example` templates.
- Use unique local scratch credentials and keep all scratch database URLs on
  the explicitly isolated instance. Do not use the generic port-5433 Compose
  configuration as a development shortcut.
- Production requires HTTPS, a strong private `ACCESS_TOKEN_SECRET`, explicit
  `CORS_ALLOWED_ORIGINS`, a production `VITE_API_BASE_URL`, and a separately
  injected `MIGRATION_DATABASE_URL` for migrations. See
  [Project Status](PROJECT_STATUS.md) for the full variable list and current
  production assessment.
- Cross-site refresh-cookie requirements and browser limitations are documented
  in [Cross-site authentication](CROSS_SITE_AUTH.md).
- Production deployment is not ready: there is no application Dockerfile, CI
  or release workflow, or hosting manifest. Production database behavior,
  staging verification, backup/recovery procedures, proxy trust, distributed
  rate limiting, and a deployed Content Security Policy remain unresolved or
  unverified.
