use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Project not found")]
    ProjectNotFound,
    #[error("Project with git repository path already exists")]
    GitRepoPathExists,
    #[error("Failed to check existing git repository path: {0}")]
    GitRepoCheckFailed(String),
    #[error("Failed to create project: {0}")]
    CreateFailed(String),
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub git_repo_path: PathBuf,
    pub setup_script: Option<String>,
    pub dev_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub copy_files: Option<String>,
    pub parallel_setup_script: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateProject {
    pub name: String,
    pub git_repo_path: String,
    pub use_existing_repo: bool,
    pub setup_script: Option<String>,
    pub dev_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub copy_files: Option<String>,
    pub parallel_setup_script: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub git_repo_path: Option<String>,
    pub setup_script: Option<String>,
    pub dev_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub copy_files: Option<String>,
    pub parallel_setup_script: Option<bool>,
}

#[derive(Debug, Serialize, TS)]
pub struct SearchResult {
    pub path: String,
    pub is_file: bool,
    pub match_type: SearchMatchType,
}

#[derive(Debug, Clone, Serialize, TS)]
pub enum SearchMatchType {
    FileName,
    DirectoryName,
    FullPath,
}

#[derive(Debug, Clone, FromRow)]
struct ProjectRow {
    id: Uuid,
    name: String,
    git_repo_path: String,
    setup_script: Option<String>,
    dev_script: Option<String>,
    cleanup_script: Option<String>,
    copy_files: Option<String>,
    parallel_setup_script: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ProjectRow> for Project {
    fn from(row: ProjectRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            git_repo_path: PathBuf::from(row.git_repo_path),
            setup_script: row.setup_script,
            dev_script: row.dev_script,
            cleanup_script: row.cleanup_script,
            copy_files: row.copy_files,
            parallel_setup_script: row.parallel_setup_script,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl Project {
    pub async fn count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!(r#"SELECT COUNT(*) as "count!: i64" FROM projects"#)
            .fetch_one(pool)
            .await
    }

    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let projects = sqlx::query_as::<_, ProjectRow>(
            r#"SELECT id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                      parallel_setup_script, created_at, updated_at
               FROM projects
               ORDER BY created_at DESC"#,
        )
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Project::from)
        .collect();
        Ok(projects)
    }

    /// Find the most actively used projects based on recent task activity
    pub async fn find_most_active(pool: &SqlitePool, limit: i32) -> Result<Vec<Self>, sqlx::Error> {
        let projects = sqlx::query_as::<_, ProjectRow>(
            r#"
            SELECT p.id, p.name, p.git_repo_path, p.setup_script, p.dev_script, p.cleanup_script, p.copy_files,
                   p.parallel_setup_script, p.created_at, p.updated_at
            FROM projects p
            WHERE p.id IN (
                SELECT DISTINCT t.project_id
                FROM tasks t
                INNER JOIN task_attempts ta ON ta.task_id = t.id
                ORDER BY ta.updated_at DESC
            )
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(Project::from)
        .collect();
        Ok(projects)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ProjectRow>(
            r#"SELECT id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                      parallel_setup_script, created_at, updated_at
               FROM projects
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map(|project| project.map(Project::from))
    }

    pub async fn find_by_git_repo_path(
        pool: &SqlitePool,
        git_repo_path: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ProjectRow>(
            r#"SELECT id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                      parallel_setup_script, created_at, updated_at
               FROM projects
               WHERE git_repo_path = $1"#,
        )
        .bind(git_repo_path)
        .fetch_optional(pool)
        .await
        .map(|project| project.map(Project::from))
    }

    pub async fn find_by_git_repo_path_excluding_id(
        pool: &SqlitePool,
        git_repo_path: &str,
        exclude_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, ProjectRow>(
            r#"SELECT id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                      parallel_setup_script, created_at, updated_at
               FROM projects
               WHERE git_repo_path = $1 AND id != $2"#,
        )
        .bind(git_repo_path)
        .bind(exclude_id)
        .fetch_optional(pool)
        .await
        .map(|project| project.map(Project::from))
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateProject,
        project_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let parallel_setup_script = data.parallel_setup_script.unwrap_or(false);
        sqlx::query_as::<_, ProjectRow>(
            r#"INSERT INTO projects (
                    id,
                    name,
                    git_repo_path,
                    setup_script,
                    dev_script,
                    cleanup_script,
                    copy_files,
                    parallel_setup_script
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8
                )
                RETURNING id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                          parallel_setup_script, created_at, updated_at"#,
        )
        .bind(project_id)
        .bind(&data.name)
        .bind(&data.git_repo_path)
        .bind(&data.setup_script)
        .bind(&data.dev_script)
        .bind(&data.cleanup_script)
        .bind(&data.copy_files)
        .bind(parallel_setup_script)
        .fetch_one(pool)
        .await
        .map(Project::from)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: String,
        git_repo_path: String,
        setup_script: Option<String>,
        dev_script: Option<String>,
        cleanup_script: Option<String>,
        copy_files: Option<String>,
        parallel_setup_script: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, ProjectRow>(
            r#"UPDATE projects
               SET name = $2,
                   git_repo_path = $3,
                   setup_script = $4,
                   dev_script = $5,
                   cleanup_script = $6,
                   copy_files = $7,
                   parallel_setup_script = $8
               WHERE id = $1
               RETURNING id, name, git_repo_path, setup_script, dev_script, cleanup_script, copy_files,
                         parallel_setup_script, created_at, updated_at"#,
        )
        .bind(id)
        .bind(name)
        .bind(git_repo_path)
        .bind(setup_script)
        .bind(dev_script)
        .bind(cleanup_script)
        .bind(copy_files)
        .bind(parallel_setup_script)
        .fetch_one(pool)
        .await
        .map(Project::from)
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM projects WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
