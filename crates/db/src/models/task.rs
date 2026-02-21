use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Executor, FromRow, Sqlite, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use ts_rs::TS;
use uuid::Uuid;

use super::{project::Project, task_attempt::TaskAttempt};

#[derive(
    Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display, Default,
)]
#[sqlx(type_name = "task_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Todo,
    InProgress,
    InReview,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid, // Foreign key to Project
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub parent_task_attempt: Option<Uuid>, // Foreign key to parent TaskAttempt
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TaskWithAttemptStatus {
    #[serde(flatten)]
    #[ts(flatten)]
    pub task: Task,
    pub has_in_progress_attempt: bool,
    pub has_merged_attempt: bool,
    pub last_attempt_failed: bool,
    pub executor: String,
}

impl std::ops::Deref for TaskWithAttemptStatus {
    type Target = Task;
    fn deref(&self) -> &Self::Target {
        &self.task
    }
}

impl std::ops::DerefMut for TaskWithAttemptStatus {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.task
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TaskRelationships {
    pub parent_task: Option<Task>,    // The task that owns this attempt
    pub current_attempt: TaskAttempt, // The attempt we're viewing
    pub children: Vec<Task>,          // Tasks created by this attempt
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateTask {
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
    pub parent_task_attempt: Option<Uuid>,
    pub image_ids: Option<Vec<Uuid>>,
}

impl CreateTask {
    /// Resolves parent_task_attempt from base_branch if not already set.
    /// If base_branch matches an existing task attempt's branch, sets that as parent.
    pub async fn with_parent_from_branch(
        mut self,
        pool: &SqlitePool,
        base_branch: &str,
    ) -> Result<Self, sqlx::Error> {
        // Only resolve if parent not already set (explicit parent takes precedence)
        if self.parent_task_attempt.is_none()
            && let Some(parent) =
                TaskAttempt::find_by_branch(pool, self.project_id, base_branch).await?
        {
            self.parent_task_attempt = Some(parent.id);
        }
        Ok(self)
    }
}

#[derive(Debug, FromRow)]
struct TaskWithAttemptStatusRow {
    id: Uuid,
    project_id: Uuid,
    title: String,
    description: Option<String>,
    status: TaskStatus,
    parent_task_attempt: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    has_in_progress_attempt: i64,
    last_attempt_failed: i64,
    executor: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
    pub parent_task_attempt: Option<Uuid>,
    pub image_ids: Option<Vec<Uuid>>,
}

impl Task {
    pub fn to_prompt(&self) -> String {
        if let Some(description) = self.description.as_ref().filter(|d| !d.trim().is_empty()) {
            format!("{}\n\n{}", &self.title, description)
        } else {
            self.title.clone()
        }
    }

    pub async fn parent_project(&self, pool: &SqlitePool) -> Result<Option<Project>, sqlx::Error> {
        Project::find_by_id(pool, self.project_id).await
    }

    pub async fn find_by_project_id_with_attempt_status(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<TaskWithAttemptStatus>, sqlx::Error> {
        let records = sqlx::query_as::<_, TaskWithAttemptStatusRow>(
            r#"SELECT
  t.id                            AS id,
  t.project_id                    AS project_id,
  t.title,
  t.description,
  t.status                        AS status,
  t.parent_task_attempt           AS parent_task_attempt,
  t.created_at                    AS created_at,
  t.updated_at                    AS updated_at,

  CASE WHEN EXISTS (
    SELECT 1
      FROM task_attempts ta
      JOIN execution_processes ep
        ON ep.task_attempt_id = ta.id
     WHERE ta.task_id       = t.id
       AND ep.status        = 'running'
       AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
     LIMIT 1
  ) THEN 1 ELSE 0 END            AS has_in_progress_attempt,
  
  CASE WHEN (
    SELECT ep.status
      FROM task_attempts ta
      JOIN execution_processes ep
        ON ep.task_attempt_id = ta.id
     WHERE ta.task_id       = t.id
     AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
     ORDER BY ep.created_at DESC
     LIMIT 1
  ) IN ('failed','killed') THEN 1 ELSE 0 END
                                 AS last_attempt_failed,

  ( SELECT ta.executor
      FROM task_attempts ta
      WHERE ta.task_id = t.id
     ORDER BY ta.created_at DESC
      LIMIT 1
    )                               AS executor

FROM tasks t
WHERE t.project_id = $1
ORDER BY t.created_at DESC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let tasks = records
            .into_iter()
            .map(|rec| TaskWithAttemptStatus {
                task: Task {
                    id: rec.id,
                    project_id: rec.project_id,
                    title: rec.title,
                    description: rec.description,
                    status: rec.status,
                    parent_task_attempt: rec.parent_task_attempt,
                    created_at: rec.created_at,
                    updated_at: rec.updated_at,
                },
                has_in_progress_attempt: rec.has_in_progress_attempt != 0,
                has_merged_attempt: false, // TODO use merges table
                last_attempt_failed: rec.last_attempt_failed != 0,
                executor: rec.executor,
            })
            .collect();

        Ok(tasks)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id, project_id, title, description, status, parent_task_attempt, created_at, updated_at
               FROM tasks 
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_rowid(pool: &SqlitePool, rowid: i64) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id, project_id, title, description, status, parent_task_attempt, created_at, updated_at
               FROM tasks 
               WHERE rowid = $1"#,
        )
        .bind(rowid)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateTask,
        task_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let status = data.status.clone().unwrap_or_default();
        sqlx::query_as::<_, Task>(
            r#"INSERT INTO tasks (id, project_id, title, description, status, parent_task_attempt) 
               VALUES ($1, $2, $3, $4, $5, $6) 
               RETURNING id, project_id, title, description, status, parent_task_attempt, created_at, updated_at"#,
        )
        .bind(task_id)
        .bind(data.project_id)
        .bind(&data.title)
        .bind(&data.description)
        .bind(status)
        .bind(data.parent_task_attempt)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Uuid,
        title: String,
        description: Option<String>,
        status: TaskStatus,
        parent_task_attempt: Option<Uuid>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"UPDATE tasks 
               SET title = $3, description = $4, status = $5, parent_task_attempt = $6 
               WHERE id = $1 AND project_id = $2 
               RETURNING id, project_id, title, description, status, parent_task_attempt, created_at, updated_at"#,
        )
        .bind(id)
        .bind(project_id)
        .bind(title)
        .bind(description)
        .bind(status)
        .bind(parent_task_attempt)
        .fetch_one(pool)
        .await
    }

    pub async fn update_status(
        pool: &SqlitePool,
        id: Uuid,
        status: TaskStatus,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE tasks SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            id,
            status
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Update the parent_task_attempt field for a task
    pub async fn update_parent_task_attempt(
        pool: &SqlitePool,
        task_id: Uuid,
        parent_task_attempt: Option<Uuid>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE tasks SET parent_task_attempt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            task_id,
            parent_task_attempt
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Nullify parent_task_attempt for all tasks that reference the given attempt ID
    /// This breaks parent-child relationships before deleting a parent task
    pub async fn nullify_children_by_attempt_id<'e, E>(
        executor: E,
        attempt_id: Uuid,
    ) -> Result<u64, sqlx::Error>
    where
        E: Executor<'e, Database = Sqlite>,
    {
        let result = sqlx::query!(
            "UPDATE tasks SET parent_task_attempt = NULL WHERE parent_task_attempt = $1",
            attempt_id
        )
        .execute(executor)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn delete<'e, E>(executor: E, id: Uuid) -> Result<u64, sqlx::Error>
    where
        E: Executor<'e, Database = Sqlite>,
    {
        let result = sqlx::query!("DELETE FROM tasks WHERE id = $1", id)
            .execute(executor)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn find_children_by_attempt_id(
        pool: &SqlitePool,
        attempt_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        // Find only child tasks that have this attempt as their parent
        sqlx::query_as::<_, Task>(
            r#"SELECT id, project_id, title, description, status, parent_task_attempt, created_at, updated_at
               FROM tasks 
               WHERE parent_task_attempt = $1
               ORDER BY created_at DESC"#,
        )
        .bind(attempt_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_relationships_for_attempt(
        pool: &SqlitePool,
        task_attempt: &TaskAttempt,
    ) -> Result<TaskRelationships, sqlx::Error> {
        // 1. Get the current task (task that owns this attempt)
        let current_task = Self::find_by_id(pool, task_attempt.task_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        // 2. Get parent task (if current task was created by another task's attempt)
        let parent_task = if let Some(parent_attempt_id) = current_task.parent_task_attempt {
            // Find the attempt that created the current task
            if let Ok(Some(parent_attempt)) = TaskAttempt::find_by_id(pool, parent_attempt_id).await
            {
                // Find the task that owns that parent attempt - THAT's the real parent
                Self::find_by_id(pool, parent_attempt.task_id).await?
            } else {
                None
            }
        } else {
            None
        };

        // 3. Get children tasks (created by this attempt)
        let children = Self::find_children_by_attempt_id(pool, task_attempt.id).await?;

        Ok(TaskRelationships {
            parent_task,
            current_attempt: task_attempt.clone(),
            children,
        })
    }
}
