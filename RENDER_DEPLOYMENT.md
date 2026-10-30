# Render backend deployment

This document describes the FlowForge API service settings for a fresh Render
deployment. It does not provision cloud resources.

## Service settings

- Runtime: Node.js 24.x, supported by the Prisma 7.10.1 and Vite 8 dependency
  requirements declared in the repository.
- Root directory: repository root.
- Build command: `npm run build:render`
- Start command: `npm run start:api`
- Health check path: `/readyz`

The build runs Prisma Client generation followed by the API TypeScript build.
It does not build the frontend or apply migrations. The start script runs the
compiled API. For a fresh cloud checkout, do not substitute `npm run db:generate`
for the deployment generation step: that command uses the local scratch config.

## Host and port

In production, the API requires Render's injected `PORT` and listens on that
port at `0.0.0.0`. `API_HOST`, if explicitly set, must be `0.0.0.0` in
production. Local development keeps its existing `127.0.0.1` host and port
3000 defaults; `API_HOST` and `API_PORT` remain available there.

## Environment variable names

Configure secret values through Render's environment settings. This list
contains names only:

Required by the production API configuration:

- `NODE_ENV`
- `PORT` (provided by Render)
- `DATABASE_URL`
- `ACCESS_TOKEN_SECRET`
- `ACCESS_TOKEN_ISSUER`
- `ACCESS_TOKEN_AUDIENCE`
- `ACCESS_TOKEN_LIFETIME_SECONDS`
- `CORS_ALLOWED_ORIGINS`
- `SMTP_URL`
- `SMTP_FROM`
- `PUBLIC_APP_URL`

Optional database pool tuning:

- `DATABASE_POOL_MAX`
- `DATABASE_CONNECTION_TIMEOUT_MS`
- `DATABASE_IDLE_TIMEOUT_MS`

Optional deployment runtime pin:

- `NODE_VERSION`

`API_HOST` is optional; production binds to `0.0.0.0` and rejects another
explicit value. `API_PORT` is retained for local development; production uses
`PORT`.

The Vercel frontend must use credentialed requests, and refresh must include
`X-FlowForge-CSRF: 1`. Set `CORS_ALLOWED_ORIGINS` to exact frontend origins.
The refresh cookie is `SameSite=None; Secure` in production, but browser
third-party-cookie restrictions may prevent it from persisting on the default
cross-site domains. Review [cross-site authentication requirements](CROSS_SITE_AUTH.md)
and validate supported browsers before release.

## Production migrations

Run migrations as a separate, controlled release action after verifying the
FlowForge database target. Use the direct PostgreSQL connection URL in
`MIGRATION_DATABASE_URL` and run:

```sh
npm run db:deploy:production
```

This is not part of the Render build or API startup. The migration command
uses `prisma7.production.config.ts`; do not substitute the scratch migration
command or set scratch database variables in Render.
