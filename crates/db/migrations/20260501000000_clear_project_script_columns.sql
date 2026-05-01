-- Script and copy-file settings are stored in config.json (project_settings),
-- not in the projects table. Clear legacy values from existing rows.
UPDATE projects
SET
    setup_script = NULL,
    dev_script = NULL,
    cleanup_script = NULL,
    copy_files = NULL,
    parallel_setup_script = 0;
