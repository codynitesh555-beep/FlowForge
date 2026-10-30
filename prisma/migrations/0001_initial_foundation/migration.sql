-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'MEMBER',
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "graph_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "optimistic_hours" DECIMAL(10,4) NOT NULL,
    "likely_hours" DECIMAL(10,4) NOT NULL,
    "pessimistic_hours" DECIMAL(10,4) NOT NULL,
    "expected_hours" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "variance_hours" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "slack_hours" DECIMAL(10,4),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "prerequisite_task_id" UUID NOT NULL,
    "dependent_task_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ(6),

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_display_name" VARCHAR(160) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(80),
    "aggregate_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_status_idx" ON "memberships"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_id_organization_id_user_id_key" ON "memberships"("id", "organization_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_created_at_idx" ON "projects"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_project_id_deleted_at_idx" ON "tasks"("organization_id", "project_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_project_id_organization_id_key" ON "tasks"("id", "project_id", "organization_id");

-- CreateIndex
CREATE INDEX "task_dependencies_organization_id_project_id_prerequisite_t_idx" ON "task_dependencies"("organization_id", "project_id", "prerequisite_task_id");

-- CreateIndex
CREATE INDEX "task_dependencies_organization_id_project_id_dependent_task_idx" ON "task_dependencies"("organization_id", "project_id", "dependent_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_project_id_organization_id_prerequisite_t_key" ON "task_dependencies"("project_id", "organization_id", "prerequisite_task_id", "dependent_task_id");

-- CreateIndex
CREATE INDEX "task_assignments_organization_id_task_id_assigned_at_idx" ON "task_assignments"("organization_id", "task_id", "assigned_at");

-- CreateIndex
CREATE INDEX "task_assignments_organization_id_membership_id_assigned_at_idx" ON "task_assignments"("organization_id", "membership_id", "assigned_at");

-- CreateIndex
CREATE INDEX "activity_logs_organization_id_created_at_idx" ON "activity_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_organization_id_aggregate_type_aggregate_id_idx" ON "activity_logs"("organization_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_available_at_created_at_idx" ON "outbox_events"("processed_at", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_aggregate_type_aggregate_id_idx" ON "outbox_events"("organization_id", "aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_prerequisite_task_id_project_id_organiza_fkey" FOREIGN KEY ("prerequisite_task_id", "project_id", "organization_id") REFERENCES "tasks"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependent_task_id_project_id_organizatio_fkey" FOREIGN KEY ("dependent_task_id", "project_id", "organization_id") REFERENCES "tasks"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_project_id_organization_id_fkey" FOREIGN KEY ("task_id", "project_id", "organization_id") REFERENCES "tasks"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_membership_id_organization_id_user_id_fkey" FOREIGN KEY ("membership_id", "organization_id", "user_id") REFERENCES "memberships"("id", "organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that are not expressible in the Prisma schema language.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_optimistic_hours_check"
  CHECK ("optimistic_hours" <> 'NaN'::numeric AND "optimistic_hours" >= 0 AND "optimistic_hours" <= 999999.9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_likely_hours_check"
  CHECK ("likely_hours" <> 'NaN'::numeric AND "likely_hours" >= 0 AND "likely_hours" <= 999999.9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pessimistic_hours_check"
  CHECK ("pessimistic_hours" <> 'NaN'::numeric AND "pessimistic_hours" >= 0 AND "pessimistic_hours" <= 999999.9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pert_order_check"
  CHECK ("optimistic_hours" <= "likely_hours" AND "likely_hours" <= "pessimistic_hours");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_expected_hours_check"
  CHECK ("expected_hours" <> 'NaN'::numeric AND "expected_hours" >= 0 AND "expected_hours" <= 999999.9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_variance_hours_check"
  CHECK ("variance_hours" <> 'NaN'::numeric AND "variance_hours" >= 0 AND "variance_hours" <= 99999999999.9999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_slack_hours_check"
  CHECK ("slack_hours" IS NULL OR ("slack_hours" <> 'NaN'::numeric AND "slack_hours" >= -999999.9999 AND "slack_hours" <= 999999.9999));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_version_positive_check" CHECK ("version" > 0);
ALTER TABLE "projects" ADD CONSTRAINT "projects_graph_revision_nonnegative_check" CHECK ("graph_revision" >= 0);
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_no_self_reference_check"
  CHECK ("prerequisite_task_id" <> "dependent_task_id");
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempts_nonnegative_check" CHECK ("attempts" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check"
  CHECK ("email" = lower("email") AND "email" = btrim("email"));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_normalized_check"
  CHECK ("slug" = lower("slug") AND "slug" = btrim("slug"));

-- The PERT-derived values are always calculated by PostgreSQL and cannot be
-- supplied as independent domain inputs, including through direct SQL writes.
CREATE FUNCTION "calculate_task_derived_hours"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."expected_hours" := (NEW."optimistic_hours" + 4 * NEW."likely_hours" + NEW."pessimistic_hours") / 6;
  NEW."variance_hours" := ((NEW."pessimistic_hours" - NEW."optimistic_hours") / 6) ^ 2;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tasks_calculate_derived_hours"
BEFORE INSERT OR UPDATE ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "calculate_task_derived_hours"();

-- At most one currently active assignment for a task and user; historical
-- assignments remain available after unassignment.
CREATE UNIQUE INDEX "unique_active_task_assignment"
ON "task_assignments" ("task_id", "user_id")
WHERE "unassigned_at" IS NULL;

