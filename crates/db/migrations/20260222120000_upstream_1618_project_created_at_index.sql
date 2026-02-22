-- Fork-safe subset of upstream PR #1618.
-- sessions/workspaces/execution_process_repo_states do not exist in this fork,
-- so only keep the projects index that remains applicable.
CREATE INDEX IF NOT EXISTS idx_projects_created_at
ON projects (created_at DESC);

PRAGMA optimize;
