ALTER TABLE tags
ADD COLUMN project_id BLOB NULL REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tags_project_id ON tags(project_id);
