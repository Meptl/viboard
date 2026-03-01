use axum::{
    Json, Router,
    extract::{
        Query, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json as ResponseJson},
    routing::get,
};
use db::models::task_notification::{CreateTaskNotification, TaskNotification};
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use local_deployment::Deployment;
use serde::Deserialize;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub struct DeleteTaskNotificationsQuery {
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
}

pub async fn list_task_notifications(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskNotification>>>, ApiError> {
    let notifications = TaskNotification::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(notifications)))
}

pub async fn create_task_notification(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTaskNotification>,
) -> Result<ResponseJson<ApiResponse<TaskNotification>>, ApiError> {
    let notification = TaskNotification::create(&deployment.db().pool, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(notification)))
}

pub async fn stream_task_notifications_ws(
    ws: WebSocketUpgrade,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_task_notifications_ws(socket, deployment).await {
            tracing::warn!("task notifications WS closed: {}", e);
        }
    })
}

async fn handle_task_notifications_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
) -> anyhow::Result<()> {
    let mut stream = deployment
        .events()
        .stream_task_notifications_raw()
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    let (mut sender, mut receiver) = socket.split();

    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => {
                if sender.send(msg).await.is_err() {
                    break;
                }
            }
            Err(e) => {
                tracing::error!("stream error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

pub async fn delete_task_notifications_for_task(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<DeleteTaskNotificationsQuery>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    match (query.project_id, query.task_id) {
        (Some(project_id), Some(task_id)) => {
            TaskNotification::delete_by_task(&deployment.db().pool, project_id, task_id).await?;
        }
        (Some(project_id), None) => {
            TaskNotification::delete_by_project(&deployment.db().pool, project_id).await?;
        }
        (None, None) => {
            TaskNotification::delete_all(&deployment.db().pool).await?;
        }
        (None, Some(_)) => {
            return Err(ApiError::BadRequest(
                "project_id is required when task_id is provided".to_string(),
            ));
        }
    }
    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/task-notifications",
            get(list_task_notifications)
                .post(create_task_notification)
                .delete(delete_task_notifications_for_task),
        )
        .route(
            "/task-notifications/stream/ws",
            get(stream_task_notifications_ws),
        )
}
