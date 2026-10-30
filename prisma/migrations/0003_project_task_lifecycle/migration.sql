ALTER TABLE "projects" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "projects" ADD CONSTRAINT "projects_archived_at_check"
  CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at");

ALTER TABLE "task_dependencies" ADD COLUMN "removed_at" TIMESTAMPTZ(6);
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_removed_at_check"
  CHECK ("removed_at" IS NULL OR "removed_at" >= "created_at");

DROP INDEX "task_dependencies_project_id_organization_id_prerequisite_t_key";
CREATE UNIQUE INDEX "task_dependencies_active_edge_key"
  ON "task_dependencies"("project_id", "organization_id", "prerequisite_task_id", "dependent_task_id")
  WHERE "removed_at" IS NULL;
