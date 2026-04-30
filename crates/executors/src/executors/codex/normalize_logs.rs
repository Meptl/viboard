use std::{collections::HashMap, path::Path, sync::Arc};

use codex_app_server_protocol::{
    CommandExecutionStatus, FileUpdateChange, JSONRPCResponse, McpToolCallStatus, PatchApplyStatus,
    ServerNotification, ThreadItem, ThreadResumeResponse, ThreadStartResponse, TurnPlanStepStatus,
};
use codex_protocol::{openai_models::ReasoningEffort, protocol::McpInvocation};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use workspace_utils::{
    approvals::ApprovalStatus, diff::normalize_unified_diff, msg_store::MsgStore,
    path::make_path_relative,
};

use crate::{
    approvals::ToolCallMetadata,
    logs::{
        ActionType, CommandExitStatus, CommandRunResult, FileChange, NormalizedEntry,
        NormalizedEntryError, NormalizedEntryType, TodoItem, ToolResult, ToolResultValueType,
        ToolStatus,
        stderr_processor::normalize_stderr_logs,
        utils::{
            EntryIndexProvider,
            patch::{add_normalized_entry, replace_normalized_entry, upsert_normalized_entry},
        },
    },
};

trait ToNormalizedEntry {
    fn to_normalized_entry(&self) -> NormalizedEntry;
}

trait ToNormalizedEntryOpt {
    fn to_normalized_entry_opt(&self) -> Option<NormalizedEntry>;
}

#[derive(Default)]
struct StreamingText {
    index: usize,
    content: String,
}

#[derive(Default)]
struct CommandState {
    index: Option<usize>,
    command: String,
    stdout: String,
    stderr: String,
    formatted_output: Option<String>,
    status: ToolStatus,
    exit_code: Option<i32>,
    call_id: String,
}

impl ToNormalizedEntry for CommandState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let content = self.command.to_string();

        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "bash".to_string(),
                action_type: ActionType::CommandRun {
                    command: self.command.clone(),
                    result: Some(CommandRunResult {
                        exit_status: self
                            .exit_code
                            .map(|code| CommandExitStatus::ExitCode { code }),
                        output: if self.formatted_output.is_some() {
                            self.formatted_output.clone()
                        } else {
                            build_command_output(Some(&self.stdout), Some(&self.stderr))
                        },
                    }),
                },
                status: self.status.clone(),
            },
            content,
            metadata: serde_json::to_value(ToolCallMetadata {
                tool_call_id: self.call_id.clone(),
            })
            .ok(),
        }
    }
}

struct McpToolState {
    index: Option<usize>,
    invocation: McpInvocation,
    result: Option<ToolResult>,
    status: ToolStatus,
}

impl ToNormalizedEntry for McpToolState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let tool_name = format!("mcp:{}:{}", self.invocation.server, self.invocation.tool);
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: tool_name.clone(),
                action_type: ActionType::Tool {
                    tool_name,
                    arguments: self.invocation.arguments.clone(),
                    result: self.result.clone(),
                },
                status: self.status.clone(),
            },
            content: self.invocation.tool.clone(),
            metadata: None,
        }
    }
}

#[derive(Default)]
struct WebSearchState {
    index: Option<usize>,
    query: Option<String>,
    status: ToolStatus,
}

impl WebSearchState {
    fn new() -> Self {
        Default::default()
    }
}

impl ToNormalizedEntry for WebSearchState {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "web_search".to_string(),
                action_type: ActionType::WebFetch {
                    url: self.query.clone().unwrap_or_else(|| "...".to_string()),
                },
                status: self.status.clone(),
            },
            content: self
                .query
                .clone()
                .unwrap_or_else(|| "Web search".to_string()),
            metadata: None,
        }
    }
}

#[derive(Default)]
struct PatchState {
    entries: Vec<PatchEntry>,
}

struct PatchEntry {
    index: Option<usize>,
    path: String,
    changes: Vec<FileChange>,
    status: ToolStatus,
    call_id: String,
}

impl ToNormalizedEntry for PatchEntry {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        let content = self.path.clone();

        NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "edit".to_string(),
                action_type: ActionType::FileEdit {
                    path: self.path.clone(),
                    changes: self.changes.clone(),
                },
                status: self.status.clone(),
            },
            content,
            metadata: serde_json::to_value(ToolCallMetadata {
                tool_call_id: self.call_id.clone(),
            })
            .ok(),
        }
    }
}

struct LogState {
    entry_index: EntryIndexProvider,
    assistant: Option<StreamingText>,
    thinking: Option<StreamingText>,
    commands: HashMap<String, CommandState>,
    mcp_tools: HashMap<String, McpToolState>,
    patches: HashMap<String, PatchState>,
    web_searches: HashMap<String, WebSearchState>,
    model_params: ModelParamsState,
}

struct ModelParamsState {
    index: Option<usize>,
    model: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
    cli_version: Option<String>,
}

enum StreamingTextKind {
    Assistant,
    Thinking,
}

impl LogState {
    fn new(entry_index: EntryIndexProvider) -> Self {
        Self {
            entry_index,
            assistant: None,
            thinking: None,
            commands: HashMap::new(),
            mcp_tools: HashMap::new(),
            patches: HashMap::new(),
            web_searches: HashMap::new(),
            model_params: ModelParamsState {
                index: None,
                model: None,
                reasoning_effort: None,
                cli_version: None,
            },
        }
    }

    fn streaming_text_update(
        &mut self,
        content: String,
        type_: StreamingTextKind,
    ) -> (NormalizedEntry, usize, bool) {
        let index_provider = &self.entry_index;
        let entry = match type_ {
            StreamingTextKind::Assistant => &mut self.assistant,
            StreamingTextKind::Thinking => &mut self.thinking,
        };
        let is_new = entry.is_none();
        let (content, index) = if entry.is_none() {
            let index = index_provider.next();
            *entry = Some(StreamingText { index, content });
            (&entry.as_ref().unwrap().content, index)
        } else {
            let streaming_state = entry.as_mut().unwrap();
            streaming_state.content.push_str(&content);
            (&streaming_state.content, streaming_state.index)
        };
        let normalized_entry = NormalizedEntry {
            timestamp: None,
            entry_type: match type_ {
                StreamingTextKind::Assistant => NormalizedEntryType::AssistantMessage,
                StreamingTextKind::Thinking => NormalizedEntryType::Thinking,
            },
            content: content.clone(),
            metadata: None,
        };
        (normalized_entry, index, is_new)
    }

    fn streaming_text_append(
        &mut self,
        content: String,
        type_: StreamingTextKind,
    ) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_update(content, type_)
    }

    fn assistant_message_append(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_append(content, StreamingTextKind::Assistant)
    }

    fn thinking_append(&mut self, content: String) -> (NormalizedEntry, usize, bool) {
        self.streaming_text_append(content, StreamingTextKind::Thinking)
    }

    fn close_streaming_text(&mut self) {
        self.assistant = None;
        self.thinking = None;
    }
}

fn normalize_file_changes(
    worktree_path: &str,
    changes: &[FileUpdateChange],
) -> Vec<(String, Vec<FileChange>)> {
    let mut by_path: HashMap<String, Vec<FileChange>> = HashMap::new();

    changes.iter().for_each(|change| {
        let relative = make_path_relative(&change.path, worktree_path);
        let normalized_diff = normalize_unified_diff(&relative, &change.diff);
        let file_changes = match &change.kind {
            codex_app_server_protocol::PatchChangeKind::Add => vec![FileChange::Edit {
                unified_diff: normalized_diff,
                has_line_numbers: true,
            }],
            codex_app_server_protocol::PatchChangeKind::Delete => vec![FileChange::Delete],
            codex_app_server_protocol::PatchChangeKind::Update { move_path } => {
                let mut edits = Vec::new();
                if let Some(dest) = move_path {
                    let dest_rel =
                        make_path_relative(dest.to_string_lossy().as_ref(), worktree_path);
                    edits.push(FileChange::Rename { new_path: dest_rel });
                }
                edits.push(FileChange::Edit {
                    unified_diff: normalized_diff,
                    has_line_numbers: true,
                });
                edits
            }
        };
        by_path.entry(relative).or_default().extend(file_changes);
    });

    by_path.into_iter().collect()
}

fn format_todo_status(status: &TurnPlanStepStatus) -> String {
    match status {
        TurnPlanStepStatus::Pending => "pending",
        TurnPlanStepStatus::InProgress => "in_progress",
        TurnPlanStepStatus::Completed => "completed",
    }
    .to_string()
}

fn command_status(status: &CommandExecutionStatus) -> ToolStatus {
    match status {
        CommandExecutionStatus::InProgress => ToolStatus::Created,
        CommandExecutionStatus::Completed => ToolStatus::Success,
        CommandExecutionStatus::Failed => ToolStatus::Failed,
        CommandExecutionStatus::Declined => ToolStatus::Denied { reason: None },
    }
}

fn patch_status(status: &PatchApplyStatus) -> ToolStatus {
    match status {
        PatchApplyStatus::InProgress => ToolStatus::Created,
        PatchApplyStatus::Completed => ToolStatus::Success,
        PatchApplyStatus::Failed => ToolStatus::Failed,
        PatchApplyStatus::Declined => ToolStatus::Denied { reason: None },
    }
}

fn mcp_status(status: &McpToolCallStatus) -> ToolStatus {
    match status {
        McpToolCallStatus::InProgress => ToolStatus::Created,
        McpToolCallStatus::Completed => ToolStatus::Success,
        McpToolCallStatus::Failed => ToolStatus::Failed,
    }
}

pub fn normalize_logs(msg_store: Arc<MsgStore>, worktree_path: &Path) {
    let entry_index = EntryIndexProvider::start_from(&msg_store);
    normalize_stderr_logs(msg_store.clone(), entry_index.clone());

    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    tokio::spawn(async move {
        let mut state = LogState::new(entry_index.clone());
        let mut stdout_lines = msg_store.stdout_lines_stream();

        while let Some(Ok(line)) = stdout_lines.next().await {
            if let Ok(error) = serde_json::from_str::<Error>(&line) {
                add_normalized_entry(&msg_store, &entry_index, error.to_normalized_entry());
                continue;
            }

            if let Ok(approval) = serde_json::from_str::<Approval>(&line) {
                if let Some(entry) = approval.to_normalized_entry_opt() {
                    add_normalized_entry(&msg_store, &entry_index, entry);
                }
                continue;
            }

            if let Ok(response) = serde_json::from_str::<JSONRPCResponse>(&line) {
                handle_jsonrpc_response(
                    response,
                    &msg_store,
                    &entry_index,
                    &mut state.model_params,
                );
                continue;
            }

            let Ok(server_notification) = serde_json::from_str::<ServerNotification>(&line) else {
                continue;
            };

            match server_notification {
                ServerNotification::ThreadStarted(notification) => {
                    msg_store.push_session_id(notification.thread.id);
                }
                ServerNotification::AgentMessageDelta(notification) => {
                    state.thinking = None;
                    let (entry, index, is_new) = state.assistant_message_append(notification.delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                ServerNotification::ReasoningTextDelta(notification) => {
                    state.assistant = None;
                    let (entry, index, is_new) = state.thinking_append(notification.delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                ServerNotification::ReasoningSummaryTextDelta(notification) => {
                    state.assistant = None;
                    let (entry, index, is_new) = state.thinking_append(notification.delta);
                    upsert_normalized_entry(&msg_store, index, entry, is_new);
                }
                ServerNotification::ReasoningSummaryPartAdded(..) => {
                    state.assistant = None;
                    state.thinking = None;
                }
                ServerNotification::ItemStarted(notification) => match notification.item {
                    ThreadItem::CommandExecution {
                        id,
                        command,
                        status,
                        exit_code,
                        aggregated_output,
                        ..
                    } => {
                        state.close_streaming_text();
                        let mut command_state = CommandState {
                            index: None,
                            command,
                            stdout: String::new(),
                            stderr: String::new(),
                            formatted_output: aggregated_output,
                            status: command_status(&status),
                            exit_code,
                            call_id: id.clone(),
                        };
                        let index = add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            command_state.to_normalized_entry(),
                        );
                        command_state.index = Some(index);
                        state.commands.insert(id, command_state);
                    }
                    ThreadItem::FileChange {
                        id,
                        changes,
                        status,
                    } => {
                        state.close_streaming_text();
                        let normalized = normalize_file_changes(&worktree_path_str, &changes);
                        let mut patch_state = PatchState::default();
                        for (path, file_changes) in normalized {
                            let mut entry = PatchEntry {
                                index: None,
                                path,
                                changes: file_changes,
                                status: patch_status(&status),
                                call_id: id.clone(),
                            };
                            let index = add_normalized_entry(
                                &msg_store,
                                &entry_index,
                                entry.to_normalized_entry(),
                            );
                            entry.index = Some(index);
                            patch_state.entries.push(entry);
                        }
                        state.patches.insert(id, patch_state);
                    }
                    ThreadItem::McpToolCall {
                        id,
                        server,
                        tool,
                        arguments,
                        status,
                        result,
                        error,
                        ..
                    } => {
                        state.close_streaming_text();
                        let mut mcp_tool_state = McpToolState {
                            index: None,
                            invocation: McpInvocation {
                                server,
                                tool,
                                arguments: Some(arguments),
                            },
                            result: None,
                            status: mcp_status(&status),
                        };
                        if let Some(err) = error {
                            mcp_tool_state.status = ToolStatus::Failed;
                            mcp_tool_state.result = Some(ToolResult {
                                r#type: ToolResultValueType::Markdown,
                                value: Value::String(err.message),
                            });
                        } else if let Some(value) = result {
                            mcp_tool_state.result = Some(mcp_tool_result_from_response(*value));
                        }
                        let index = add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            mcp_tool_state.to_normalized_entry(),
                        );
                        mcp_tool_state.index = Some(index);
                        state.mcp_tools.insert(id, mcp_tool_state);
                    }
                    ThreadItem::WebSearch { id, query, .. } => {
                        state.close_streaming_text();
                        let mut web_search_state = WebSearchState::new();
                        web_search_state.query = Some(query);
                        let index = add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            web_search_state.to_normalized_entry(),
                        );
                        web_search_state.index = Some(index);
                        state.web_searches.insert(id, web_search_state);
                    }
                    ThreadItem::ImageView { path, .. } => {
                        state.close_streaming_text();
                        let relative_path =
                            make_path_relative(path.to_string_lossy().as_ref(), &worktree_path_str);
                        add_normalized_entry(
                            &msg_store,
                            &entry_index,
                            NormalizedEntry {
                                timestamp: None,
                                entry_type: NormalizedEntryType::ToolUse {
                                    tool_name: "view_image".to_string(),
                                    action_type: ActionType::FileRead {
                                        path: relative_path.clone(),
                                    },
                                    status: ToolStatus::Success,
                                },
                                content: relative_path,
                                metadata: None,
                            },
                        );
                    }
                    _ => {}
                },
                ServerNotification::CommandExecutionOutputDelta(notification) => {
                    if let Some(command_state) = state.commands.get_mut(&notification.item_id) {
                        if !notification.delta.is_empty() {
                            command_state.stdout.push_str(&notification.delta);
                            if let Some(index) = command_state.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    command_state.to_normalized_entry(),
                                );
                            }
                        }
                    }
                }
                ServerNotification::ItemCompleted(notification) => match notification.item {
                    ThreadItem::CommandExecution {
                        id,
                        status,
                        exit_code,
                        aggregated_output,
                        ..
                    } => {
                        state.close_streaming_text();
                        if let Some(mut command_state) = state.commands.remove(&id) {
                            command_state.formatted_output = aggregated_output;
                            command_state.exit_code = exit_code;
                            command_state.status = command_status(&status);
                            if let Some(index) = command_state.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    command_state.to_normalized_entry(),
                                );
                            }
                        }
                    }
                    ThreadItem::FileChange {
                        id,
                        changes,
                        status,
                    } => {
                        state.close_streaming_text();
                        if let Some(mut patch_state) = state.patches.remove(&id) {
                            let normalized = normalize_file_changes(&worktree_path_str, &changes);
                            let mut iter = normalized.into_iter();
                            for mut entry in patch_state.entries.drain(..) {
                                if let Some((path, file_changes)) = iter.next() {
                                    entry.path = path;
                                    entry.changes = file_changes;
                                }
                                entry.status = patch_status(&status);
                                if let Some(index) = entry.index {
                                    replace_normalized_entry(
                                        &msg_store,
                                        index,
                                        entry.to_normalized_entry(),
                                    );
                                }
                            }
                        }
                    }
                    ThreadItem::McpToolCall {
                        id,
                        status,
                        result,
                        error,
                        ..
                    } => {
                        state.close_streaming_text();
                        if let Some(mut mcp_tool_state) = state.mcp_tools.remove(&id) {
                            mcp_tool_state.status = mcp_status(&status);
                            if let Some(err) = error {
                                mcp_tool_state.status = ToolStatus::Failed;
                                mcp_tool_state.result = Some(ToolResult {
                                    r#type: ToolResultValueType::Markdown,
                                    value: Value::String(err.message),
                                });
                            } else if let Some(value) = result {
                                mcp_tool_state.result = Some(mcp_tool_result_from_response(*value));
                            }
                            if let Some(index) = mcp_tool_state.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    mcp_tool_state.to_normalized_entry(),
                                );
                            }
                        }
                    }
                    ThreadItem::WebSearch { id, query, .. } => {
                        state.close_streaming_text();
                        if let Some(mut entry) = state.web_searches.remove(&id) {
                            entry.status = ToolStatus::Success;
                            entry.query = Some(query);
                            if let Some(index) = entry.index {
                                replace_normalized_entry(
                                    &msg_store,
                                    index,
                                    entry.to_normalized_entry(),
                                );
                            }
                        }
                    }
                    _ => {}
                },
                ServerNotification::TurnPlanUpdated(notification) => {
                    state.close_streaming_text();
                    let todos: Vec<TodoItem> = notification
                        .plan
                        .iter()
                        .map(|item| TodoItem {
                            content: item.step.clone(),
                            status: format_todo_status(&item.status),
                            priority: None,
                        })
                        .collect();
                    let explanation = notification
                        .explanation
                        .as_ref()
                        .map(|text| text.trim())
                        .filter(|text| !text.is_empty())
                        .map(|text| text.to_string());
                    let content = explanation.clone().unwrap_or_else(|| {
                        if todos.is_empty() {
                            "Plan updated".to_string()
                        } else {
                            format!("Plan updated ({} steps)", todos.len())
                        }
                    });
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ToolUse {
                                tool_name: "plan".to_string(),
                                action_type: ActionType::TodoManagement {
                                    todos,
                                    operation: "update".to_string(),
                                },
                                status: ToolStatus::Success,
                            },
                            content,
                            metadata: None,
                        },
                    );
                }
                ServerNotification::ContextCompacted(..) => {
                    state.close_streaming_text();
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::SystemMessage,
                            content: "Context compacted".to_string(),
                            metadata: None,
                        },
                    );
                }
                ServerNotification::ThreadTokenUsageUpdated(..) => {}
                ServerNotification::Error(notification) => {
                    state.close_streaming_text();
                    add_normalized_entry(
                        &msg_store,
                        &entry_index,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ErrorMessage {
                                error_type: NormalizedEntryError::Other,
                            },
                            content: format!(
                                "Error: {} {:?}",
                                notification.error.message, notification.error.codex_error_info
                            ),
                            metadata: None,
                        },
                    );
                }
                ServerNotification::TurnCompleted(..) => {
                    state.close_streaming_text();
                }
                _ => {}
            }
        }
    });
}

fn handle_jsonrpc_response(
    response: JSONRPCResponse,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    model_params: &mut ModelParamsState,
) {
    let cli_version = extract_cli_version(&response.result);

    if let Ok(response) = serde_json::from_value::<ThreadStartResponse>(response.result.clone()) {
        msg_store.push_session_id(response.thread.id);
        handle_model_params(
            Some(response.model),
            response.reasoning_effort,
            cli_version.clone(),
            msg_store,
            entry_index,
            model_params,
        );
        return;
    }

    if let Ok(response) = serde_json::from_value::<ThreadResumeResponse>(response.result.clone()) {
        msg_store.push_session_id(response.thread.id);
        handle_model_params(
            Some(response.model),
            response.reasoning_effort,
            cli_version,
            msg_store,
            entry_index,
            model_params,
        );
        return;
    }

    let _ = (msg_store, entry_index, model_params);
}

fn handle_model_params(
    model: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
    cli_version: Option<String>,
    msg_store: &Arc<MsgStore>,
    entry_index: &EntryIndexProvider,
    state: &mut ModelParamsState,
) {
    if let Some(model) = model {
        state.model = Some(model);
    }
    if let Some(reasoning_effort) = reasoning_effort {
        state.reasoning_effort = Some(reasoning_effort);
    }
    if let Some(cli_version) = cli_version {
        state.cli_version = Some(cli_version);
    }

    let mut params = vec![];
    if let Some(cli_version) = &state.cli_version {
        params.push(format!("cli version: {cli_version}"));
    }
    if let Some(model) = &state.model {
        params.push(format!("model: {model}"));
    }
    if let Some(reasoning_effort) = &state.reasoning_effort {
        params.push(format!("reasoning effort: {reasoning_effort}"));
    }

    if params.is_empty() {
        return;
    }

    let is_new = state.index.is_none();
    let index = *state.index.get_or_insert_with(|| entry_index.next());
    let entry = NormalizedEntry {
        timestamp: None,
        entry_type: NormalizedEntryType::SystemMessage,
        content: params.join("  "),
        metadata: None,
    };
    upsert_normalized_entry(msg_store, index, entry, is_new);
}

fn extract_cli_version(result: &Value) -> Option<String> {
    result
        .as_object()
        .and_then(|obj| obj.get("cli_version").or_else(|| obj.get("cliVersion")))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn build_command_output(stdout: Option<&str>, stderr: Option<&str>) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(out) = stdout {
        let cleaned = out.trim();
        if !cleaned.is_empty() {
            sections.push(format!("stdout:\n{cleaned}"));
        }
    }
    if let Some(err) = stderr {
        let cleaned = err.trim();
        if !cleaned.is_empty() {
            sections.push(format!("stderr:\n{cleaned}"));
        }
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

fn mcp_tool_result_from_response(
    result: codex_app_server_protocol::McpToolCallResult,
) -> ToolResult {
    if let Some(text) = extract_mcp_text_content(&result.content) {
        return ToolResult {
            r#type: ToolResultValueType::Markdown,
            value: Value::String(text),
        };
    }

    ToolResult {
        r#type: ToolResultValueType::Json,
        value: result
            .structured_content
            .unwrap_or_else(|| Value::Array(result.content)),
    }
}

fn extract_mcp_text_content(content: &[Value]) -> Option<String> {
    let mut lines = Vec::with_capacity(content.len());
    for block in content {
        let text = block
            .as_object()
            .and_then(|obj| {
                obj.get("type")
                    .and_then(Value::as_str)
                    .map(|kind| (obj, kind))
            })
            .filter(|(_, kind)| *kind == "text")
            .and_then(|(obj, _)| obj.get("text").and_then(Value::as_str))
            .map(str::to_string)?;
        lines.push(text);
    }
    Some(lines.join("\n"))
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Error {
    LaunchError { error: String },
    AuthRequired { error: String },
}

impl Error {
    pub fn launch_error(error: String) -> Self {
        Self::LaunchError { error }
    }
    pub fn auth_required(error: String) -> Self {
        Self::AuthRequired { error }
    }

    pub fn raw(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

impl ToNormalizedEntry for Error {
    fn to_normalized_entry(&self) -> NormalizedEntry {
        match self {
            Error::LaunchError { error } => NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ErrorMessage {
                    error_type: NormalizedEntryError::Other,
                },
                content: error.clone(),
                metadata: None,
            },
            Error::AuthRequired { error } => NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ErrorMessage {
                    error_type: NormalizedEntryError::SetupRequired,
                },
                content: error.clone(),
                metadata: None,
            },
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Approval {
    ApprovalResponse {
        call_id: String,
        tool_name: String,
        approval_status: ApprovalStatus,
    },
}

impl Approval {
    pub fn approval_response(
        call_id: String,
        tool_name: String,
        approval_status: ApprovalStatus,
    ) -> Self {
        Self::ApprovalResponse {
            call_id,
            tool_name,
            approval_status,
        }
    }

    pub fn raw(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn display_tool_name(&self) -> String {
        let Self::ApprovalResponse { tool_name, .. } = self;
        match tool_name.as_str() {
            "codex.exec_command" => "Exec Command".to_string(),
            "codex.apply_patch" => "Edit".to_string(),
            other => other.to_string(),
        }
    }
}

impl ToNormalizedEntryOpt for Approval {
    fn to_normalized_entry_opt(&self) -> Option<NormalizedEntry> {
        let Self::ApprovalResponse {
            call_id: _,
            tool_name: _,
            approval_status,
        } = self;
        let tool_name = self.display_tool_name();

        match approval_status {
            ApprovalStatus::Pending => None,
            ApprovalStatus::Approved => None,
            ApprovalStatus::Denied { reason } => Some(NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::UserFeedback {
                    denied_tool: tool_name.clone(),
                },
                content: reason
                    .clone()
                    .unwrap_or_else(|| "User denied this tool use request".to_string())
                    .trim()
                    .to_string(),
                metadata: None,
            }),
            ApprovalStatus::TimedOut => Some(NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::ErrorMessage {
                    error_type: NormalizedEntryError::Other,
                },
                content: format!("Approval timed out for tool {tool_name}"),
                metadata: None,
            }),
        }
    }
}
