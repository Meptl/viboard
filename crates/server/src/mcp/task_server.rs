use std::{future::Future, path::PathBuf, str::FromStr};

use db::models::{
    merge::Merge,
    project::Project,
    tag::Tag,
    task::{CreateTask, Task, TaskStatus, TaskWithAttemptStatus, UpdateTask},
    task_attempt::{TaskAttempt, TaskAttemptContext},
};
use executors::{executors::BaseCodingAgent, profile::ExecutorProfileId};
use regex::Regex;
use rmcp::{
    ErrorData, ServerHandler,
    handler::server::tool::{Parameters, ToolRouter},
    model::{
        CallToolResult, Content, Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_handler, tool_router,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json;
use uuid::Uuid;

use crate::routes::{containers::ContainerQuery, task_attempts::CreateTaskAttemptBody};

const CREATE_TASK_TOOL_DESCRIPTION: &str = "Create a new task/ticket in a project.";

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateTaskRequest {
    #[schemars(description = "ID of the project to create the task in")]
    pub project_id: Uuid,
    #[schemars(description = "Title of the task")]
    pub title: String,
    #[schemars(description = "Description of the task")]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct CreateTaskResponse {
    pub task_id: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ProjectSummary {
    #[schemars(description = "Unique identifier of the project")]
    pub id: String,
    #[schemars(description = "Name of the project")]
    pub name: String,
    #[schemars(description = "Path to the git repository")]
    pub git_repo_path: PathBuf,
    #[schemars(description = "Setup script for the project")]
    pub setup_script: Option<String>,
    #[schemars(description = "Cleanup script for the project")]
    pub cleanup_script: Option<String>,
    #[schemars(description = "Development script for the project")]
    pub dev_script: Option<String>,
    #[schemars(description = "When the project was created")]
    pub created_at: String,
    #[schemars(description = "When the project was last updated")]
    pub updated_at: String,
}

impl ProjectSummary {
    fn from_project(project: Project) -> Self {
        Self {
            id: project.id.to_string(),
            name: project.name,
            git_repo_path: project.git_repo_path,
            setup_script: project.setup_script,
            cleanup_script: project.cleanup_script,
            dev_script: project.dev_script,
            created_at: project.created_at.to_rfc3339(),
            updated_at: project.updated_at.to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ListProjectsResponse {
    pub projects: Vec<ProjectSummary>,
    pub count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListTasksRequest {
    #[schemars(description = "The ID of the project to list tasks from")]
    pub project_id: Uuid,
    #[schemars(
        description = "Optional status filter: 'todo', 'inprogress', 'inreview', 'done', 'cancelled'"
    )]
    pub status: Option<String>,
    #[schemars(description = "Maximum number of tasks to return (default: 50)")]
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct TaskSummary {
    #[schemars(description = "The unique identifier of the task")]
    pub id: String,
    #[schemars(description = "The title of the task")]
    pub title: String,
    #[schemars(description = "Current status of the task")]
    pub status: String,
    #[schemars(description = "When the task was created")]
    pub created_at: String,
    #[schemars(description = "When the task was last updated")]
    pub updated_at: String,
    #[schemars(description = "Whether the task has an in-progress execution attempt")]
    pub has_in_progress_attempt: Option<bool>,
    #[schemars(description = "Whether the task has a merged execution attempt")]
    pub has_merged_attempt: Option<bool>,
    #[schemars(description = "Whether the last execution attempt failed")]
    pub last_attempt_failed: Option<bool>,
}

impl TaskSummary {
    fn from_task_with_status(task: TaskWithAttemptStatus) -> Self {
        Self {
            id: task.id.to_string(),
            title: task.title.to_string(),
            status: task.status.to_string(),
            created_at: task.created_at.to_rfc3339(),
            updated_at: task.updated_at.to_rfc3339(),
            has_in_progress_attempt: Some(task.has_in_progress_attempt),
            has_merged_attempt: Some(task.has_merged_attempt),
            last_attempt_failed: Some(task.last_attempt_failed),
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct TaskDetails {
    #[schemars(description = "The unique identifier of the task")]
    pub id: String,
    #[schemars(description = "The title of the task")]
    pub title: String,
    #[schemars(description = "Optional description of the task")]
    pub description: Option<String>,
    #[schemars(description = "Current status of the task")]
    pub status: String,
    #[schemars(description = "When the task was created")]
    pub created_at: String,
    #[schemars(description = "When the task was last updated")]
    pub updated_at: String,
    #[schemars(description = "Whether the task has an in-progress execution attempt")]
    pub has_in_progress_attempt: Option<bool>,
    #[schemars(description = "Whether the task has a merged execution attempt")]
    pub has_merged_attempt: Option<bool>,
    #[schemars(description = "Whether the last execution attempt failed")]
    pub last_attempt_failed: Option<bool>,
}

impl TaskDetails {
    fn from_task(task: Task) -> Self {
        Self {
            id: task.id.to_string(),
            title: task.title,
            description: task.description,
            status: task.status.to_string(),
            created_at: task.created_at.to_rfc3339(),
            updated_at: task.updated_at.to_rfc3339(),
            has_in_progress_attempt: None,
            has_merged_attempt: None,
            last_attempt_failed: None,
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ListTasksResponse {
    pub tasks: Vec<TaskSummary>,
    pub count: usize,
    pub project_id: String,
    pub applied_filters: ListTasksFilters,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ListTasksFilters {
    pub status: Option<String>,
    pub limit: i32,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateTaskRequest {
    #[schemars(description = "The ID of the task to update")]
    pub task_id: Uuid,
    #[schemars(description = "New title for the task")]
    pub title: Option<String>,
    #[schemars(description = "New description for the task")]
    pub description: Option<String>,
    #[schemars(description = "New status: 'todo', 'inprogress', 'inreview', 'done', 'cancelled'")]
    pub status: Option<String>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct UpdateTaskResponse {
    pub task: TaskDetails,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteTaskRequest {
    #[schemars(description = "The ID of the task to delete")]
    pub task_id: Uuid,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StartTaskAttemptRequest {
    #[schemars(description = "The ID of the task to start")]
    pub task_id: Uuid,
    #[schemars(
        description = "The coding agent executor to run ('CLAUDE_CODE', 'CODEX', 'GEMINI', 'OPENCODE')"
    )]
    pub executor: String,
    #[schemars(description = "Optional executor variant, if needed")]
    pub variant: Option<String>,
    #[schemars(description = "The base branch to use for the attempt")]
    pub base_branch: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListTaskAttemptsRequest {
    #[schemars(description = "The ID of the task to list attempts for")]
    pub task_id: Uuid,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetTaskMergesRequest {
    #[schemars(description = "The ID of the task to retrieve merges for")]
    pub task_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct TaskMergeSummary {
    #[schemars(description = "The unique identifier of the merge record")]
    pub id: String,
    #[schemars(description = "The task attempt that produced this merge")]
    pub task_attempt_id: String,
    #[schemars(description = "The merged commit SHA")]
    pub merge_commit: String,
    #[schemars(description = "The target branch this merge was applied to")]
    pub target_branch_name: String,
    #[schemars(description = "When this merge record was created")]
    pub created_at: String,
}

impl TaskMergeSummary {
    fn from_merge(merge: Merge) -> Self {
        Self {
            id: merge.id.to_string(),
            task_attempt_id: merge.task_attempt_id.to_string(),
            merge_commit: merge.merge_commit,
            target_branch_name: merge.target_branch_name,
            created_at: merge.created_at.to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct GetTaskMergesResponse {
    pub task_id: String,
    pub merges: Vec<TaskMergeSummary>,
    pub count: usize,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct TaskAttemptSummary {
    #[schemars(description = "The unique identifier of the attempt")]
    pub id: String,
    #[schemars(description = "The task ID this attempt belongs to")]
    pub task_id: String,
}

impl TaskAttemptSummary {
    fn from_attempt(attempt: TaskAttempt) -> Self {
        Self {
            id: attempt.id.to_string(),
            task_id: attempt.task_id.to_string(),
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct ListTaskAttemptsResponse {
    pub task_id: String,
    pub attempts: Vec<TaskAttemptSummary>,
    pub count: usize,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct StartTaskAttemptResponse {
    pub task_id: String,
    pub attempt_id: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct DeleteTaskResponse {
    pub deleted_task_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetTaskRequest {
    #[schemars(description = "The ID of the task to retrieve")]
    pub task_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct GetTaskResponse {
    pub task: TaskDetails,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetTaskAttemptDiffRequest {
    #[schemars(description = "The ID of the task attempt to retrieve a diff/patch for")]
    pub attempt_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct GetTaskAttemptDiffResponse {
    #[schemars(description = "The ID of the task attempt")]
    pub attempt_id: String,
    #[schemars(description = "Unified diff/patch text for the task attempt")]
    pub patch: String,
    #[schemars(
        description = "Files omitted from the patch (e.g. binary files, permission-only changes, or content omitted)"
    )]
    pub omitted_files: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct TaskServer {
    client: reqwest::Client,
    base_url: String,
    context: Option<McpContext>,
}

#[derive(Debug, Clone, Default)]
struct TaskCreationGuidance {
    title_prompt: Option<String>,
    description_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
pub struct McpContext {
    pub project_id: Uuid,
    pub task_id: Uuid,
    pub task_title: String,
    pub attempt_id: Uuid,
    pub attempt_branch: String,
    pub attempt_target_branch: String,
    pub executor: String,
}

impl TaskServer {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.to_string(),
            context: None,
        }
    }

    pub async fn init(mut self) -> Self {
        let context = self.fetch_context_at_startup().await;

        if context.is_none() {
            tracing::debug!("VK context not available, get_context tool will not be registered");
        } else {
            tracing::info!("VK context loaded, get_context tool available");
        }

        self.context = context;
        self
    }

    fn load_task_creation_guidance_from_config(&self) -> TaskCreationGuidance {
        let path = utils::assets::config_path();
        let config = match std::fs::read_to_string(path) {
            Ok(raw_config) => services::services::config::Config::from(raw_config),
            Err(_) => services::services::config::Config::default(),
        };
        TaskCreationGuidance {
            title_prompt: config.task_title_prompt.and_then(trimmed_non_empty),
            description_prompt: config.task_description_prompt.and_then(trimmed_non_empty),
        }
    }

    fn apply_task_creation_guidance_to_create_tool(
        tool_router: &mut ToolRouter<TaskServer>,
        guidance: TaskCreationGuidance,
    ) {
        let Some(create_task_route) = tool_router.map.get_mut("create_task") else {
            return;
        };

        let mut description = CREATE_TASK_TOOL_DESCRIPTION.to_string();
        if let Some(title_prompt) = guidance.title_prompt.as_ref() {
            description.push_str(&format!(" Title guidance: {}.", title_prompt));
        }
        if let Some(description_prompt) = guidance.description_prompt.as_ref() {
            description.push_str(&format!(" Description guidance: {}.", description_prompt));
        }
        create_task_route.attr.description = Some(description.into());

        let mut schema = (*create_task_route.attr.input_schema).clone();
        if let Some(properties) = schema.get_mut("properties").and_then(|v| v.as_object_mut()) {
            if let Some(title_schema) = properties.get_mut("title").and_then(|v| v.as_object_mut())
                && let Some(title_prompt) = guidance.title_prompt.as_ref()
            {
                title_schema.insert(
                    "description".to_string(),
                    serde_json::Value::String(format!("The title of the task. {}", title_prompt)),
                );
            }

            if let Some(desc_schema) = properties
                .get_mut("description")
                .and_then(|v| v.as_object_mut())
                && let Some(description_prompt) = guidance.description_prompt.as_ref()
            {
                desc_schema.insert(
                    "description".to_string(),
                    serde_json::Value::String(format!(
                        "Optional description of the task. {}",
                        description_prompt
                    )),
                );
            }
        }
        create_task_route.attr.input_schema = std::sync::Arc::new(schema);
    }

    fn tool_router_with_latest_guidance(&self) -> ToolRouter<TaskServer> {
        let mut tool_router = Self::tool_router();
        if self.context.is_none() {
            tool_router.map.remove("get_context");
        }
        let guidance = self.load_task_creation_guidance_from_config();
        Self::apply_task_creation_guidance_to_create_tool(&mut tool_router, guidance);
        tool_router
    }

    async fn fetch_context_at_startup(&self) -> Option<McpContext> {
        let current_dir = std::env::current_dir().ok()?;
        let canonical_path = current_dir.canonicalize().unwrap_or(current_dir);
        let normalized_path = utils::path::normalize_macos_private_alias(&canonical_path);

        let url = self.url("/api/containers/attempt-context");
        let query = ContainerQuery {
            container_ref: normalized_path.to_string_lossy().to_string(),
        };

        let response = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            self.client.get(&url).query(&query).send(),
        )
        .await
        .ok()?
        .ok()?;

        if !response.status().is_success() {
            return None;
        }

        let api_response: ApiResponseEnvelope<TaskAttemptContext> = response.json().await.ok()?;

        if !api_response.success {
            return None;
        }

        let ctx = api_response.data?;
        Some(McpContext {
            project_id: ctx.project.id,
            task_id: ctx.task.id,
            task_title: ctx.task.title,
            attempt_id: ctx.task_attempt.id,
            attempt_branch: ctx.task_attempt.branch,
            attempt_target_branch: ctx.task_attempt.target_branch,
            executor: ctx.task_attempt.executor,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ApiResponseEnvelope<T> {
    success: bool,
    data: Option<T>,
    message: Option<String>,
}

fn trimmed_non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

impl TaskServer {
    fn success<T: Serialize>(data: &T) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(data)
                .unwrap_or_else(|_| "Failed to serialize response".to_string()),
        )]))
    }

    fn err_value(v: serde_json::Value) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::error(vec![Content::text(
            serde_json::to_string_pretty(&v)
                .unwrap_or_else(|_| "Failed to serialize error".to_string()),
        )]))
    }

    fn err<S: Into<String>>(msg: S, details: Option<S>) -> Result<CallToolResult, ErrorData> {
        let mut v = serde_json::json!({"success": false, "error": msg.into()});
        if let Some(d) = details {
            v["details"] = serde_json::json!(d.into());
        };
        Self::err_value(v)
    }

    async fn send_json<T: DeserializeOwned>(
        &self,
        rb: reqwest::RequestBuilder,
    ) -> Result<T, CallToolResult> {
        let resp = rb
            .send()
            .await
            .map_err(|e| Self::err("Failed to connect to VK API", Some(&e.to_string())).unwrap())?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(
                Self::err(format!("VK API returned error status: {}", status), None).unwrap(),
            );
        }

        let api_response = resp.json::<ApiResponseEnvelope<T>>().await.map_err(|e| {
            Self::err("Failed to parse VK API response", Some(&e.to_string())).unwrap()
        })?;

        if !api_response.success {
            let msg = api_response.message.as_deref().unwrap_or("Unknown error");
            return Err(Self::err("VK API returned error", Some(msg)).unwrap());
        }

        api_response
            .data
            .ok_or_else(|| Self::err("VK API response missing data field", None).unwrap())
    }

    fn url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    /// Expands @tagname references in text by replacing them with tag content.
    /// Returns the original text if expansion fails (e.g., network error).
    /// Unknown tags are left as-is (not expanded, not an error).
    async fn expand_tags(&self, text: &str) -> String {
        // Pattern matches @tagname where tagname is non-whitespace, non-@ characters
        let tag_pattern = match Regex::new(r"@([^\s@]+)") {
            Ok(re) => re,
            Err(_) => return text.to_string(),
        };

        // Find all unique tag names referenced in the text
        let tag_names: Vec<String> = tag_pattern
            .captures_iter(text)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        if tag_names.is_empty() {
            return text.to_string();
        }

        // Fetch all tags from the API
        let url = self.url("/api/tags");
        let tags: Vec<Tag> = match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<ApiResponseEnvelope<Vec<Tag>>>().await {
                    Ok(envelope) if envelope.success => envelope.data.unwrap_or_default(),
                    _ => return text.to_string(),
                }
            }
            _ => return text.to_string(),
        };

        // Build a map of tag_name -> content for quick lookup
        let tag_map: std::collections::HashMap<&str, &str> = tags
            .iter()
            .map(|t| (t.tag_name.as_str(), t.content.as_str()))
            .collect();

        // Replace each @tagname with its content (if found)
        let result = tag_pattern.replace_all(text, |caps: &regex::Captures| {
            let tag_name = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            match tag_map.get(tag_name) {
                Some(content) => (*content).to_string(),
                None => caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string(),
            }
        });

        result.into_owned()
    }
}

#[tool_router]
impl TaskServer {
    #[tool(
        description = "Return project, task, and attempt metadata for the current task attempt context."
    )]
    async fn get_context(&self) -> Result<CallToolResult, ErrorData> {
        // Context was fetched at startup and cached
        // This tool is only registered if context exists, so unwrap is safe
        let context = self.context.as_ref().expect("VK context should exist");
        TaskServer::success(context)
    }
    #[tool(
        description = "Create a new task/ticket in a project. Always pass the `project_id` of the project you want to create the task in - it is required!"
    )]
    async fn create_task(
        &self,
        Parameters(CreateTaskRequest {
            project_id,
            title,
            description,
        }): Parameters<CreateTaskRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        // Expand @tagname references in description
        let expanded_description = match description {
            Some(desc) => Some(self.expand_tags(&desc).await),
            None => None,
        };

        let url = self.url("/api/tasks");

        // Get parent_task_attempt from context if available (auto-link subtasks)
        let parent_task_attempt = self.context.as_ref().map(|ctx| ctx.attempt_id);

        let create_payload = CreateTask {
            project_id,
            title,
            description: expanded_description,
            status: Some(TaskStatus::Todo),
            parent_task_attempt,
            image_ids: None,
        };

        let task: Task = match self
            .send_json(self.client.post(&url).json(&create_payload))
            .await
        {
            Ok(t) => t,
            Err(e) => return Ok(e),
        };

        TaskServer::success(&CreateTaskResponse {
            task_id: task.id.to_string(),
        })
    }

    #[tool(description = "List all the available projects")]
    async fn list_projects(&self) -> Result<CallToolResult, ErrorData> {
        let url = self.url("/api/projects");
        let projects: Vec<Project> = match self.send_json(self.client.get(&url)).await {
            Ok(ps) => ps,
            Err(e) => return Ok(e),
        };

        let project_summaries: Vec<ProjectSummary> = projects
            .into_iter()
            .map(ProjectSummary::from_project)
            .collect();

        let response = ListProjectsResponse {
            count: project_summaries.len(),
            projects: project_summaries,
        };

        TaskServer::success(&response)
    }

    #[tool(
        description = "List all the task/tickets in a project with optional filtering and execution status. `project_id` is required!"
    )]
    async fn list_tasks(
        &self,
        Parameters(ListTasksRequest {
            project_id,
            status,
            limit,
        }): Parameters<ListTasksRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let status_filter = if let Some(ref status_str) = status {
            match TaskStatus::from_str(status_str) {
                Ok(s) => Some(s),
                Err(_) => {
                    return Self::err(
                        "Invalid status filter. Valid values: 'todo', 'inprogress', 'inreview', 'done', 'cancelled'".to_string(),
                        Some(status_str.to_string()),
                    );
                }
            }
        } else {
            None
        };

        let url = self.url(&format!("/api/tasks?project_id={}", project_id));
        let all_tasks: Vec<TaskWithAttemptStatus> =
            match self.send_json(self.client.get(&url)).await {
                Ok(t) => t,
                Err(e) => return Ok(e),
            };

        let task_limit = limit.unwrap_or(50).max(0) as usize;
        let filtered = all_tasks.into_iter().filter(|t| {
            if let Some(ref want) = status_filter {
                &t.status == want
            } else {
                true
            }
        });
        let limited: Vec<TaskWithAttemptStatus> = filtered.take(task_limit).collect();

        let task_summaries: Vec<TaskSummary> = limited
            .into_iter()
            .map(TaskSummary::from_task_with_status)
            .collect();

        let response = ListTasksResponse {
            count: task_summaries.len(),
            tasks: task_summaries,
            project_id: project_id.to_string(),
            applied_filters: ListTasksFilters {
                status: status.clone(),
                limit: task_limit as i32,
            },
        };

        TaskServer::success(&response)
    }

    #[tool(description = "Start working on a task by creating and launching a new task attempt.")]
    async fn create_attempt(
        &self,
        Parameters(StartTaskAttemptRequest {
            task_id,
            executor,
            variant,
            base_branch,
        }): Parameters<StartTaskAttemptRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let base_branch = base_branch.trim().to_string();
        if base_branch.is_empty() {
            return Self::err("Base branch must not be empty.".to_string(), None::<String>);
        }

        let executor_trimmed = executor.trim();
        if executor_trimmed.is_empty() {
            return Self::err("Executor must not be empty.".to_string(), None::<String>);
        }

        let normalized_executor = executor_trimmed.replace('-', "_").to_ascii_uppercase();
        let base_executor = match BaseCodingAgent::from_str(&normalized_executor) {
            Ok(exec) => exec,
            Err(_) => {
                return Self::err(
                    format!("Unknown executor '{executor_trimmed}'."),
                    None::<String>,
                );
            }
        };

        let variant = variant.and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let executor_profile_id = ExecutorProfileId {
            executor: base_executor,
            variant,
        };

        let payload = CreateTaskAttemptBody {
            task_id,
            executor_profile_id,
            base_branch,
        };

        let url = self.url("/api/task-attempts");
        let attempt: TaskAttempt = match self.send_json(self.client.post(&url).json(&payload)).await
        {
            Ok(attempt) => attempt,
            Err(e) => return Ok(e),
        };

        let response = StartTaskAttemptResponse {
            task_id: attempt.task_id.to_string(),
            attempt_id: attempt.id.to_string(),
        };

        TaskServer::success(&response)
    }

    #[tool(description = "List all attempts for a given task. `task_id` is required!")]
    async fn list_attempts(
        &self,
        Parameters(ListTaskAttemptsRequest { task_id }): Parameters<ListTaskAttemptsRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/task-attempts?task_id={task_id}"));
        let attempts: Vec<TaskAttempt> = match self.send_json(self.client.get(&url)).await {
            Ok(attempts) => attempts,
            Err(e) => return Ok(e),
        };

        let attempt_summaries = attempts
            .into_iter()
            .map(TaskAttemptSummary::from_attempt)
            .collect::<Vec<_>>();

        let response = ListTaskAttemptsResponse {
            task_id: task_id.to_string(),
            count: attempt_summaries.len(),
            attempts: attempt_summaries,
        };

        TaskServer::success(&response)
    }

    #[tool(description = "List merge records for a given task. `task_id` is required!")]
    async fn get_task_merges(
        &self,
        Parameters(GetTaskMergesRequest { task_id }): Parameters<GetTaskMergesRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/tasks/{task_id}/merges"));
        let merges: Vec<Merge> = match self.send_json(self.client.get(&url)).await {
            Ok(merges) => merges,
            Err(e) => return Ok(e),
        };

        let merge_summaries = merges
            .into_iter()
            .map(TaskMergeSummary::from_merge)
            .collect::<Vec<_>>();

        let response = GetTaskMergesResponse {
            task_id: task_id.to_string(),
            count: merge_summaries.len(),
            merges: merge_summaries,
        };

        TaskServer::success(&response)
    }

    #[tool(
        description = "Update an existing task/ticket's title, description, or status. `project_id` and `task_id` are required! `title`, `description`, and `status` are optional."
    )]
    async fn update_task(
        &self,
        Parameters(UpdateTaskRequest {
            task_id,
            title,
            description,
            status,
        }): Parameters<UpdateTaskRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let status = if let Some(ref status_str) = status {
            match TaskStatus::from_str(status_str) {
                Ok(s) => Some(s),
                Err(_) => {
                    return Self::err(
                        "Invalid status filter. Valid values: 'todo', 'inprogress', 'inreview', 'done', 'cancelled'".to_string(),
                        Some(status_str.to_string()),
                    );
                }
            }
        } else {
            None
        };

        // Expand @tagname references in description
        let expanded_description = match description {
            Some(desc) => Some(self.expand_tags(&desc).await),
            None => None,
        };

        let payload = UpdateTask {
            title,
            description: expanded_description,
            status,
            parent_task_attempt: None,
            image_ids: None,
        };
        let url = self.url(&format!("/api/tasks/{}", task_id));
        let updated_task: Task = match self.send_json(self.client.put(&url).json(&payload)).await {
            Ok(t) => t,
            Err(e) => return Ok(e),
        };

        let details = TaskDetails::from_task(updated_task);
        let repsonse = UpdateTaskResponse { task: details };
        TaskServer::success(&repsonse)
    }

    #[tool(
        description = "Delete a task/ticket from a project. `project_id` and `task_id` are required!"
    )]
    async fn delete_task(
        &self,
        Parameters(DeleteTaskRequest { task_id }): Parameters<DeleteTaskRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/tasks/{}", task_id));
        if let Err(e) = self
            .send_json::<serde_json::Value>(self.client.delete(&url))
            .await
        {
            return Ok(e);
        }

        let repsonse = DeleteTaskResponse {
            deleted_task_id: Some(task_id.to_string()),
        };

        TaskServer::success(&repsonse)
    }

    #[tool(
        description = "Get detailed information (like task description) about a specific task/ticket. You can use `list_tasks` to find the `task_ids` of all tasks in a project. `project_id` and `task_id` are required!"
    )]
    async fn get_task(
        &self,
        Parameters(GetTaskRequest { task_id }): Parameters<GetTaskRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/tasks/{}", task_id));
        let task: Task = match self.send_json(self.client.get(&url)).await {
            Ok(t) => t,
            Err(e) => return Ok(e),
        };

        let details = TaskDetails::from_task(task);
        let response = GetTaskResponse { task: details };

        TaskServer::success(&response)
    }

    #[tool(
        description = "Get a unified diff/patch for a specific task attempt. Returns patch text plus any omitted files (for binary/unsupported changes). `attempt_id` is required."
    )]
    async fn get_attempt_diff(
        &self,
        Parameters(GetTaskAttemptDiffRequest { attempt_id }): Parameters<GetTaskAttemptDiffRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/task-attempts/{attempt_id}/diff"));
        let response: GetTaskAttemptDiffResponse = match self.send_json(self.client.get(&url)).await
        {
            Ok(r) => r,
            Err(e) => return Ok(e),
        };

        TaskServer::success(&response)
    }
}

#[tool_handler(router = self.tool_router_with_latest_guidance())]
impl ServerHandler for TaskServer {
    fn get_info(&self) -> ServerInfo {
        let mut instruction = "A task and project management server. If you need to create or update tickets or tasks then use these tools. Most of them absolutely require that you pass the `project_id` of the project that you are currently working on. You can get project ids by using `list projects`. Call `list_tasks` to fetch the `task_ids` of all the tasks in a project`.. TOOLS: 'list_projects', 'list_tasks', 'create_task', 'create_attempt', 'list_attempts', 'get_task_merges', 'get_task', 'get_attempt_diff', 'update_task', 'delete_task'. Make sure to pass `project_id` or `task_id`/`attempt_id` where required. You can use list tools to get the available ids.".to_string();

        if self.context.is_some() {
            let context_instruction = "Use 'get_context' to fetch project/task/attempt metadata for the active Vibe Kanban attempt when available.";
            instruction = format!("{} {}", context_instruction, instruction);
        }

        ServerInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "vibe-kanban".to_string(),
                version: "1.0.0".to_string(),
            },
            instructions: Some(instruction),
        }
    }
}
