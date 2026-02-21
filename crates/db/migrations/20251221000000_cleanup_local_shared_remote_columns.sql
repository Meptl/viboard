-- Cleanup obsolete local schema artifacts from remote/shared-task support.
-- Runtime no longer queries these columns; API compatibility is preserved in Rust models.

DROP INDEX IF EXISTS idx_tasks_shared_task_unique;
DROP INDEX IF EXISTS idx_projects_remote_project_id;

ALTER TABLE tasks DROP COLUMN shared_task_id;
ALTER TABLE projects DROP COLUMN remote_project_id;

-- Defensive cleanup in case older databases still carry these tables.
DROP TABLE IF EXISTS shared_activity_cursors;
DROP TABLE IF EXISTS shared_tasks;
