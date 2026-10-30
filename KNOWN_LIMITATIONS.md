# Known Limitations

- Neither the original migration nor the additive Phase 1B migration has been
  executed or replayed against PostgreSQL. Schema relations, SQL syntax,
  constraints, triggers, Prisma 7 adapter behavior and database concurrency
  remain unverified at runtime.
- The Phase 1B schema adds AuthSession, PasswordResetToken and
  OrganizationInvitation, and Phase 1C adds Project.archivedAt and
  TaskDependency.removedAt. Generated Prisma artifacts were not regenerated.
  The new Phase 1B models and Phase 1C columns use parameterized SQL where the
  generated client lacks model/field support. Build success does not validate
  those SQL statements or migration compatibility.
- Membership/owner and invitation/password-reset transactions have only
  offline orchestration tests. The PostgreSQL lock behavior, rollback,
  unique-index conflict mapping, and actual migration/client compatibility
  require isolated scratch-database verification.
- Phase 1C now has offline fake-client tests that invoke selected
  `PrismaProjectTaskStore` transaction paths. The fake uses distinct root and
  transaction delegates and isolated draft state to test commit/discard control
  flow, plus archive/assignment cleanup, selected tenant predicates/parameters,
  lock sequence, graph revisions, and expected uniqueness mapping. It does not
  prove PostgreSQL advisory/row lock behavior, constraint enforcement,
  trigger-calculated PERT values, actual transaction rollback, isolation or
  races.
- Phase 1C has not passed a fresh independent audit. No Phase 1D implementation
  should begin until that review and separately authorized scratch-database
  verification planning are complete.
- API invitation and password-reset routes are available only when the SMTP
  configuration is supplied. Production requires SMTPS and HTTPS app URL, but
  provider credentials, sender domain, bounce behavior, and actual delivery
  are not configured or verified here.
- The frontend includes an initial authentication and organization-selection
  surface plus project/task flows: project create/read/update/archive, task
  create/edit/soft-delete, dependency controls, assignment/unassignment, and
  schedule/critical-path display. It does not yet include invitation
  acceptance, password-reset, or membership-administration screens. Visual
  error recovery is basic; browser-flow tests, responsive review, and a formal
  accessibility audit remain outstanding.
- On refresh-cookie session restoration, the API currently returns a new
  access token without user profile details; the UI shows a generic account
  label until a profile endpoint is implemented.
- Email verification is not implemented. Registration returns a conflict for
  duplicate email; exact anti-enumeration product behavior remains to be
  decided.
- Access tokens are short-lived and validated against active session state,
  which requires a database check per authenticated request. No cache is added
  because no performance requirement currently justifies one.
- Rate limiting currently uses Fastify's in-process store and is per API
  replica. Shared/distributed limits need review before horizontal scaling.
- `PasswordResetToken` reset path revokes current auth sessions. Other account
  security controls (credential-change flow, revoke-all UI, recovery support)
  are not exposed yet.
- Phase 1C application services, Prisma transaction adapters and API routes
  implement project/task lifecycle, dependency history/cycle checks,
  scheduling, assignments, graph revisions, ActivityLog and OutboxEvent writes.
  All database behavior is unverified. There is no outbox dispatcher, resource
  capacity/calendar model, or broader allocation policy.
- Phase 1D is for resource planning and allocation extensions. Active-member
  assignment validation, the baseline lock ordering, and assignment-history
  retention foundations already exist; their PostgreSQL behavior remains
  unverified. Resource capacity, availability, calendars, skills and allocation
  policy still need owner approval before schema work.
- Project lifecycle is one-way ACTIVE → ARCHIVED; archiving releases active
  assignments transactionally and retains their history. Task lifecycle is ACTIVE →
  SOFT_DELETED; task restoration is deliberately not exposed because no
  restoration policy was approved. Dependency removal and assignment
  unassignment retain history.
- Scheduling reads are not persisted or cached, and do not emit a scheduling
  event. No background recomputation worker exists.
- Resource capacity, availability, calendars, skills and allocation policy
  need an owner-approved domain model. Outbox delivery semantics, deployment,
  backup/restore, observability, incident handling, and AI data policy are
  open.
- Helmet's default Content Security Policy is disabled to keep the current
  Swagger UI functional. A restrictive deployed CSP must be designed before
  production exposure.
- `npm run build:web` pulls Google Fonts at page runtime; offline/self-hosted
  font packaging has not been configured.
- No Git metadata was available to verify historical diffs; Graph Engine was
  not edited in this work pass.
