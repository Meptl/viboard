pub mod drafts;
pub mod images;
pub mod queue;
pub mod util;
use std::{
    path::Path,
    time::{Duration, Instant},
};

use axum::{
    Extension, Json, Router,
    extract::{
        Query, State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade, close_code},
    },
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson},
    routing::{get, post},
};
use db::models::{
    draft::DraftStore,
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    merge::Merge,
    project::{Project, ProjectError},
    task::{Task, TaskRelationships, TaskStatus},
    task_attempt::{CreateTaskAttempt, TaskAttempt, TaskAttemptError},
};
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType,
        coding_agent_follow_up::CodingAgentFollowUpRequest,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    },
    profile::ExecutorProfileId,
};
use git2::BranchType;
use local_deployment::Deployment;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use services::services::{
    container::{ContainerService, DiffStreamMode},
    git::{ConflictOp, DiffDetailLevel, DiffTarget, GitService, WorktreeResetOptions},
};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::{
    diff::{Diff, DiffChangeKind, DiffMetadata, create_unified_diff},
    response::ApiResponse,
};
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError, middleware::load_task_attempt_middleware,
    routes::projects::apply_project_settings,
    routes::task_attempts::util::ensure_worktree_path,
};

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct RebaseTaskAttemptRequest {
    pub old_base_branch: Option<String>,
    pub new_base_branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum GitOperationError {
    MergeConflicts { message: String, op: ConflictOp },
    RebaseInProgress,
}

#[derive(Debug, Deserialize)]
pub struct TaskAttemptQuery {
    pub task_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct DiffQuery {
    pub file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskAttemptDiffResponse {
    pub attempt_id: Uuid,
    pub patch: String,
    pub omitted_files: Vec<String>,
}

fn diff_path_label(diff: &Diff) -> String {
    diff.new_path
        .clone()
        .or_else(|| diff.old_path.clone())
        .unwrap_or_else(|| "<unknown>".to_string())
}

fn build_patch_from_diffs(diffs: Vec<Diff>) -> TaskAttemptDiffResponseBuilder {
    let mut patch = String::new();
    let mut omitted_files = Vec::new();

    for diff in diffs {
        let path = diff_path_label(&diff);

        if diff.content_omitted {
            omitted_files.push(path);
            continue;
        }

        let patch_piece = match diff.change {
            DiffChangeKind::Added => diff
                .new_content
                .as_deref()
                .map(|new| create_unified_diff(&path, "", new)),
            DiffChangeKind::Deleted => diff
                .old_content
                .as_deref()
                .map(|old| create_unified_diff(&path, old, "")),
            DiffChangeKind::Modified | DiffChangeKind::Renamed | DiffChangeKind::Copied => diff
                .old_content
                .as_deref()
                .zip(diff.new_content.as_deref())
                .map(|(old, new)| create_unified_diff(&path, old, new)),
            DiffChangeKind::PermissionChange => None,
        };

        let Some(piece) = patch_piece else {
            omitted_files.push(path);
            continue;
        };

        // Skip header-only output (e.g. pure rename/no textual change).
        if !piece.contains("@@ ") {
            omitted_files.push(path);
            continue;
        }

        patch.push_str(&piece);
    }

    TaskAttemptDiffResponseBuilder {
        patch,
        omitted_files,
    }
}

struct TaskAttemptDiffResponseBuilder {
    patch: String,
    omitted_files: Vec<String>,
}

pub async fn get_task_attempts(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskAttemptQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskAttempt>>>, ApiError> {
    let pool = &deployment.db().pool;
    let attempts = TaskAttempt::fetch_all(pool, query.task_id).await?;
    Ok(ResponseJson(ApiResponse::success(attempts)))
}

pub async fn get_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<TaskAttempt>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(task_attempt)))
}

pub async fn get_task_attempt_diff(
    Query(query): Query<DiffQuery>,
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    if let Some(file_path) = query.file {
        let diff = get_task_attempt_diff_for_file(file_path, &task_attempt, &deployment).await?;
        return Ok(ResponseJson(ApiResponse::success(json!(diff))));
    }

    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;

    let project_repo_path = &ctx.project.git_repo_path;
    let latest_merge = Merge::find_latest_by_task_attempt_id(pool, task_attempt.id).await?;

    let is_ahead = deployment
        .git()
        .get_branch_status(
            project_repo_path,
            &task_attempt.branch,
            &task_attempt.target_branch,
        )
        .map(|(ahead, _)| ahead > 0)
        .unwrap_or(false);

    let latest_merge_commit = latest_merge.as_ref().map(Merge::merge_commit);

    let diffs = if let Some(commit) = latest_merge_commit
        && deployment
            .container()
            .is_container_clean(&task_attempt)
            .await?
        && !is_ahead
    {
        deployment.git().get_diffs(
            DiffTarget::Commit {
                repo_path: project_repo_path,
                commit_sha: &commit,
            },
            None,
            DiffDetailLevel::FullContent,
        )?
    } else {
        let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
        let base_commit = deployment.git().get_base_commit(
            project_repo_path,
            &task_attempt.branch,
            &task_attempt.target_branch,
        )?;
        deployment.git().get_diffs(
            DiffTarget::Worktree {
                worktree_path: worktree_path_buf.as_path(),
                base_commit: &base_commit,
            },
            None,
            DiffDetailLevel::FullContent,
        )?
    };

    let built = build_patch_from_diffs(diffs);
    Ok(ResponseJson(ApiResponse::success(json!(
        TaskAttemptDiffResponse {
            attempt_id: task_attempt.id,
            patch: built.patch,
            omitted_files: built.omitted_files,
        }
    ))))
}

async fn get_task_attempt_diff_for_file(
    file_path: String,
    task_attempt: &TaskAttempt,
    deployment: &DeploymentImpl,
) -> Result<Diff, ApiError> {
    // @lat: [[lazy-diff-loading#On-Demand File Content Fetch]]
    let started_at = Instant::now();
    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;

    let project_repo_path = &ctx.project.git_repo_path;
    let latest_merge = Merge::find_latest_by_task_attempt_id(pool, task_attempt.id).await?;

    let is_ahead = deployment
        .git()
        .get_branch_status(
            project_repo_path,
            &task_attempt.branch,
            &task_attempt.target_branch,
        )
        .map(|(ahead, _)| ahead > 0)
        .unwrap_or(false);

    let path_filter = [file_path.as_str()];
    let latest_merge_commit = latest_merge.as_ref().map(Merge::merge_commit);
    let git = deployment.git();
    let should_retry_without_path_filter = |err: &services::services::git::GitServiceError| {
        let msg = err.to_string();
        msg.contains("pathspec") && msg.contains("did not match any files")
    };

    let before_diff_fetch = Instant::now();
    let diffs = if let Some(commit) = latest_merge_commit
        && deployment
            .container()
            .is_container_clean(&task_attempt)
            .await?
        && !is_ahead
    {
        match git.get_diffs(
            DiffTarget::Commit {
                repo_path: project_repo_path,
                commit_sha: &commit,
            },
            Some(&path_filter),
            DiffDetailLevel::FullContent,
        ) {
            Ok(diffs) => diffs,
            Err(err) if should_retry_without_path_filter(&err) => git.get_diffs(
                DiffTarget::Commit {
                    repo_path: project_repo_path,
                    commit_sha: &commit,
                },
                None,
                DiffDetailLevel::FullContent,
            )?,
            Err(err) => return Err(err.into()),
        }
    } else {
        let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
        let base_commit = deployment.git().get_base_commit(
            project_repo_path,
            &task_attempt.branch,
            &task_attempt.target_branch,
        )?;
        match git.get_diffs(
            DiffTarget::Worktree {
                worktree_path: worktree_path_buf.as_path(),
                base_commit: &base_commit,
            },
            Some(&path_filter),
            DiffDetailLevel::FullContent,
        ) {
            Ok(diffs) => diffs,
            Err(err) if should_retry_without_path_filter(&err) => git.get_diffs(
                DiffTarget::Worktree {
                    worktree_path: worktree_path_buf.as_path(),
                    base_commit: &base_commit,
                },
                None,
                DiffDetailLevel::FullContent,
            )?,
            Err(err) => return Err(err.into()),
        }
    };
    let diff_fetch_ms = before_diff_fetch.elapsed().as_millis();

    let diff = diffs
        .into_iter()
        .find(|d| GitService::diff_path(d) == file_path)
        .ok_or_else(|| {
            ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                "Diff file not found".to_string(),
            ))
        })?;

    let total_ms = started_at.elapsed().as_millis();
    tracing::info!(
        attempt_id = %task_attempt.id,
        path = %file_path,
        diff_fetch_ms,
        total_ms,
        "diff-file timing"
    );

    Ok(diff)
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
pub struct CreateTaskAttemptBody {
    pub task_id: Uuid,
    /// Executor profile specification
    pub executor_profile_id: ExecutorProfileId,
    pub base_branch: String,
}

impl CreateTaskAttemptBody {
    /// Get the executor profile ID
    pub fn get_executor_profile_id(&self) -> ExecutorProfileId {
        self.executor_profile_id.clone()
    }
}

#[axum::debug_handler]
pub async fn create_task_attempt(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTaskAttemptBody>,
) -> Result<ResponseJson<ApiResponse<TaskAttempt>>, ApiError> {
    let pool = &deployment.db().pool;
    let executor_profile_id = payload.get_executor_profile_id();
    let task = Task::find_by_id(pool, payload.task_id)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Link task to parent attempt if base_branch matches an existing attempt's branch
    if task.parent_task_attempt.is_none()
        && let Some(parent) =
            TaskAttempt::find_by_branch(pool, task.project_id, &payload.base_branch).await?
    {
        Task::update_parent_task_attempt(pool, task.id, Some(parent.id)).await?;
    }

    // Any existing attempts for this task become stale once a new attempt is created.
    // Ensure setup-script subprocess groups from stale attempts are terminated.
    let existing_attempts = TaskAttempt::fetch_all(pool, Some(task.id)).await?;
    for stale_attempt in existing_attempts {
        deployment
            .container()
            .cleanup_setup_script_subprocesses(stale_attempt.id)
            .await;
    }

    let attempt_id = Uuid::new_v4();
    let git_branch_name = deployment
        .container()
        .git_branch_from_task_attempt(&attempt_id, &task.title)
        .await;

    let task_attempt = TaskAttempt::create(
        pool,
        &CreateTaskAttempt {
            executor: executor_profile_id.executor,
            base_branch: payload.base_branch.clone(),
            branch: git_branch_name.clone(),
        },
        attempt_id,
        payload.task_id,
    )
    .await?;

    if let Err(err) = deployment
        .container()
        .start_attempt(&task_attempt, executor_profile_id.clone())
        .await
    {
        tracing::error!("Failed to start task attempt: {}", err);

        deployment
            .container()
            .cleanup_setup_script_subprocesses(task_attempt.id)
            .await;

        if let Ok(Some(latest_attempt)) = TaskAttempt::find_by_id(pool, task_attempt.id).await
            && latest_attempt.container_ref.is_some()
            && let Err(cleanup_err) = deployment.container().delete(&latest_attempt).await
        {
            tracing::warn!(
                "Failed to clean up partially created container for attempt {}: {}",
                task_attempt.id,
                cleanup_err
            );
        }

        return Err(ApiError::Container(err));
    }

    tracing::info!("Created attempt for task {}", task.id);

    Ok(ResponseJson(ApiResponse::success(task_attempt)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateFollowUpAttempt {
    pub prompt: String,
    pub variant: Option<String>,
    pub retry_process_id: Option<Uuid>,
    pub force_when_dirty: Option<bool>,
    pub perform_git_reset: Option<bool>,
}

pub async fn follow_up(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateFollowUpAttempt>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    tracing::info!("{:?}", task_attempt);

    // Ensure worktree exists (recreate if needed for cold task support)
    let _ = ensure_worktree_path(&deployment, &task_attempt).await?;

    // Get executor profile data from the latest CodingAgent process
    let initial_executor_profile_id = ExecutionProcess::latest_executor_profile_for_attempt(
        &deployment.db().pool,
        task_attempt.id,
    )
    .await?;

    let executor_profile_id = ExecutorProfileId {
        executor: initial_executor_profile_id.executor,
        variant: payload.variant,
    };

    // Get parent task
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Get parent project
    let mut project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;
    {
        let config = deployment.config().read().await;
        apply_project_settings(&mut project, &config);
    }

    // If retry settings provided, perform replace-logic before proceeding
    if let Some(proc_id) = payload.retry_process_id {
        let pool = &deployment.db().pool;
        // Validate process belongs to attempt
        let process =
            ExecutionProcess::find_by_id(pool, proc_id)
                .await?
                .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                    "Process not found".to_string(),
                )))?;
        if process.task_attempt_id != task_attempt.id {
            return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                "Process does not belong to this attempt".to_string(),
            )));
        }

        // Determine target reset OID: before the target process
        let mut target_before_oid = process.before_head_commit.clone();
        if target_before_oid.is_none() {
            target_before_oid =
                ExecutionProcess::find_prev_after_head_commit(pool, task_attempt.id, proc_id)
                    .await?;
        }

        // Decide if Git reset is needed and apply it (best-effort)
        let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
        let perform_git_reset = payload.perform_git_reset.unwrap_or(true);
        if let Some(target_oid) = &target_before_oid {
            let wt_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
            let wt = wt_buf.as_path();
            let is_dirty = deployment
                .container()
                .is_container_clean(&task_attempt)
                .await
                .map(|is_clean| !is_clean)
                .unwrap_or(false);

            deployment.git().reconcile_worktree_to_commit(
                wt,
                target_oid,
                WorktreeResetOptions::new(
                    perform_git_reset,
                    force_when_dirty,
                    is_dirty,
                    perform_git_reset,
                ),
            );
        }

        // Stop any running processes for this attempt (except dev server)
        deployment.container().try_stop(&task_attempt, false).await;

        // Soft-drop the target process and all later processes
        let _ = ExecutionProcess::drop_at_and_after(pool, task_attempt.id, proc_id).await?;
    }

    let latest_session_id = ExecutionProcess::find_latest_session_id_by_task_attempt(
        &deployment.db().pool,
        task_attempt.id,
    )
    .await?;

    let cleanup_action = deployment
        .container()
        .cleanup_action(project.cleanup_script);

    let action_type = if let Some(session_id) = latest_session_id {
        ExecutorActionType::CodingAgentFollowUpRequest(CodingAgentFollowUpRequest {
            prompt: payload.prompt.clone(),
            session_id,
            executor_profile_id: executor_profile_id.clone(),
        })
    } else {
        ExecutorActionType::CodingAgentInitialRequest(
            executors::actions::coding_agent_initial::CodingAgentInitialRequest {
                prompt: task.with_agent_conversation_metadata(&payload.prompt),
                executor_profile_id: executor_profile_id.clone(),
            },
        )
    };

    let action = ExecutorAction::new(action_type, cleanup_action);

    let execution_process = deployment
        .container()
        .start_execution(
            &task_attempt,
            &action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .await?;

    if let Err(e) = DraftStore::delete_follow_up(&deployment.db().pool, task_attempt.id).await {
        tracing::warn!(
            "Failed to clear follow-up draft for attempt {}: {}",
            task_attempt.id,
            e
        );
    }

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

#[axum::debug_handler]
pub async fn stream_task_attempt_diff_metadata_ws(
    ws: WebSocketUpgrade,
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_task_attempt_diff_ws(socket, deployment, task_attempt).await {
            tracing::warn!("diff metadata WS closed: {}", e);
        }
    })
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DiffMetadataWsMessage {
    Snapshot {
        entries: std::collections::HashMap<String, DiffMetadata>,
    },
    Upsert {
        path: String,
        diff: DiffMetadata,
    },
    Remove {
        path: String,
    },
}

enum DiffMetadataPatchEvent {
    Upsert { path: String, diff: DiffMetadata },
    Remove { path: String },
}

fn unescape_json_pointer_segment(input: &str) -> String {
    input.replace("~1", "/").replace("~0", "~")
}

fn parse_diff_metadata_patch_events(patch: &Value) -> Vec<DiffMetadataPatchEvent> {
    let mut events = Vec::new();
    let Some(ops) = patch.as_array() else {
        return events;
    };

    for op in ops {
        let Some(op_kind) = op.get("op").and_then(Value::as_str) else {
            continue;
        };
        let Some(path) = op.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(key) = path.strip_prefix("/entries/") else {
            continue;
        };
        let decoded_path = unescape_json_pointer_segment(key);

        match op_kind {
            "add" | "replace" => {
                let Some(content) = op
                    .get("value")
                    .and_then(|v| v.get("type").and_then(Value::as_str).map(|_| v))
                    .and_then(|v| {
                        if v.get("type").and_then(Value::as_str) == Some("DIFF_METADATA") {
                            v.get("content")
                        } else {
                            None
                        }
                    })
                else {
                    continue;
                };

                let Ok(diff) = serde_json::from_value::<DiffMetadata>(content.clone()) else {
                    continue;
                };
                events.push(DiffMetadataPatchEvent::Upsert {
                    path: decoded_path,
                    diff,
                });
            }
            "remove" => {
                events.push(DiffMetadataPatchEvent::Remove { path: decoded_path });
            }
            _ => {}
        }
    }

    events
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffWsSessionMode {
    Idle,
    Live,
}

fn diff_metadata_eq(a: &DiffMetadata, b: &DiffMetadata) -> bool {
    std::mem::discriminant(&a.change) == std::mem::discriminant(&b.change)
        && a.old_path == b.old_path
        && a.new_path == b.new_path
        && a.content_omitted == b.content_omitted
        && a.additions == b.additions
        && a.deletions == b.deletions
}

fn apply_diff_metadata_event(
    entries: &mut std::collections::HashMap<String, DiffMetadata>,
    event: DiffMetadataPatchEvent,
) -> Option<DiffMetadataWsMessage> {
    match event {
        DiffMetadataPatchEvent::Upsert { path, diff } => {
            if entries
                .get(&path)
                .is_some_and(|existing| diff_metadata_eq(existing, &diff))
            {
                return None;
            }
            entries.insert(path.clone(), diff.clone());
            Some(DiffMetadataWsMessage::Upsert { path, diff })
        }
        DiffMetadataPatchEvent::Remove { path } => {
            if entries.remove(&path).is_none() {
                return None;
            }
            Some(DiffMetadataWsMessage::Remove { path })
        }
    }
}

async fn send_diff_ws_message(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: DiffMetadataWsMessage,
) -> anyhow::Result<()> {
    use futures_util::SinkExt;

    let payload = serde_json::to_string(&message)?;
    sender.send(Message::Text(payload.into())).await?;
    Ok(())
}

async fn handle_task_attempt_diff_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    task_attempt: TaskAttempt,
) -> anyhow::Result<()> {
    use futures_util::{SinkExt, StreamExt, stream::BoxStream};
    use utils::log_msg::LogMsg;

    async fn refresh_task_attempt(
        deployment: &DeploymentImpl,
        fallback: &TaskAttempt,
    ) -> anyhow::Result<TaskAttempt> {
        Ok(TaskAttempt::find_by_id(&deployment.db().pool, fallback.id)
            .await?
            .unwrap_or_else(|| fallback.clone()))
    }

    async fn has_relevant_running_execution_process(
        deployment: &DeploymentImpl,
        task_attempt_id: Uuid,
    ) -> anyhow::Result<bool> {
        let processes = ExecutionProcess::find_by_task_attempt_id(
            &deployment.db().pool,
            task_attempt_id,
            false,
        )
        .await?;
        Ok(processes.into_iter().any(|process| {
            process.status == ExecutionProcessStatus::Running
                && !matches!(process.run_reason, ExecutionProcessRunReason::DevServer)
        }))
    }

    fn has_available_worktree(attempt: &TaskAttempt) -> bool {
        let Some(container_ref) = attempt.container_ref.as_ref() else {
            return false;
        };
        !attempt.worktree_deleted && Path::new(container_ref).exists()
    }

    async fn should_enter_live_mode(
        deployment: &DeploymentImpl,
        fallback: &TaskAttempt,
    ) -> anyhow::Result<Option<TaskAttempt>> {
        if !has_relevant_running_execution_process(deployment, fallback.id).await? {
            return Ok(None);
        }
        let current_attempt = refresh_task_attempt(deployment, fallback).await?;
        if has_available_worktree(&current_attempt) {
            Ok(Some(current_attempt))
        } else {
            Ok(None)
        }
    }

    async fn load_initial_snapshot_entries(
        deployment: &DeploymentImpl,
        task_attempt: &TaskAttempt,
    ) -> anyhow::Result<std::collections::HashMap<String, DiffMetadata>> {
        let stream = deployment
            .container()
            .stream_diff(task_attempt, DiffStreamMode::Snapshot)
            .await?;
        let mut stream = stream;
        let mut entries = std::collections::HashMap::new();
        while let Some(item) = stream.next().await {
            match item {
                Ok(LogMsg::JsonPatch(patch)) => {
                    let patch_value = serde_json::to_value(&patch).unwrap_or(Value::Null);
                    for event in parse_diff_metadata_patch_events(&patch_value) {
                        match event {
                            DiffMetadataPatchEvent::Upsert { path, diff } => {
                                entries.insert(path, diff);
                            }
                            DiffMetadataPatchEvent::Remove { path } => {
                                entries.remove(&path);
                            }
                        }
                    }
                }
                Ok(LogMsg::Finished) => break,
                Ok(_) => {}
                Err(err) => return Err(err.into()),
            }
        }
        Ok(entries)
    }

    async fn start_live_stream(
        deployment: &DeploymentImpl,
        task_attempt: &TaskAttempt,
    ) -> anyhow::Result<BoxStream<'static, Result<LogMsg, std::io::Error>>> {
        deployment
            .container()
            .stream_diff(task_attempt, DiffStreamMode::Live)
            .await
            .map_err(Into::into)
    }

    let current_attempt = refresh_task_attempt(&deployment, &task_attempt).await?;
    let mut entries = load_initial_snapshot_entries(&deployment, &current_attempt).await?;

    let (mut sender, mut receiver) = socket.split();
    send_diff_ws_message(
        &mut sender,
        DiffMetadataWsMessage::Snapshot {
            entries: entries.clone(),
        },
    )
    .await?;

    let mut mode = DiffWsSessionMode::Idle;
    let mut live_stream: Option<BoxStream<'static, Result<LogMsg, std::io::Error>>> = None;

    if let Some(live_attempt) = should_enter_live_mode(&deployment, &task_attempt).await? {
        match start_live_stream(&deployment, &live_attempt).await {
            Ok(stream) => {
                mode = DiffWsSessionMode::Live;
                live_stream = Some(stream);
            }
            Err(err) => {
                tracing::warn!(
                    "failed to start initial live diff stream for attempt {}: {}",
                    task_attempt.id,
                    err
                );
            }
        }
    }

    let mut lifecycle_poll = tokio::time::interval(Duration::from_secs(1));
    lifecycle_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        match mode {
            DiffWsSessionMode::Idle => {
                tokio::select! {
                    msg = receiver.next() => {
                        match msg {
                            None => break,
                            Some(Ok(Message::Close(_))) => break,
                            Some(_) => {}
                        };
                    }
                    _ = lifecycle_poll.tick() => {
                        if let Some(live_attempt) = should_enter_live_mode(&deployment, &task_attempt).await? {
                            match start_live_stream(&deployment, &live_attempt).await {
                                Ok(stream) => {
                                    mode = DiffWsSessionMode::Live;
                                    live_stream = Some(stream);
                                }
                                Err(err) => {
                                    tracing::warn!(
                                        "failed to start live diff stream for attempt {}: {}",
                                        task_attempt.id,
                                        err
                                    );
                                }
                            }
                        }
                    }
                }
            }
            DiffWsSessionMode::Live => {
                let stream = live_stream
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("live mode without stream"))?;
                tokio::select! {
                    msg = receiver.next() => {
                        match msg {
                            None => break,
                            Some(Ok(Message::Close(_))) => break,
                            Some(_) => {}
                        };
                    }
                    _ = lifecycle_poll.tick() => {
                        if should_enter_live_mode(&deployment, &task_attempt).await?.is_none() {
                            live_stream = None;
                            mode = DiffWsSessionMode::Idle;
                        }
                    }
                    item = stream.next() => {
                        match item {
                            Some(Ok(LogMsg::JsonPatch(patch))) => {
                                let patch_value = serde_json::to_value(&patch).unwrap_or(Value::Null);
                                for event in parse_diff_metadata_patch_events(&patch_value) {
                                    if let Some(out_msg) = apply_diff_metadata_event(&mut entries, event) {
                                        send_diff_ws_message(&mut sender, out_msg).await?;
                                    }
                                }
                            }
                            Some(Ok(LogMsg::Finished)) => {}
                            Some(Ok(_)) => {}
                            Some(Err(err)) => {
                                tracing::error!("live diff stream error for attempt {}: {}", task_attempt.id, err);
                                live_stream = None;
                                mode = DiffWsSessionMode::Idle;
                            }
                            None => {
                                live_stream = None;
                                mode = DiffWsSessionMode::Idle;
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = sender
        .send(Message::Close(Some(CloseFrame {
            code: close_code::NORMAL,
            reason: "client_disconnect".into(),
        })))
        .await;
    Ok(())
}

#[derive(Debug, Serialize, TS)]
pub struct CommitCompareResult {
    pub subject: String,
    pub head_oid: String,
    pub target_oid: String,
    pub ahead_from_head: usize,
    pub behind_from_head: usize,
    pub is_linear: bool,
}

pub async fn compare_commit_to_head(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<ResponseJson<ApiResponse<CommitCompareResult>>, ApiError> {
    let Some(target_oid) = params.get("sha").cloned() else {
        return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Missing sha param".to_string(),
        )));
    };
    let wt_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let wt = wt_buf.as_path();
    let subject = deployment.git().get_commit_subject(wt, &target_oid)?;
    let head_info = deployment.git().get_head_info(wt)?;
    let (ahead_from_head, behind_from_head) =
        deployment
            .git()
            .ahead_behind_commits_by_oid(wt, &head_info.oid, &target_oid)?;
    let is_linear = behind_from_head == 0;
    Ok(ResponseJson(ApiResponse::success(CommitCompareResult {
        subject,
        head_oid: head_info.oid,
        target_oid,
        ahead_from_head,
        behind_from_head,
        is_linear,
    })))
}

#[axum::debug_handler]
pub async fn merge_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;

    if ctx.task_attempt.branch == "main" {
        return Ok(ResponseJson(ApiResponse::error(
            "Cannot merge: task attempt worktree is on 'main'.",
        )));
    }

    let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let worktree_path = worktree_path_buf.as_path();

    // Create commit message with task title as header.
    let mut commit_message = ctx.task.title.clone();

    // Add description on next line if it exists
    if let Some(description) = &ctx.task.description
        && !description.trim().is_empty()
    {
        commit_message.push_str("\n\n");
        commit_message.push_str(description);
    }

    let merge_commit_id = deployment.git().merge_changes(
        &ctx.project.git_repo_path,
        worktree_path,
        &ctx.task_attempt.branch,
        &ctx.task_attempt.target_branch,
        &commit_message,
    )?;

    Merge::create(
        pool,
        task_attempt.id,
        &ctx.task_attempt.target_branch,
        &merge_commit_id,
    )
    .await?;
    Task::update_status(pool, ctx.task.id, TaskStatus::Done).await?;
    // Moving the task to done makes all attempts stale for setup-script subprocess retention.
    let attempts = TaskAttempt::fetch_all(pool, Some(ctx.task.id)).await?;
    for attempt in attempts {
        deployment
            .container()
            .cleanup_setup_script_subprocesses(attempt.id)
            .await;
    }

    // Stop any running dev servers for this task attempt
    let dev_servers =
        ExecutionProcess::find_running_dev_servers_by_task_attempt(pool, task_attempt.id).await?;

    for dev_server in dev_servers {
        tracing::info!(
            "Stopping dev server {} for completed task attempt {}",
            dev_server.id,
            task_attempt.id
        );

        if let Err(e) = deployment
            .container()
            .stop_execution(&dev_server, ExecutionProcessStatus::Killed)
            .await
        {
            tracing::error!(
                "Failed to stop dev server {} for task attempt {}: {}",
                dev_server.id,
                task_attempt.id,
                e
            );
        }
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(serde::Deserialize, TS)]
pub struct OpenEditorRequest {
    editor_type: Option<String>,
    file_path: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct OpenEditorResponse {
    pub url: Option<String>,
}

pub async fn open_task_attempt_in_editor(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<OpenEditorRequest>,
) -> Result<ResponseJson<ApiResponse<OpenEditorResponse>>, ApiError> {
    // Get the task attempt to access the worktree path
    let base_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let base_path = base_path_buf.as_path();

    let file_path = payload.file_path.as_ref().map(|path| base_path.join(path));
    let path = file_path.as_deref().unwrap_or(base_path);

    let editor_config = {
        let config = deployment.config().read().await;
        let editor_type_str = payload.editor_type.as_deref();
        config.editor.with_override(editor_type_str)
    };

    match editor_config
        .open_file(base_path, file_path.as_deref())
        .await
    {
        Ok(url) => {
            tracing::info!(
                "Opened editor for task attempt {} at path: {}{}",
                task_attempt.id,
                path.display(),
                if url.is_some() { " (remote mode)" } else { "" }
            );

            Ok(ResponseJson(ApiResponse::success(OpenEditorResponse {
                url,
            })))
        }
        Err(e) => {
            tracing::error!(
                "Failed to open editor for attempt {}: {:?}",
                task_attempt.id,
                e
            );
            Err(ApiError::EditorOpen(e))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BranchStatus {
    pub commits_behind: Option<usize>,
    pub commits_ahead: Option<usize>,
    pub has_uncommitted_changes: Option<bool>,
    pub head_oid: Option<String>,
    pub uncommitted_count: Option<usize>,
    pub untracked_count: Option<usize>,
    pub target_branch_name: String,
    pub remote_commits_behind: Option<usize>,
    pub remote_commits_ahead: Option<usize>,
    pub merges: Vec<Merge>,
    /// True if a `git rebase` is currently in progress in this worktree
    pub is_rebase_in_progress: bool,
    /// Current conflict operation if any
    pub conflict_op: Option<ConflictOp>,
    /// List of files currently in conflicted (unmerged) state
    pub conflicted_files: Vec<String>,
}

pub async fn get_task_attempt_branch_status(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<BranchStatus>>, ApiError> {
    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;
    let has_uncommitted_changes = deployment
        .container()
        .is_container_clean(&task_attempt)
        .await
        .ok()
        .map(|is_clean| !is_clean);
    let head_oid = {
        let wt_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
        let wt = wt_buf.as_path();
        deployment.git().get_head_info(wt).ok().map(|h| h.oid)
    };
    // Detect conflicts and operation in progress (best-effort)
    let (is_rebase_in_progress, conflicted_files, conflict_op) = {
        let wt_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
        let wt = wt_buf.as_path();
        let in_rebase = deployment.git().is_rebase_in_progress(wt).unwrap_or(false);
        let conflicts = deployment
            .git()
            .get_conflicted_files(wt)
            .unwrap_or_default();
        let op = if conflicts.is_empty() {
            None
        } else {
            deployment.git().detect_conflict_op(wt).unwrap_or(None)
        };
        (in_rebase, conflicts, op)
    };
    let (uncommitted_count, untracked_count) = {
        let wt_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
        let wt = wt_buf.as_path();
        match deployment.git().get_worktree_change_counts(wt) {
            Ok((a, b)) => (Some(a), Some(b)),
            Err(_) => (None, None),
        }
    };

    let target_branch_type = deployment
        .git()
        .find_branch_type(&ctx.project.git_repo_path, &task_attempt.target_branch)?;

    let (commits_ahead, commits_behind) = match target_branch_type {
        BranchType::Local => {
            let (a, b) = deployment.git().get_branch_status(
                &ctx.project.git_repo_path,
                &task_attempt.branch,
                &task_attempt.target_branch,
            )?;
            (Some(a), Some(b))
        }
        BranchType::Remote => {
            let (remote_commits_ahead, remote_commits_behind) =
                deployment.git().get_remote_branch_status(
                    &ctx.project.git_repo_path,
                    &task_attempt.branch,
                    Some(&task_attempt.target_branch),
                )?;
            (Some(remote_commits_ahead), Some(remote_commits_behind))
        }
    };
    // Fetch merges for this task attempt and add to branch status
    let merges = Merge::find_by_task_attempt_id(pool, task_attempt.id).await?;
    let (remote_ahead, remote_behind) = (None, None);

    let branch_status = BranchStatus {
        commits_ahead,
        commits_behind,
        has_uncommitted_changes,
        head_oid,
        uncommitted_count,
        untracked_count,
        remote_commits_ahead: remote_ahead,
        remote_commits_behind: remote_behind,
        merges,
        target_branch_name: task_attempt.target_branch,
        is_rebase_in_progress,
        conflict_op,
        conflicted_files,
    };
    Ok(ResponseJson(ApiResponse::success(branch_status)))
}

#[derive(serde::Deserialize, Debug, TS)]
pub struct ChangeTargetBranchRequest {
    pub new_target_branch: String,
}

#[derive(serde::Serialize, Debug, TS)]
pub struct ChangeTargetBranchResponse {
    pub new_target_branch: String,
    pub status: (usize, usize),
}

#[derive(serde::Deserialize, Debug, TS)]
pub struct RenameBranchRequest {
    pub new_branch_name: String,
}

#[derive(serde::Serialize, Debug, TS)]
pub struct RenameBranchResponse {
    pub branch: String,
}

#[axum::debug_handler]
pub async fn change_target_branch(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ChangeTargetBranchRequest>,
) -> Result<ResponseJson<ApiResponse<ChangeTargetBranchResponse>>, ApiError> {
    // Extract new base branch from request body if provided
    let new_target_branch = payload.new_target_branch;
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let mut project = Project::find_by_id(&deployment.db().pool, task.project_id)
        .await?
        .ok_or(ApiError::Project(ProjectError::ProjectNotFound))?;
    {
        let config = deployment.config().read().await;
        apply_project_settings(&mut project, &config);
    }
    let pool = &deployment.db().pool;
    match deployment
        .git()
        .check_branch_exists(&project.git_repo_path, &new_target_branch)?
    {
        true => {
            TaskAttempt::update_target_branch(pool, task_attempt.id, &new_target_branch).await?;
        }
        false => {
            return Ok(ResponseJson(ApiResponse::error(
                format!(
                    "Branch '{}' does not exist in the repository",
                    new_target_branch
                )
                .as_str(),
            )));
        }
    }

    // Link task to parent attempt if new_target_branch matches an existing attempt's branch
    if let Some(parent_attempt) =
        TaskAttempt::find_by_branch(pool, project.id, &new_target_branch).await?
    {
        // Only update if different from current parent
        if task.parent_task_attempt != Some(parent_attempt.id) {
            Task::update_parent_task_attempt(pool, task.id, Some(parent_attempt.id)).await?;
        }
    }

    let status = deployment.git().get_branch_status(
        &project.git_repo_path,
        &task_attempt.branch,
        &new_target_branch,
    )?;

    Ok(ResponseJson(ApiResponse::success(
        ChangeTargetBranchResponse {
            new_target_branch,
            status,
        },
    )))
}

#[axum::debug_handler]
pub async fn rename_branch(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<RenameBranchRequest>,
) -> Result<ResponseJson<ApiResponse<RenameBranchResponse>>, ApiError> {
    let new_branch_name = payload.new_branch_name.trim();

    if new_branch_name.is_empty() {
        return Ok(ResponseJson(ApiResponse::error(
            "Branch name cannot be empty",
        )));
    }

    if new_branch_name == task_attempt.branch {
        return Ok(ResponseJson(ApiResponse::success(RenameBranchResponse {
            branch: task_attempt.branch.clone(),
        })));
    }

    if !git2::Branch::name_is_valid(new_branch_name)? {
        return Ok(ResponseJson(ApiResponse::error(
            "Invalid branch name format",
        )));
    }

    let pool = &deployment.db().pool;
    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;

    let mut project = Project::find_by_id(pool, task.project_id)
        .await?
        .ok_or(ApiError::Project(ProjectError::ProjectNotFound))?;
    {
        let config = deployment.config().read().await;
        apply_project_settings(&mut project, &config);
    }

    if deployment
        .git()
        .check_branch_exists(&project.git_repo_path, new_branch_name)?
    {
        return Ok(ResponseJson(ApiResponse::error(
            "A branch with this name already exists",
        )));
    }

    let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let worktree_path = worktree_path_buf.as_path();

    if deployment.git().is_rebase_in_progress(worktree_path)? {
        return Ok(ResponseJson(ApiResponse::error(
            "Cannot rename branch while rebase is in progress. Please complete or abort the rebase first.",
        )));
    }

    deployment
        .git()
        .rename_local_branch(worktree_path, &task_attempt.branch, new_branch_name)?;

    let old_branch = task_attempt.branch.clone();

    TaskAttempt::update_branch_name(pool, task_attempt.id, new_branch_name).await?;

    let updated_children_count = TaskAttempt::update_target_branch_for_children_of_attempt(
        pool,
        task_attempt.id,
        &old_branch,
        new_branch_name,
    )
    .await?;

    if updated_children_count > 0 {
        tracing::info!(
            "Updated {} child task attempts to target new branch '{}'",
            updated_children_count,
            new_branch_name
        );
    }

    Ok(ResponseJson(ApiResponse::success(RenameBranchResponse {
        branch: new_branch_name.to_string(),
    })))
}

#[axum::debug_handler]
pub async fn rebase_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<RebaseTaskAttemptRequest>,
) -> Result<ResponseJson<ApiResponse<(), GitOperationError>>, ApiError> {
    let old_base_branch = payload
        .old_base_branch
        .unwrap_or(task_attempt.target_branch.clone());
    let new_base_branch = payload
        .new_base_branch
        .unwrap_or(task_attempt.target_branch.clone());

    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;
    match deployment
        .git()
        .check_branch_exists(&ctx.project.git_repo_path, &new_base_branch)?
    {
        true => {
            TaskAttempt::update_target_branch(
                &deployment.db().pool,
                task_attempt.id,
                &new_base_branch,
            )
            .await?;
        }
        false => {
            return Ok(ResponseJson(ApiResponse::error(
                format!(
                    "Branch '{}' does not exist in the repository",
                    new_base_branch
                )
                .as_str(),
            )));
        }
    }

    let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let worktree_path = worktree_path_buf.as_path();
    let attempt_id = task_attempt.id.to_string();

    let result = deployment.git().rebase_branch(
        &ctx.project.git_repo_path,
        worktree_path,
        &new_base_branch,
        &old_base_branch,
        &task_attempt.branch.clone(),
        Some(attempt_id.as_str()),
    );
    if let Err(e) = result {
        use services::services::git::GitServiceError;
        return match e {
            GitServiceError::MergeConflicts(msg) => Ok(ResponseJson(ApiResponse::<
                (),
                GitOperationError,
            >::error_with_data(
                GitOperationError::MergeConflicts {
                    message: msg,
                    op: ConflictOp::Rebase,
                },
            ))),
            GitServiceError::RebaseInProgress => Ok(ResponseJson(ApiResponse::<
                (),
                GitOperationError,
            >::error_with_data(
                GitOperationError::RebaseInProgress,
            ))),
            other => Err(ApiError::GitService(other)),
        };
    }

    // Link task to parent attempt if new_base_branch matches an existing attempt's branch
    if let Some(parent_attempt) =
        TaskAttempt::find_by_branch(pool, ctx.project.id, &new_base_branch).await?
    {
        // Only update if different from current parent
        if task.parent_task_attempt != Some(parent_attempt.id) {
            Task::update_parent_task_attempt(pool, task.id, Some(parent_attempt.id)).await?;
        }
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

#[axum::debug_handler]
pub async fn abort_conflicts_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Resolve worktree path for this attempt
    let worktree_path_buf = ensure_worktree_path(&deployment, &task_attempt).await?;
    let worktree_path = worktree_path_buf.as_path();

    let attempt_id = task_attempt.id.to_string();
    deployment
        .git()
        .abort_conflicts(worktree_path, Some(attempt_id.as_str()))?;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[axum::debug_handler]
pub async fn start_dev_server(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    // Get parent task
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Get parent project
    let mut project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;
    {
        let config = deployment.config().read().await;
        apply_project_settings(&mut project, &config);
    }

    let Some(dev_server) = project.dev_script.filter(|script| !script.trim().is_empty()) else {
        return Ok(ResponseJson(ApiResponse::error(
            "No dev server script configured for this project",
        )));
    };

    // Stop any existing dev servers for this project
    let existing_dev_servers =
        match ExecutionProcess::find_running_dev_servers_by_project(pool, project.id).await {
            Ok(servers) => servers,
            Err(e) => {
                tracing::error!(
                    "Failed to find running dev servers for project {}: {}",
                    project.id,
                    e
                );
                return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                    e.to_string(),
                )));
            }
        };

    for dev_server_process in existing_dev_servers {
        tracing::info!(
            "Stopping existing dev server {} for project {}",
            dev_server_process.id,
            project.id
        );

        if let Err(e) = deployment
            .container()
            .stop_execution(&dev_server_process, ExecutionProcessStatus::Killed)
            .await
        {
            tracing::error!("Failed to stop dev server {}: {}", dev_server_process.id, e);
        }
    }

    {
        // TODO: Derive script language from system config
        let executor_action = ExecutorAction::new(
            ExecutorActionType::ScriptRequest(ScriptRequest {
                script: dev_server,
                language: ScriptRequestLanguage::Bash,
                context: ScriptContext::DevServer,
            }),
            None,
        );

        deployment
            .container()
            .start_execution(
                &task_attempt,
                &executor_action,
                &ExecutionProcessRunReason::DevServer,
            )
            .await?
    };

    Ok(ResponseJson(ApiResponse::success(())))
}

#[axum::debug_handler]
pub async fn run_setup_script(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Ensure worktree exists (recreate if needed for cold task support)
    let _ = ensure_worktree_path(&deployment, &task_attempt).await?;

    // Get parent task
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Get parent project
    let project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    let Some(setup_script) = project
        .setup_script
        .filter(|script| !script.trim().is_empty())
    else {
        return Ok(ResponseJson(ApiResponse::error(
            "No setup script configured for this project",
        )));
    };

    let executor_action = ExecutorAction::new(
        ExecutorActionType::ScriptRequest(ScriptRequest {
            script: setup_script,
            language: ScriptRequestLanguage::Bash,
            context: ScriptContext::SetupScript,
        }),
        None,
    );

    deployment
        .container()
        .start_execution(
            &task_attempt,
            &executor_action,
            &ExecutionProcessRunReason::SetupScript,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn get_task_attempt_children(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<TaskRelationships>>, StatusCode> {
    match Task::find_relationships_for_attempt(&deployment.db().pool, &task_attempt).await {
        Ok(relationships) => Ok(ResponseJson(ApiResponse::success(relationships))),
        Err(e) => {
            tracing::error!(
                "Failed to fetch relationships for task attempt {}: {}",
                task_attempt.id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn stop_task_attempt_execution(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    deployment.container().try_stop(&task_attempt, false).await;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let task_attempt_id_router = Router::new()
        .route("/", get(get_task_attempt))
        .route("/diff", get(get_task_attempt_diff))
        .route("/follow-up", post(follow_up))
        .route("/run-setup-script", post(run_setup_script))
        .route("/commit-compare", get(compare_commit_to_head))
        .route("/start-dev-server", post(start_dev_server))
        .route("/branch-status", get(get_task_attempt_branch_status))
        .route(
            "/diff-metadata-ws",
            get(stream_task_attempt_diff_metadata_ws),
        )
        .route("/merge", post(merge_task_attempt))
        .route("/rebase", post(rebase_task_attempt))
        .route("/conflicts/abort", post(abort_conflicts_task_attempt))
        .route("/open-editor", post(open_task_attempt_in_editor))
        .route("/children", get(get_task_attempt_children))
        .route("/stop", post(stop_task_attempt_execution))
        .route("/change-target-branch", post(change_target_branch))
        .route("/rename-branch", post(rename_branch))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_task_attempt_middleware,
        ));

    let task_attempts_router = Router::new()
        .route("/", get(get_task_attempts).post(create_task_attempt))
        .nest("/{id}", task_attempt_id_router)
        .nest("/{id}/images", images::router(deployment))
        .nest("/{id}/draft", drafts::router(deployment))
        .nest("/{id}/queue", queue::router(deployment));

    Router::new().nest("/task-attempts", task_attempts_router)
}
