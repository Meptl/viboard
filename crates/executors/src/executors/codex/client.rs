use std::{
    collections::VecDeque,
    io,
    sync::{Arc, OnceLock},
};

use async_trait::async_trait;
use codex_app_server_protocol::{
    ClientNotification, ClientRequest, CommandExecutionApprovalDecision,
    CommandExecutionRequestApprovalResponse, FileChangeApprovalDecision,
    FileChangeRequestApprovalResponse, GetAuthStatusParams, GetAuthStatusResponse,
    InitializeResponse, JSONRPCError, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse,
    McpElicitationPrimitiveSchema, McpServerElicitationAction, McpServerElicitationRequest,
    McpServerElicitationRequestResponse, PermissionGrantScope, PermissionsRequestApprovalResponse,
    RequestId, ServerRequest, ThreadResumeParams, ThreadResumeResponse, ThreadStartParams,
    ThreadStartResponse, ToolRequestUserInputAnswer, ToolRequestUserInputResponse, TurnStartParams,
    TurnStartResponse, UserInput,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{self, Value, json};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt, BufWriter},
    sync::Mutex,
};
use workspace_utils::approvals::ApprovalStatus;

use super::jsonrpc::{JsonRpcCallbacks, JsonRpcPeer};
use crate::{
    approvals::{ExecutorApprovalError, ExecutorApprovalService},
    executors::{ExecutorError, codex::normalize_logs::Approval},
};

pub struct AppServerClient {
    rpc: OnceLock<JsonRpcPeer>,
    log_writer: LogWriter,
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
    thread_id: Mutex<Option<String>>,
    pending_feedback: Mutex<VecDeque<String>>,
    auto_approve: bool,
}

impl AppServerClient {
    pub fn new(
        log_writer: LogWriter,
        approvals: Option<Arc<dyn ExecutorApprovalService>>,
        auto_approve: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            rpc: OnceLock::new(),
            log_writer,
            approvals,
            auto_approve,
            thread_id: Mutex::new(None),
            pending_feedback: Mutex::new(VecDeque::new()),
        })
    }

    pub fn connect(&self, peer: JsonRpcPeer) {
        let _ = self.rpc.set(peer);
    }

    fn rpc(&self) -> &JsonRpcPeer {
        self.rpc.get().expect("Codex RPC peer not attached")
    }

    pub async fn initialize(&self) -> Result<(), ExecutorError> {
        let request_id = self.next_request_id();
        let request = JSONRPCRequest {
            id: request_id.clone(),
            method: "initialize".to_string(),
            params: Some(json!({
                "clientInfo": {
                    "name": "vibe-codex-executor",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                }
            })),
            trace: None,
        };

        self.rpc()
            .request::<InitializeResponse, _>(request_id, &request, "initialize")
            .await?;
        self.send_message(&ClientNotification::Initialized).await
    }

    pub async fn thread_start(
        &self,
        params: ThreadStartParams,
    ) -> Result<ThreadStartResponse, ExecutorError> {
        let request = ClientRequest::ThreadStart {
            request_id: self.next_request_id(),
            params,
        };
        self.send_request(request, "thread/start").await
    }

    pub async fn thread_resume(
        &self,
        rollout_path: std::path::PathBuf,
        thread_id: String,
        overrides: ThreadStartParams,
    ) -> Result<ThreadResumeResponse, ExecutorError> {
        let request = ClientRequest::ThreadResume {
            request_id: self.next_request_id(),
            params: ThreadResumeParams {
                thread_id,
                path: Some(rollout_path),
                model: overrides.model,
                model_provider: overrides.model_provider,
                service_tier: None,
                cwd: overrides.cwd,
                approval_policy: overrides.approval_policy,
                approvals_reviewer: None,
                sandbox: overrides.sandbox,
                config: overrides.config,
                base_instructions: overrides.base_instructions,
                developer_instructions: overrides.developer_instructions,
                personality: None,
                persist_extended_history: false,
                history: None,
            },
        };
        self.send_request(request, "thread/resume").await
    }

    pub async fn turn_start(
        &self,
        thread_id: String,
        message: String,
    ) -> Result<TurnStartResponse, ExecutorError> {
        let request = ClientRequest::TurnStart {
            request_id: self.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: vec![UserInput::Text {
                    text: message,
                    text_elements: vec![],
                }],
                ..Default::default()
            },
        };
        self.send_request(request, "turn/start").await
    }

    pub async fn get_auth_status(&self) -> Result<GetAuthStatusResponse, ExecutorError> {
        let request = ClientRequest::GetAuthStatus {
            request_id: self.next_request_id(),
            params: GetAuthStatusParams {
                include_token: Some(true),
                refresh_token: Some(false),
            },
        };
        self.send_request(request, "getAuthStatus").await
    }
    async fn handle_server_request(
        &self,
        peer: &JsonRpcPeer,
        request: ServerRequest,
    ) -> Result<(), ExecutorError> {
        match request {
            ServerRequest::FileChangeRequestApproval { request_id, params } => {
                let input = serde_json::to_value(&params)
                    .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;
                let status = match self
                    .request_tool_approval("edit", input, &params.item_id)
                    .await
                {
                    Ok(status) => status,
                    Err(err) => {
                        tracing::error!("failed to request patch approval: {err}");
                        ApprovalStatus::Denied {
                            reason: Some("approval service error".to_string()),
                        }
                    }
                };
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.item_id,
                            "codex.apply_patch".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;
                let (decision, feedback) = self.review_file_change_decision(&status);
                let response = FileChangeRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing patch denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
                let input = serde_json::to_value(&params)
                    .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;
                let status = match self
                    .request_tool_approval("bash", input, &params.item_id)
                    .await
                {
                    Ok(status) => status,
                    Err(err) => {
                        tracing::error!("failed to request command approval: {err}");
                        ApprovalStatus::Denied {
                            reason: Some("approval service error".to_string()),
                        }
                    }
                };
                self.log_writer
                    .log_raw(
                        &Approval::approval_response(
                            params.item_id,
                            "codex.exec_command".to_string(),
                            status.clone(),
                        )
                        .raw(),
                    )
                    .await?;

                let (decision, feedback) = self.review_command_execution_decision(&status);
                let response = CommandExecutionRequestApprovalResponse { decision };
                send_server_response(peer, request_id, response).await?;
                if let Some(message) = feedback {
                    tracing::debug!("queueing exec denial feedback: {message}");
                    self.enqueue_feedback(message).await;
                }
                Ok(())
            }
            ServerRequest::ApplyPatchApproval { request_id, .. }
            | ServerRequest::ExecCommandApproval { request_id, .. } => {
                send_server_error(
                    peer,
                    request_id,
                    -32601,
                    "deprecated v1 approval request is not supported",
                )
                .await
            }
            ServerRequest::PermissionsRequestApproval { request_id, params } => {
                let granted_permissions = serde_json::from_value(
                    serde_json::to_value(params.permissions)
                        .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
                )
                .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?;

                let response = PermissionsRequestApprovalResponse {
                    permissions: granted_permissions,
                    scope: PermissionGrantScope::Session,
                };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::ToolRequestUserInput { request_id, params } => {
                let answers = params
                    .questions
                    .into_iter()
                    .map(|question| {
                        let selected = question
                            .options
                            .and_then(|options| options.into_iter().next().map(|o| o.label))
                            .unwrap_or_default();
                        (
                            question.id,
                            ToolRequestUserInputAnswer {
                                answers: vec![selected],
                            },
                        )
                    })
                    .collect();

                let response = ToolRequestUserInputResponse { answers };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::McpServerElicitationRequest { request_id, params } => {
                let (action, content) = match params.request {
                    McpServerElicitationRequest::Form {
                        requested_schema, ..
                    } => (
                        McpServerElicitationAction::Accept,
                        Some(build_elicitation_content(requested_schema)),
                    ),
                    McpServerElicitationRequest::Url { .. } => {
                        (McpServerElicitationAction::Cancel, None)
                    }
                };
                let response = McpServerElicitationRequestResponse {
                    action,
                    content,
                    meta: None,
                };
                send_server_response(peer, request_id, response).await
            }
            ServerRequest::DynamicToolCall {
                request_id, params, ..
            } => {
                tracing::warn!(
                    "Dynamic tool call not supported by Codex executor (tool={}): {}",
                    params.tool,
                    params.arguments
                );
                send_server_response(
                    peer,
                    request_id,
                    codex_app_server_protocol::DynamicToolCallResponse {
                        content_items: vec![
                            codex_app_server_protocol::DynamicToolCallOutputContentItem::InputText {
                                text: "Dynamic tool calls are not supported by this Codex executor."
                                    .to_string(),
                            },
                        ],
                        success: false,
                    },
                )
                .await
            }
            ServerRequest::ChatgptAuthTokensRefresh { request_id, .. } => {
                send_server_response_value(peer, request_id, Value::Null).await
            }
        }
    }

    async fn request_tool_approval(
        &self,
        tool_name: &str,
        tool_input: Value,
        tool_call_id: &str,
    ) -> Result<ApprovalStatus, ExecutorError> {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        if self.auto_approve {
            return Ok(ApprovalStatus::Approved);
        }
        Ok(self
            .approvals
            .as_ref()
            .ok_or(ExecutorApprovalError::ServiceUnavailable)?
            .request_tool_approval(tool_name, tool_input, tool_call_id)
            .await?)
    }

    pub async fn register_session(&self, thread_id: String) -> Result<(), ExecutorError> {
        {
            let mut guard = self.thread_id.lock().await;
            guard.replace(thread_id);
        }
        self.flush_pending_feedback().await;
        Ok(())
    }

    async fn send_message<M>(&self, message: &M) -> Result<(), ExecutorError>
    where
        M: Serialize + Sync,
    {
        self.rpc().send(message).await
    }

    async fn send_request<R>(&self, request: ClientRequest, label: &str) -> Result<R, ExecutorError>
    where
        R: DeserializeOwned + std::fmt::Debug,
    {
        let request_id = request_id(&request);
        self.rpc().request(request_id, &request, label).await
    }

    fn next_request_id(&self) -> RequestId {
        self.rpc().next_request_id()
    }

    fn review_file_change_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (FileChangeApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (FileChangeApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (FileChangeApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (FileChangeApprovalDecision::Cancel, feedback)
                } else {
                    (FileChangeApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => {
                (FileChangeApprovalDecision::Decline, None)
            }
        }
    }

    fn review_command_execution_decision(
        &self,
        status: &ApprovalStatus,
    ) -> (CommandExecutionApprovalDecision, Option<String>) {
        if self.auto_approve {
            return (CommandExecutionApprovalDecision::AcceptForSession, None);
        }

        match status {
            ApprovalStatus::Approved => (CommandExecutionApprovalDecision::Accept, None),
            ApprovalStatus::Denied { reason } => {
                let feedback = reason
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if feedback.is_some() {
                    (CommandExecutionApprovalDecision::Cancel, feedback)
                } else {
                    (CommandExecutionApprovalDecision::Decline, None)
                }
            }
            ApprovalStatus::TimedOut | ApprovalStatus::Pending => {
                (CommandExecutionApprovalDecision::Decline, None)
            }
        }
    }

    async fn enqueue_feedback(&self, message: String) {
        if message.trim().is_empty() {
            return;
        }
        let mut guard = self.pending_feedback.lock().await;
        guard.push_back(message);
    }

    async fn flush_pending_feedback(&self) {
        let messages: Vec<String> = {
            let mut guard = self.pending_feedback.lock().await;
            guard.drain(..).collect()
        };

        if messages.is_empty() {
            return;
        }

        let Some(thread_id) = self.thread_id.lock().await.clone() else {
            tracing::warn!(
                "pending Codex feedback but thread id unavailable; dropping {} messages",
                messages.len()
            );
            return;
        };

        for message in messages {
            let trimmed = message.trim();
            if trimmed.is_empty() {
                continue;
            }
            self.spawn_feedback_message(thread_id.clone(), trimmed.to_string());
        }
    }

    fn spawn_feedback_message(&self, thread_id: String, feedback: String) {
        let peer = self.rpc().clone();
        let request = ClientRequest::TurnStart {
            request_id: peer.next_request_id(),
            params: TurnStartParams {
                thread_id,
                input: vec![UserInput::Text {
                    text: format!("User feedback: {feedback}"),
                    text_elements: vec![],
                }],
                ..Default::default()
            },
        };
        tokio::spawn(async move {
            if let Err(err) = peer
                .request::<TurnStartResponse, _>(request_id(&request), &request, "turn/start")
                .await
            {
                tracing::error!("failed to send feedback follow-up message: {err}");
            }
        });
    }
}

#[async_trait]
impl JsonRpcCallbacks for AppServerClient {
    async fn on_request(
        &self,
        peer: &JsonRpcPeer,
        raw: &str,
        request: JSONRPCRequest,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        match ServerRequest::try_from(request.clone()) {
            Ok(server_request) => self.handle_server_request(peer, server_request).await,
            Err(err) => {
                tracing::debug!("Unhandled server request `{}`: {err}", request.method);
                let response = JSONRPCResponse {
                    id: request.id,
                    result: Value::Null,
                };
                peer.send(&response).await
            }
        }
    }

    async fn on_response(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _response: &JSONRPCResponse,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_error(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        _error: &JSONRPCError,
    ) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await
    }

    async fn on_notification(
        &self,
        _peer: &JsonRpcPeer,
        raw: &str,
        notification: JSONRPCNotification,
    ) -> Result<bool, ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        if notification.method == "turn/aborted" {
            tracing::debug!("codex turn aborted; flushing feedback queue");
            self.flush_pending_feedback().await;
            return Ok(false);
        }
        Ok(notification.method == "turn/completed")
    }

    async fn on_non_json(&self, raw: &str) -> Result<(), ExecutorError> {
        self.log_writer.log_raw(raw).await?;
        Ok(())
    }
}

fn build_elicitation_content(schema: codex_app_server_protocol::McpElicitationSchema) -> Value {
    let mut content = serde_json::Map::new();
    for (key, field) in schema.properties {
        let value = match field {
            McpElicitationPrimitiveSchema::String(s) => {
                Value::String(s.default.unwrap_or_default())
            }
            McpElicitationPrimitiveSchema::Number(n) => Value::from(n.default.unwrap_or_default()),
            McpElicitationPrimitiveSchema::Boolean(b) => Value::Bool(b.default.unwrap_or(false)),
            McpElicitationPrimitiveSchema::Enum(e) => match e {
                codex_app_server_protocol::McpElicitationEnumSchema::SingleSelect(single) => {
                    let selected = match single {
                        codex_app_server_protocol::McpElicitationSingleSelectEnumSchema::Untitled(
                            schema,
                        ) => schema
                            .default
                            .or_else(|| schema.enum_.into_iter().next())
                            .unwrap_or_default(),
                        codex_app_server_protocol::McpElicitationSingleSelectEnumSchema::Titled(
                            schema,
                        ) => schema
                            .default
                            .or_else(|| schema.one_of.into_iter().next().map(|o| o.const_))
                            .unwrap_or_default(),
                    };
                    Value::String(selected)
                }
                codex_app_server_protocol::McpElicitationEnumSchema::MultiSelect(multi) => {
                    let selected = match multi {
                        codex_app_server_protocol::McpElicitationMultiSelectEnumSchema::Untitled(
                            schema,
                        ) => schema
                            .default
                            .or_else(|| schema.items.enum_.into_iter().next().map(|v| vec![v]))
                            .unwrap_or_default(),
                        codex_app_server_protocol::McpElicitationMultiSelectEnumSchema::Titled(
                            schema,
                        ) => schema
                            .default
                            .or_else(|| {
                                schema.items.any_of.into_iter().next().map(|v| vec![v.const_])
                            })
                            .unwrap_or_default(),
                    };
                    Value::Array(selected.into_iter().map(Value::String).collect())
                }
                codex_app_server_protocol::McpElicitationEnumSchema::Legacy(schema) => {
                    Value::String(
                        schema
                            .default
                            .or_else(|| schema.enum_.into_iter().next())
                            .unwrap_or_default(),
                    )
                }
            },
        };
        content.insert(key, value);
    }
    Value::Object(content)
}

async fn send_server_response<T>(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    response: T,
) -> Result<(), ExecutorError>
where
    T: Serialize,
{
    let payload = JSONRPCResponse {
        id: request_id,
        result: serde_json::to_value(response)
            .map_err(|err| ExecutorError::Io(io::Error::other(err.to_string())))?,
    };

    peer.send(&payload).await
}

async fn send_server_response_value(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    result: Value,
) -> Result<(), ExecutorError> {
    let payload = JSONRPCResponse {
        id: request_id,
        result,
    };
    peer.send(&payload).await
}

async fn send_server_error(
    peer: &JsonRpcPeer,
    request_id: RequestId,
    code: i64,
    message: &str,
) -> Result<(), ExecutorError> {
    let payload = JSONRPCError {
        id: request_id,
        error: codex_app_server_protocol::JSONRPCErrorError {
            code,
            data: None,
            message: message.to_string(),
        },
    };
    peer.send(&payload).await
}

fn request_id(request: &ClientRequest) -> RequestId {
    match request {
        ClientRequest::Initialize { request_id, .. }
        | ClientRequest::ThreadStart { request_id, .. }
        | ClientRequest::ThreadResume { request_id, .. }
        | ClientRequest::TurnStart { request_id, .. }
        | ClientRequest::GetAuthStatus { request_id, .. } => request_id.clone(),
        _ => unreachable!("request_id called for unsupported request variant"),
    }
}

#[derive(Clone)]
pub struct LogWriter {
    writer: Arc<Mutex<BufWriter<Box<dyn AsyncWrite + Send + Unpin>>>>,
}

impl LogWriter {
    pub fn new(writer: impl AsyncWrite + Send + Unpin + 'static) -> Self {
        Self {
            writer: Arc::new(Mutex::new(BufWriter::new(Box::new(writer)))),
        }
    }

    pub async fn log_raw(&self, raw: &str) -> Result<(), ExecutorError> {
        let mut guard = self.writer.lock().await;
        guard
            .write_all(raw.as_bytes())
            .await
            .map_err(ExecutorError::Io)?;
        guard.write_all(b"\n").await.map_err(ExecutorError::Io)?;
        guard.flush().await.map_err(ExecutorError::Io)?;
        Ok(())
    }
}
