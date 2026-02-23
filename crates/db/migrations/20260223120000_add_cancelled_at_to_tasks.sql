ALTER TABLE tasks ADD COLUMN cancelled_at TEXT;

-- Backfill existing cancelled tasks with the best available approximation.
UPDATE tasks
SET cancelled_at = updated_at
WHERE status = 'cancelled'
  AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_status_cancelled_at
ON tasks (status, cancelled_at);

PRAGMA optimize;
