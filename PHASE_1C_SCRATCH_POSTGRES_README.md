# Phase 1C Scratch PostgreSQL

This configuration defines a standalone PostgreSQL 16 scratch instance for later, explicitly approved verification. It uses its own container name, named data volume, loopback-only host port, and initial database. It does not refer to any existing application database resources.

## Scratch resources

- Container: `flowforge-postgres-phase1c-scratch`
- Volume: `flowforge_pgdata_phase1c_scratch`
- Host binding: `127.0.0.1:5543` to container port `5432`
- Initial database: `flowforge_migration_scratch`
- Shadow and test database names are represented in the environment template but are not created by this Compose service.

## Prepare credentials

Copy `.env.phase1c-scratch.local.example` to `.env.phase1c-scratch.local` and replace all placeholders with local scratch-only credentials. The `.local` suffix is ignored by repository rules. Keep this local file private. URL credentials must be URL-encoded where required.

The Compose service consumes only `SCRATCH_POSTGRES_USER` and `SCRATCH_POSTGRES_PASSWORD`. The three database URLs are provided as a template for later Prisma verification; shadow and test databases must be provisioned separately after explicit approval.

## Startup instructions

The authorized scratch instance is running. Its current target identity was
confirmed on 2026-10-30. To start it again if stopped, run from the repository root:

```sh
docker compose \
  --project-name flowforge-phase1c-scratch \
  --file docker-compose.phase1c-scratch.yml \
  --env-file .env.phase1c-scratch.local \
  up -d --wait
```

Do not substitute the existing Compose file or use a shared application environment file. Starting this configuration creates only the named scratch container and named scratch volume. The shadow and test databases are provisioned on that isolated instance.

Before any future database operation, independently confirm the scratch container's published port and mounted volume, and ensure all migration, shadow, and test URLs use this scratch instance with distinct database names.
