use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(type = "'merged' | 'failed' | 'completed'")]
pub enum TaskNotificationOutcome {
    #[serde(rename = "merged")]
    Merged,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "completed")]
    Completed,
}

impl TaskNotificationOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Merged => "merged",
            Self::Failed => "failed",
            Self::Completed => "completed",
        }
    }
}

impl std::str::FromStr for TaskNotificationOutcome {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "merged" => Ok(Self::Merged),
            "failed" => Ok(Self::Failed),
            "completed" => Ok(Self::Completed),
            _ => Err("invalid task notification outcome"),
        }
    }
}

#[derive(Debug, Clone, FromRow)]
struct TaskNotificationRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub task_id: Uuid,
    pub task_title: String,
    pub outcome: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TaskNotification {
    pub id: Uuid,
    pub project_id: Uuid,
    pub task_id: Uuid,
    pub task_title: String,
    pub outcome: TaskNotificationOutcome,
    pub created_at: DateTime<Utc>,
}

impl TryFrom<TaskNotificationRow> for TaskNotification {
    type Error = sqlx::Error;

    fn try_from(row: TaskNotificationRow) -> Result<Self, Self::Error> {
        let outcome = row.outcome.parse().map_err(|_| {
            sqlx::Error::Protocol(format!(
                "invalid task notification outcome: {}",
                row.outcome
            ))
        })?;

        Ok(Self {
            id: row.id,
            project_id: row.project_id,
            task_id: row.task_id,
            task_title: row.task_title,
            outcome,
            created_at: row.created_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateTaskNotification {
    pub project_id: Uuid,
    pub task_id: Uuid,
    pub task_title: String,
    pub outcome: TaskNotificationOutcome,
}

impl TaskNotification {
    pub async fn find_by_rowid(pool: &SqlitePool, rowid: i64) -> Result<Option<Self>, sqlx::Error> {
        let row = sqlx::query_as::<_, TaskNotificationRow>(
            r#"
            SELECT
                id,
                project_id,
                task_id,
                task_title,
                outcome,
                created_at
            FROM task_notifications
            WHERE rowid = ?
            "#,
        )
        .bind(rowid)
        .fetch_optional(pool)
        .await?;

        match row {
            Some(row) => TaskNotification::try_from(row).map(Some),
            None => Ok(None),
        }
    }

    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let rows = sqlx::query_as::<_, TaskNotificationRow>(
            r#"
            SELECT
                id,
                project_id,
                task_id,
                task_title,
                outcome,
                created_at
            FROM task_notifications
            ORDER BY created_at DESC, id DESC
            "#,
        )
        .fetch_all(pool)
        .await?;

        rows.into_iter().map(TaskNotification::try_from).collect()
    }

    pub async fn create(
        pool: &SqlitePool,
        payload: &CreateTaskNotification,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, TaskNotificationRow>(
            r#"
            INSERT INTO task_notifications (id, project_id, task_id, task_title, outcome)
            VALUES (?, ?, ?, ?, ?)
            RETURNING
                id,
                project_id,
                task_id,
                task_title,
                outcome,
                created_at
            "#,
        )
        .bind(id)
        .bind(payload.project_id)
        .bind(payload.task_id)
        .bind(&payload.task_title)
        .bind(payload.outcome.as_str())
        .fetch_one(pool)
        .await?;

        TaskNotification::try_from(row)
    }

    pub async fn delete_by_task(
        pool: &SqlitePool,
        project_id: Uuid,
        task_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM task_notifications WHERE project_id = ? AND task_id = ?")
                .bind(project_id)
                .bind(task_id)
                .execute(pool)
                .await?;

        Ok(result.rows_affected())
    }

    pub async fn delete_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM task_notifications WHERE project_id = ?")
            .bind(project_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected())
    }

    pub async fn delete_all(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM task_notifications")
            .execute(pool)
            .await?;

        Ok(result.rows_affected())
    }
}
