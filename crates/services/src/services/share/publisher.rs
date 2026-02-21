use db::{
    DBService,
    models::{
        task::{Task, TaskStatus},
    },
};
use remote::routes::tasks::SharedTaskResponse;
use uuid::Uuid;

use super::ShareError;

#[derive(Clone)]
pub struct SharePublisher {
    db: DBService,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
pub struct SharedTaskDetails {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
}

impl SharePublisher {
    pub fn new(db: DBService) -> Self {
        Self { db }
    }

    pub async fn share_task(&self, task_id: Uuid, _user_id: Uuid) -> Result<Uuid, ShareError> {
        Task::find_by_id(&self.db.pool, task_id)
            .await?
            .ok_or(ShareError::TaskNotFound(task_id))?;

        Err(ShareError::MissingConfig(
            "remote sharing is disabled in local mode",
        ))
    }

    pub async fn update_shared_task(&self, _task: &Task) -> Result<(), ShareError> {
        Ok(())
    }

    pub async fn update_shared_task_by_id(&self, task_id: Uuid) -> Result<(), ShareError> {
        let task = Task::find_by_id(&self.db.pool, task_id)
            .await?
            .ok_or(ShareError::TaskNotFound(task_id))?;

        self.update_shared_task(&task).await
    }

    pub async fn assign_shared_task(
        &self,
        _shared_task_id: Uuid,
        _new_assignee_user_id: Option<String>,
    ) -> Result<SharedTaskResponse, ShareError> {
        Err(ShareError::MissingConfig(
            "remote sharing is disabled in local mode",
        ))
    }

    pub async fn delete_shared_task(&self, _shared_task_id: Uuid) -> Result<(), ShareError> {
        Ok(())
    }

    pub async fn link_shared_task(
        &self,
        _shared_task: SharedTaskDetails,
    ) -> Result<Option<Task>, ShareError> {
        Ok(None)
    }

    pub async fn cleanup_shared_tasks(&self) -> Result<(), ShareError> {
        Ok(())
    }
}
