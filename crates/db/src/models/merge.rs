use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS, FromRow)]
pub struct Merge {
    pub id: Uuid,
    pub task_attempt_id: Uuid,
    pub merge_commit: String,
    pub target_branch_name: String,
    pub created_at: DateTime<Utc>,
}

impl Merge {
    pub fn merge_commit(&self) -> String {
        self.merge_commit.clone()
    }

    pub async fn create(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
        target_branch_name: &str,
        merge_commit: &str,
    ) -> Result<Merge, sqlx::Error> {
        let id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query_as::<_, Merge>(
            r#"INSERT INTO merges (
                id, task_attempt_id, merge_commit, created_at, target_branch_name
            ) VALUES (?, ?, ?, ?, ?)
            RETURNING id, task_attempt_id, merge_commit, target_branch_name, created_at"#,
        )
        .bind(id)
        .bind(task_attempt_id)
        .bind(merge_commit)
        .bind(now)
        .bind(target_branch_name)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_task_attempt_id(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Merge>(
            r#"SELECT
                id, task_attempt_id, merge_commit, target_branch_name, created_at
            FROM merges
            WHERE task_attempt_id = ?
            ORDER BY created_at DESC"#,
        )
        .bind(task_attempt_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_latest_by_task_attempt_id(
        pool: &SqlitePool,
        task_attempt_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Merge>(
            r#"SELECT
                id, task_attempt_id, merge_commit, target_branch_name, created_at
            FROM merges
            WHERE task_attempt_id = ?
            ORDER BY created_at DESC
            LIMIT 1"#,
        )
        .bind(task_attempt_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_task_id(
        pool: &SqlitePool,
        task_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Merge>(
            r#"SELECT
                m.id, m.task_attempt_id, m.merge_commit, m.target_branch_name, m.created_at
            FROM merges m
            INNER JOIN task_attempts ta ON ta.id = m.task_attempt_id
            WHERE ta.task_id = ?
            ORDER BY m.created_at DESC"#,
        )
        .bind(task_id)
        .fetch_all(pool)
        .await
    }
}
