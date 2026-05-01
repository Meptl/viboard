-- Project scripts and copy file settings are stored in config.json project_settings.
-- Remove legacy columns from projects table.
ALTER TABLE projects DROP COLUMN setup_script;
ALTER TABLE projects DROP COLUMN dev_script;
ALTER TABLE projects DROP COLUMN cleanup_script;
ALTER TABLE projects DROP COLUMN copy_files;
ALTER TABLE projects DROP COLUMN parallel_setup_script;
