-- Add composite index for merges status filtering
-- This optimizes queries like: WHERE merge_type = 'pr' AND pr_status = 'open'
-- which were taking 2+ seconds without proper indexing
CREATE INDEX IF NOT EXISTS idx_merges_type_status 
ON merges (merge_type, pr_status);

-- Optimize database after adding indexes
PRAGMA optimize;
