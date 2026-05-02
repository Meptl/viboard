use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    io::ErrorKind,
    path::{Path as StdPath, PathBuf},
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use db::models::{
    project::{CreateProject, Project, ProjectError, SearchResult, UpdateProject},
    task::Task,
};
use ignore::WalkBuilder;
use local_deployment::Deployment;
use reqwest::Client;
use services::services::{
    config::{ProjectSettings, save_config_to_file},
    file_search_cache::{
        CacheError, SETTINGS_FUZZY_SCORE_THRESHOLD, SETTINGS_MAX_RESULTS, SearchMode, SearchQuery,
        TASK_FORM_FUZZY_SCORE_THRESHOLD, TASK_FORM_MAX_RESULTS, fuzzy_file_score,
    },
    git::GitBranch,
};
use utils::{assets::openclaw_root_path, path::expand_tilde, response::ApiResponse};
use uuid::Uuid;
use tokio::time::{Duration, timeout};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};

use crate::{DeploymentImpl, error::ApiError, middleware::load_project_middleware};

pub async fn get_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let mut projects = Project::find_all(&deployment.db().pool).await?;
    {
        let config = deployment.config().read().await;
        for project in &mut projects {
            apply_project_settings(project, &config);
        }
    }
    Ok(ResponseJson(ApiResponse::success(projects)))
}

pub async fn get_project(
    Extension(mut project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    ensure_openclaw_workspace_for_project(project.id)?;
    {
        let config = deployment.config().read().await;
        apply_project_settings(&mut project, &config);
    }
    Ok(ResponseJson(ApiResponse::success(project)))
}

fn ensure_openclaw_workspace_for_project(project_id: Uuid) -> Result<(), ApiError> {
    let workspace_root = openclaw_workspace_path(project_id);
    std::fs::create_dir_all(&workspace_root)?;
    Ok(())
}

fn openclaw_workspace_path(project_id: Uuid) -> PathBuf {
    openclaw_root_path().join(project_id.to_string())
}

#[derive(Debug, serde::Serialize)]
struct OpenClawAgentSession {
    session_key: String,
    label: Option<String>,
    display_name: Option<String>,
    state: Option<String>,
    agent_state: Option<String>,
    busy: Option<bool>,
    processing: Option<bool>,
    status: Option<String>,
    updated_at: Option<i64>,
    last_activity: Option<String>,
    model: Option<String>,
    thinking: Option<String>,
    total_tokens: Option<i64>,
    context_tokens: Option<i64>,
    parent_session_key: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawAgentsResponse {
    sessions: Vec<OpenClawAgentSession>,
}

#[derive(Debug, serde::Deserialize)]
struct OpenClawSendMessageRequest {
    text: String,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawChatMessage {
    role: String,
    content: String,
    timestamp: Option<i64>,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawSessionChatResponse {
    session_key: String,
    messages: Vec<OpenClawChatMessage>,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawMemoryEntry {
    file: String,
    content: String,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawMemoriesResponse {
    workspace: String,
    entries: Vec<OpenClawMemoryEntry>,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawCronSchedule {
    kind: String,
    expr: Option<String>,
    tz: Option<String>,
    every_ms: Option<i64>,
    at: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawCronPayload {
    kind: String,
    prompt: String,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawCronJob {
    id: String,
    name: String,
    enabled: bool,
    schedule: OpenClawCronSchedule,
    payload: OpenClawCronPayload,
}

#[derive(Debug, serde::Serialize)]
struct OpenClawCronsResponse {
    jobs: Vec<OpenClawCronJob>,
}

#[derive(Debug, serde::Deserialize)]
struct OpenClawCronUpsertRequest {
    name: Option<String>,
    enabled: Option<bool>,
    schedule: serde_json::Value,
    payload: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
struct OpenClawToggleCronRequest {
    enabled: bool,
}

fn value_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().map(|v| v as i64))
        .or_else(|| value.as_str().and_then(|v| v.parse::<i64>().ok()))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct OpenClawDeviceIdentity {
    device_id: String,
    public_key_b64url: String,
    private_key_b64url: String,
}

fn get_or_create_openclaw_device_identity() -> Result<OpenClawDeviceIdentity, ApiError> {
    let identity_path = openclaw_root_path().join("device-identity.json");

    if let Ok(raw) = std::fs::read_to_string(&identity_path) {
        if let Ok(identity) = serde_json::from_str::<OpenClawDeviceIdentity>(&raw) {
            if !identity.device_id.is_empty()
                && !identity.public_key_b64url.is_empty()
                && !identity.private_key_b64url.is_empty()
            {
                return Ok(identity);
            }
        }
    }

    let mut seed = [0u8; 32];
    let uuid_a = Uuid::new_v4();
    let uuid_b = Uuid::new_v4();
    seed[..16].copy_from_slice(uuid_a.as_bytes());
    seed[16..].copy_from_slice(uuid_b.as_bytes());
    let signing_key = SigningKey::from_bytes(&seed);
    let verify_key = signing_key.verifying_key();
    let public_key_raw = verify_key.to_bytes();
    let private_key_raw = signing_key.to_bytes();

    let device_id = {
        use sha2::Digest as _;
        let digest = sha2::Sha256::digest(public_key_raw);
        format!("{digest:x}")
    };

    let identity = OpenClawDeviceIdentity {
        device_id,
        public_key_b64url: URL_SAFE_NO_PAD.encode(public_key_raw),
        private_key_b64url: URL_SAFE_NO_PAD.encode(private_key_raw),
    };

    if let Some(parent) = identity_path.parent() {
        std::fs::create_dir_all(parent)?;
    } else {
        return Err(ApiError::BadRequest(
            "OpenClaw RPC device identity directory is unavailable".to_string(),
        ));
    }
    if let Ok(serialized) = serde_json::to_string_pretty(&identity) {
        match std::fs::write(&identity_path, format!("{serialized}\n")) {
            Ok(()) => return Ok(identity),
            Err(err) if err.kind() == ErrorKind::PermissionDenied => {}
            Err(_) => {}
        }
    }

    Ok(identity)
}

fn value_to_string(value: Option<&serde_json::Value>) -> Option<String> {
    value.and_then(|v| v.as_str().map(ToString::to_string))
}

fn value_to_bool(value: Option<&serde_json::Value>) -> Option<bool> {
    value.and_then(serde_json::Value::as_bool)
}

fn collect_nested_sessions(value: &serde_json::Value, output: &mut Vec<serde_json::Value>) {
    let Some(obj) = value.as_object() else {
        return;
    };

    output.push(value.clone());

    for key in [
        "children",
        "childSessions",
        "subagents",
        "subagentSessions",
        "subAgents",
        "sessions",
    ] {
        if let Some(children) = obj.get(key).and_then(serde_json::Value::as_array) {
            for child in children {
                collect_nested_sessions(child, output);
            }
        }
    }
}

fn extract_sessions_array(result: &serde_json::Value) -> Vec<serde_json::Value> {
    let top_level = result
        .get("sessions")
        .and_then(serde_json::Value::as_array)
        .or_else(|| {
            result
                .get("details")
                .and_then(|d| d.get("sessions"))
                .and_then(serde_json::Value::as_array)
        });

    let mut sessions = Vec::new();
    if let Some(rows) = top_level {
        for row in rows {
            collect_nested_sessions(row, &mut sessions);
        }
    }
    sessions
}

fn load_local_openclaw_sessions() -> Vec<OpenClawAgentSession> {
    let home = match env::var("HOME") {
        Ok(home) if !home.trim().is_empty() => home,
        _ => return Vec::new(),
    };
    let sessions_path = PathBuf::from(home)
        .join(".openclaw")
        .join("agents")
        .join("main")
        .join("sessions")
        .join("sessions.json");
    let raw = match fs::read_to_string(sessions_path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let parsed = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let Some(obj) = parsed.as_object() else {
        return Vec::new();
    };

    obj.iter()
        .filter_map(|(session_key, row)| {
            let row_obj = row.as_object()?;
            Some(OpenClawAgentSession {
                session_key: value_to_string(row_obj.get("sessionKey").or_else(|| row_obj.get("key")))
                    .unwrap_or_else(|| session_key.to_string()),
                label: value_to_string(row_obj.get("label")),
                display_name: value_to_string(row_obj.get("displayName")),
                state: value_to_string(row_obj.get("state")),
                agent_state: value_to_string(row_obj.get("agentState")),
                busy: value_to_bool(row_obj.get("busy")),
                processing: value_to_bool(row_obj.get("processing")),
                status: value_to_string(row_obj.get("status")),
                updated_at: row_obj.get("updatedAt").and_then(value_to_i64),
                last_activity: value_to_string(row_obj.get("lastActivity")),
                model: value_to_string(row_obj.get("model")),
                thinking: value_to_string(row_obj.get("thinkingLevel"))
                    .or_else(|| value_to_string(row_obj.get("thinking"))),
                total_tokens: row_obj.get("totalTokens").and_then(value_to_i64),
                context_tokens: row_obj.get("contextTokens").and_then(value_to_i64),
                parent_session_key: value_to_string(
                    row_obj
                        .get("parentSessionKey")
                        .or_else(|| row_obj.get("parentId")),
                ),
            })
        })
        .collect()
}

fn value_to_plain_string(value: &serde_json::Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_string();
    }
    if let Some(arr) = value.as_array() {
        let chunks = arr
            .iter()
            .map(|item| {
                if let Some(text) = item
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string)
                {
                    return text;
                }
                if let Some(input) = item
                    .get("input")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string)
                {
                    return input;
                }
                if let Some(content) = item.get("content") {
                    return value_to_plain_string(content);
                }
                String::new()
            })
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        return chunks.join("\n");
    }
    if value.is_null() {
        return String::new();
    }
    value.to_string()
}

fn extract_messages_array(result: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(messages) = result.get("messages").and_then(serde_json::Value::as_array) {
        return messages.to_vec();
    }
    if let Some(history) = result.get("history").and_then(serde_json::Value::as_array) {
        return history.to_vec();
    }
    if let Some(messages) = result
        .get("details")
        .and_then(|d| d.get("messages"))
        .and_then(serde_json::Value::as_array)
    {
        return messages.to_vec();
    }
    Vec::new()
}

async fn invoke_openclaw_tool(
    gateway_url: &str,
    gateway_key: &str,
    tool: &str,
    args: serde_json::Value,
    session_key: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    static OPENCLAW_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
    let client = OPENCLAW_HTTP_CLIENT.get_or_init(Client::new);
    let mut body = serde_json::json!({
        "tool": tool,
        "args": args,
    });
    if let Some(session_key) = session_key.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(obj) = body.as_object_mut() {
            obj.insert(
                "sessionKey".to_string(),
                serde_json::Value::String(session_key.to_string()),
            );
        }
    }

    let mut request = client
        .post(format!("{gateway_url}/tools/invoke"))
        .json(&body);
    if !gateway_key.trim().is_empty() {
        request = request.bearer_auth(gateway_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("OpenClaw gateway request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(ApiError::BadRequest(format!(
            "OpenClaw gateway error {status}: {text}"
        )));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Invalid OpenClaw gateway response: {e}")))?;

    if payload.get("ok").and_then(serde_json::Value::as_bool) == Some(false) {
        let message = payload
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("tool invocation failed");
        return Err(ApiError::BadRequest(format!(
            "OpenClaw gateway tool {tool} failed: {message}"
        )));
    }

    Ok(payload
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

async fn invoke_openclaw_rpc(
    gateway_url: &str,
    gateway_key: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let gateway_token = gateway_key.trim();
    if gateway_token.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway key is not configured".to_string(),
        ));
    }
    let shared_client = get_or_create_persistent_rpc_client(gateway_url, gateway_token).await;
    let mut client = shared_client.lock().await;
    persistent_openclaw_rpc_call(&mut client, method, params).await
}

fn parse_openclaw_messages(raw: &serde_json::Value) -> Vec<OpenClawChatMessage> {
    extract_messages_array(raw)
        .into_iter()
        .map(|row| {
            let role = value_to_string(row.get("role"))
                .or_else(|| value_to_string(row.get("type")))
                .unwrap_or_else(|| "assistant".to_string());
            let content = row
                .get("content")
                .map(value_to_plain_string)
                .or_else(|| row.get("text").map(value_to_plain_string))
                .or_else(|| row.get("message").map(value_to_plain_string))
                .unwrap_or_default();
            let timestamp = row
                .get("timestamp")
                .and_then(value_to_i64)
                .or_else(|| row.get("createdAt").and_then(value_to_i64));
            OpenClawChatMessage {
                role,
                content,
                timestamp,
            }
        })
        .filter(|m| !m.content.trim().is_empty())
        .collect::<Vec<_>>()
}

type OpenClawWsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Debug)]
struct PersistentOpenClawRpcClient {
    gateway_url: String,
    gateway_token: String,
    stream: Option<OpenClawWsStream>,
}

type SharedPersistentOpenClawRpcClient = Arc<tokio::sync::Mutex<PersistentOpenClawRpcClient>>;

static OPENCLAW_RPC_CLIENTS: OnceLock<
    tokio::sync::RwLock<HashMap<String, SharedPersistentOpenClawRpcClient>>,
> = OnceLock::new();

fn openclaw_rpc_clients()
-> &'static tokio::sync::RwLock<HashMap<String, SharedPersistentOpenClawRpcClient>> {
    OPENCLAW_RPC_CLIENTS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

fn persistent_rpc_client_key(gateway_url: &str, gateway_token: &str) -> String {
    format!("{}|{}", gateway_url.trim(), gateway_token.trim())
}

async fn get_or_create_persistent_rpc_client(
    gateway_url: &str,
    gateway_token: &str,
) -> SharedPersistentOpenClawRpcClient {
    let key = persistent_rpc_client_key(gateway_url, gateway_token);
    if let Some(existing) = openclaw_rpc_clients().read().await.get(&key) {
        return Arc::clone(existing);
    }
    let mut write_guard = openclaw_rpc_clients().write().await;
    if let Some(existing) = write_guard.get(&key) {
        return Arc::clone(existing);
    }
    let created = Arc::new(tokio::sync::Mutex::new(PersistentOpenClawRpcClient {
        gateway_url: gateway_url.trim().to_string(),
        gateway_token: gateway_token.trim().to_string(),
        stream: None,
    }));
    write_guard.insert(key, Arc::clone(&created));
    created
}

fn persistent_gateway_ws_url(gateway_url: &str) -> String {
    let base = gateway_url.trim().trim_end_matches('/');
    let mut ws_url = if base.starts_with("ws://") || base.starts_with("wss://") {
        base.to_string()
    } else if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else {
        base.replacen("http://", "ws://", 1)
    };
    if !ws_url.ends_with("/ws") {
        ws_url.push_str("/ws");
    }
    ws_url
}

fn persistent_normalize_origin(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = url::Url::parse(trimmed).ok()?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    match parsed.port() {
        Some(port) => Some(format!("{scheme}://{host}:{port}")),
        None => Some(format!("{scheme}://{host}")),
    }
}

fn persistent_gateway_request_origin() -> String {
    if let Ok(value) = std::env::var("PUBLIC_ORIGIN") {
        if let Some(origin) = persistent_normalize_origin(&value) {
            return origin;
        }
    }
    if let Ok(value) = std::env::var("ALLOWED_ORIGINS") {
        for raw in value.split(',') {
            if let Some(origin) = persistent_normalize_origin(raw) {
                return origin;
            }
        }
    }
    let backend_port = std::env::var("BACKEND_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(3000);
    format!("http://127.0.0.1:{backend_port}")
}

async fn persistent_read_json_frame(
    stream: &mut OpenClawWsStream,
    timeout_ms: u64,
) -> Result<serde_json::Value, ApiError> {
    loop {
        let next = timeout(Duration::from_millis(timeout_ms), stream.next())
            .await
            .map_err(|_| ApiError::BadRequest("OpenClaw gateway RPC timeout".to_string()))?;
        let Some(frame) = next else {
            return Err(ApiError::BadRequest(
                "OpenClaw gateway RPC socket closed".to_string(),
            ));
        };
        let msg = frame
            .map_err(|e| ApiError::BadRequest(format!("OpenClaw gateway RPC receive failed: {e}")))?;
        match msg {
            WsMessage::Text(text) => {
                return serde_json::from_str::<serde_json::Value>(&text).map_err(|e| {
                    ApiError::BadRequest(format!("Invalid OpenClaw gateway RPC frame: {e}"))
                });
            }
            WsMessage::Binary(bytes) => {
                return serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| {
                    ApiError::BadRequest(format!("Invalid OpenClaw gateway RPC frame: {e}"))
                });
            }
            WsMessage::Ping(_) | WsMessage::Pong(_) => continue,
            WsMessage::Close(_) => {
                return Err(ApiError::BadRequest(
                    "OpenClaw gateway RPC socket closed".to_string(),
                ));
            }
            _ => continue,
        }
    }
}

async fn persistent_read_rpc_response(
    stream: &mut OpenClawWsStream,
    response_id: &str,
    timeout_ms: u64,
) -> Result<serde_json::Value, ApiError> {
    loop {
        let frame = persistent_read_json_frame(stream, timeout_ms).await?;
        let is_response = frame
            .get("type")
            .and_then(serde_json::Value::as_str)
            .map(|v| v == "res")
            .unwrap_or(false);
        let id_matches = frame
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(|v| v == response_id)
            .unwrap_or(false);
        if is_response && id_matches {
            return Ok(frame);
        }
    }
}

async fn persistent_openclaw_connect_client(
    client: &mut PersistentOpenClawRpcClient,
) -> Result<(), ApiError> {
    let ws_url = persistent_gateway_ws_url(&client.gateway_url);
    let mut request = ws_url.as_str().into_client_request().map_err(|e| {
        ApiError::BadRequest(format!("OpenClaw gateway RPC request build failed: {e}"))
    })?;
    let origin = HeaderValue::from_str(&persistent_gateway_request_origin()).map_err(|e| {
        ApiError::BadRequest(format!("OpenClaw gateway RPC origin header is invalid: {e}"))
    })?;
    request.headers_mut().insert("Origin", origin);
    let (mut stream, _) = connect_async(request)
        .await
        .map_err(|e| ApiError::BadRequest(format!("OpenClaw gateway RPC connect failed: {e}")))?;

    let challenge = persistent_read_json_frame(&mut stream, 10_000).await?;
    let nonce = challenge
        .get("payload")
        .and_then(|v| v.get("nonce"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            ApiError::BadRequest("OpenClaw gateway RPC missing connect challenge".to_string())
        })?;

    let identity = get_or_create_openclaw_device_identity()?;
    let signed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let signing_payload = format!(
        "v2|{}|{}|{}|{}|{}|{}|{}|{}",
        identity.device_id,
        "openclaw-control-ui",
        "webchat",
        "operator",
        "operator.admin,operator.read,operator.write",
        signed_at,
        client.gateway_token,
        nonce
    );
    let private_key_bytes =
        URL_SAFE_NO_PAD
            .decode(identity.private_key_b64url.as_bytes())
            .map_err(|e| {
                ApiError::BadRequest(format!("OpenClaw RPC private key decode failed: {e}"))
            })?;
    let private_key_arr: [u8; 32] = private_key_bytes.as_slice().try_into().map_err(|_| {
        ApiError::BadRequest("OpenClaw RPC private key has invalid length".to_string())
    })?;
    let signing_key = SigningKey::from_bytes(&private_key_arr);
    let signature = signing_key.sign(signing_payload.as_bytes()).to_bytes();
    let signature_b64url = URL_SAFE_NO_PAD.encode(signature);

    let connect_req = serde_json::json!({
        "type": "req",
        "id": "__connect__",
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "openclaw-control-ui",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": "web",
                "mode": "webchat",
                "instanceId": format!("viboard-{}", Uuid::new_v4().simple()),
            },
            "role": "operator",
            "scopes": ["operator.admin", "operator.read", "operator.write"],
            "auth": { "token": client.gateway_token },
            "device": {
                "id": identity.device_id,
                "publicKey": identity.public_key_b64url,
                "signature": signature_b64url,
                "signedAt": signed_at,
                "nonce": nonce,
            },
        }
    });
    stream
        .send(WsMessage::Text(connect_req.to_string().into()))
        .await
        .map_err(|e| ApiError::BadRequest(format!("OpenClaw gateway RPC connect send failed: {e}")))?;

    let connect_res = persistent_read_rpc_response(&mut stream, "__connect__", 10_000).await?;
    let connect_ok = connect_res
        .get("type")
        .and_then(serde_json::Value::as_str)
        .map(|v| v == "res")
        .unwrap_or(false)
        && connect_res
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(|v| v == "__connect__")
            .unwrap_or(false)
        && connect_res
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
    if !connect_ok {
        let message = connect_res
            .get("error")
            .and_then(|err| err.get("message").or(Some(err)))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("connect rejected");
        return Err(ApiError::BadRequest(format!(
            "OpenClaw gateway RPC connect failed: {message}"
        )));
    }

    client.stream = Some(stream);
    Ok(())
}

async fn persistent_openclaw_rpc_call(
    client: &mut PersistentOpenClawRpcClient,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    for attempt in 0..2 {
        if client.stream.is_none() {
            persistent_openclaw_connect_client(client).await?;
        }

        let Some(stream) = client.stream.as_mut() else {
            return Err(ApiError::BadRequest(
                "OpenClaw gateway RPC socket is unavailable".to_string(),
            ));
        };

        let req_id = Uuid::new_v4().to_string();
        let method_req = serde_json::json!({
            "type": "req",
            "id": req_id,
            "method": method,
            "params": params,
        });
        if let Err(e) = stream.send(WsMessage::Text(method_req.to_string().into())).await {
            client.stream = None;
            if attempt == 0 {
                continue;
            }
            return Err(ApiError::BadRequest(format!(
                "OpenClaw gateway RPC send failed: {e}"
            )));
        }

        let method_res = match persistent_read_rpc_response(stream, &req_id, 20_000).await {
            Ok(res) => res,
            Err(err) => {
                client.stream = None;
                if attempt == 0 {
                    continue;
                }
                return Err(err);
            }
        };

        let ok = method_res
            .get("type")
            .and_then(serde_json::Value::as_str)
            .map(|v| v == "res")
            .unwrap_or(false)
            && method_res
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(|v| v == req_id)
                .unwrap_or(false)
            && method_res
                .get("ok")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
        if !ok {
            let message = method_res
                .get("error")
                .and_then(|err| {
                    err.get("message")
                        .and_then(serde_json::Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| err.as_str().map(ToString::to_string))
                        .or_else(|| serde_json::to_string(err).ok())
                })
                .unwrap_or_else(|| {
                    serde_json::to_string(&method_res)
                        .unwrap_or_else(|_| "RPC invocation failed".to_string())
                });
            return Err(ApiError::BadRequest(format!(
                "OpenClaw gateway RPC {method} failed: {message}"
            )));
        }

        return Ok(method_res
            .get("payload")
            .or_else(|| method_res.get("result"))
            .cloned()
            .unwrap_or(serde_json::Value::Null));
    }

    Err(ApiError::BadRequest(
        "OpenClaw gateway RPC retries exhausted".to_string(),
    ))
}

async fn list_openclaw_agents(
    Extension(_project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OpenClawAgentsResponse>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };

    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(OpenClawAgentsResponse {
            sessions: Vec::new(),
        })));
    }

    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "sessions_list",
        serde_json::json!({
            "activeMinutes": 24 * 60,
            "limit": 10000,
        }),
        None,
    )
    .await?;
    let mut seen_session_keys = HashSet::new();
    let mut sessions = extract_sessions_array(&result)
        .into_iter()
        .filter_map(|row| {
            let session_key = value_to_string(row.get("sessionKey").or_else(|| row.get("key")))
                .or_else(|| value_to_string(row.get("id")))?;
            if !seen_session_keys.insert(session_key.clone()) {
                return None;
            }
            Some(OpenClawAgentSession {
                session_key,
                label: value_to_string(row.get("label")),
                display_name: value_to_string(row.get("displayName")),
                state: value_to_string(row.get("state")),
                agent_state: value_to_string(row.get("agentState")),
                busy: value_to_bool(row.get("busy")),
                processing: value_to_bool(row.get("processing")),
                status: value_to_string(row.get("status")),
                updated_at: row.get("updatedAt").and_then(value_to_i64),
                last_activity: value_to_string(row.get("lastActivity")),
                model: value_to_string(row.get("model")),
                thinking: value_to_string(row.get("thinkingLevel"))
                    .or_else(|| value_to_string(row.get("thinking"))),
                total_tokens: row.get("totalTokens").and_then(value_to_i64),
                context_tokens: row.get("contextTokens").and_then(value_to_i64),
                parent_session_key: value_to_string(
                    row.get("parentSessionKey").or_else(|| row.get("parentId")),
                ),
            })
        })
        .collect::<Vec<_>>();
    let mut sessions_by_key: HashMap<String, OpenClawAgentSession> = sessions
        .drain(..)
        .map(|session| (session.session_key.clone(), session))
        .collect();
    for session in load_local_openclaw_sessions() {
        sessions_by_key
            .entry(session.session_key.clone())
            .or_insert(session);
    }
    let mut sessions = sessions_by_key.into_values().collect::<Vec<_>>();
    sessions.sort_by(|a, b| (b.updated_at.unwrap_or(0)).cmp(&a.updated_at.unwrap_or(0)));

    Ok(ResponseJson(ApiResponse::success(OpenClawAgentsResponse {
        sessions,
    })))
}

fn extract_memory_entries(workspace_root: &StdPath) -> Vec<OpenClawMemoryEntry> {
    let mut entries = Vec::new();
    let memory_main = workspace_root.join("MEMORY.md");
    if let Ok(content) = fs::read_to_string(&memory_main) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            entries.push(OpenClawMemoryEntry {
                file: "MEMORY.md".to_string(),
                content: trimmed.to_string(),
            });
        }
    }

    let daily_dir = workspace_root.join("memory");
    if let Ok(dir_entries) = fs::read_dir(daily_dir) {
        let mut files = dir_entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "md"))
            .collect::<Vec<_>>();
        files.sort();

        for path in files {
            if let Ok(content) = fs::read_to_string(&path) {
                let trimmed = content.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Some(name) = path.file_name().and_then(|f| f.to_str()) {
                    entries.push(OpenClawMemoryEntry {
                        file: format!("memory/{name}"),
                        content: trimmed.to_string(),
                    });
                }
            }
        }
    }

    entries
}

fn parse_cron_job(row: &serde_json::Value) -> Option<OpenClawCronJob> {
    let id = value_to_string(row.get("id").or_else(|| row.get("jobId")))?;
    let name = value_to_string(row.get("name").or_else(|| row.get("label")))
        .unwrap_or_else(|| id.clone());
    let enabled = value_to_bool(row.get("enabled")).unwrap_or(true);
    let schedule = row
        .get("schedule")
        .cloned()
        .unwrap_or(serde_json::json!({ "kind": "every", "everyMs": 3600000 }));
    let payload = row.get("payload").cloned().unwrap_or(serde_json::json!({}));

    let schedule_kind = value_to_string(schedule.get("kind"))
        .or_else(|| {
            if schedule.get("expr").is_some() {
                Some("cron".to_string())
            } else if schedule.get("at").is_some() {
                Some("at".to_string())
            } else {
                Some("every".to_string())
            }
        })
        .unwrap_or_else(|| "every".to_string());
    let payload_kind = value_to_string(payload.get("kind")).unwrap_or_else(|| "agentTurn".to_string());
    let prompt = value_to_string(payload.get("message").or_else(|| payload.get("text")))
        .unwrap_or_default();

    Some(OpenClawCronJob {
        id,
        name,
        enabled,
        schedule: OpenClawCronSchedule {
            kind: schedule_kind,
            expr: value_to_string(schedule.get("expr")),
            tz: value_to_string(schedule.get("tz")),
            every_ms: schedule.get("everyMs").and_then(value_to_i64),
            at: value_to_string(schedule.get("at")),
        },
        payload: OpenClawCronPayload {
            kind: payload_kind,
            prompt,
        },
    })
}

async fn get_openclaw_memories(
    Extension(project): Extension<Project>,
) -> Result<ResponseJson<ApiResponse<OpenClawMemoriesResponse>>, ApiError> {
    let workspace_root = openclaw_workspace_path(project.id);
    std::fs::create_dir_all(&workspace_root)?;
    let entries = extract_memory_entries(&workspace_root);
    Ok(ResponseJson(ApiResponse::success(OpenClawMemoriesResponse {
        workspace: workspace_root.to_string_lossy().to_string(),
        entries,
    })))
}

async fn list_openclaw_crons(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OpenClawCronsResponse>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(OpenClawCronsResponse {
            jobs: Vec::new(),
        })));
    }
    let workspace = openclaw_workspace_path(project.id)
        .to_string_lossy()
        .to_string();
    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "cron",
        serde_json::json!({
            "action": "list",
            "workspace": workspace,
            "workspaceRoot": workspace,
        }),
        Some("main"),
    )
    .await?;
    let rows = result
        .get("jobs")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let jobs = rows.iter().filter_map(parse_cron_job).collect::<Vec<_>>();
    Ok(ResponseJson(ApiResponse::success(OpenClawCronsResponse { jobs })))
}

async fn create_openclaw_cron(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<OpenClawCronUpsertRequest>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }
    let workspace = openclaw_workspace_path(project.id)
        .to_string_lossy()
        .to_string();
    let mut job = serde_json::json!({
        "schedule": payload.schedule,
        "payload": payload.payload,
        "enabled": payload.enabled.unwrap_or(true),
    });
    if let Some(name) = payload.name.as_ref().filter(|name| !name.trim().is_empty()) {
        job["name"] = serde_json::Value::String(name.trim().to_string());
    }
    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "cron",
        serde_json::json!({
            "action": "add",
            "job": job,
            "workspace": workspace,
            "workspaceRoot": workspace,
        }),
        Some("main"),
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn update_openclaw_cron(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, cron_id)): axum::extract::Path<(String, String)>,
    Json(payload): Json<OpenClawCronUpsertRequest>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }
    let workspace = openclaw_workspace_path(project.id)
        .to_string_lossy()
        .to_string();
    let mut patch = serde_json::json!({
        "schedule": payload.schedule,
        "payload": payload.payload,
    });
    if let Some(enabled) = payload.enabled {
        patch["enabled"] = serde_json::Value::Bool(enabled);
    }
    if let Some(name) = payload.name.as_ref().filter(|name| !name.trim().is_empty()) {
        patch["name"] = serde_json::Value::String(name.trim().to_string());
    }
    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "cron",
        serde_json::json!({
            "action": "update",
            "id": cron_id,
            "patch": patch,
            "workspace": workspace,
            "workspaceRoot": workspace,
        }),
        Some("main"),
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn delete_openclaw_cron(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, cron_id)): axum::extract::Path<(String, String)>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }
    let workspace = openclaw_workspace_path(project.id)
        .to_string_lossy()
        .to_string();
    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "cron",
        serde_json::json!({
            "action": "remove",
            "id": cron_id,
            "workspace": workspace,
            "workspaceRoot": workspace,
        }),
        Some("main"),
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn toggle_openclaw_cron(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, cron_id)): axum::extract::Path<(String, String)>,
    Json(payload): Json<OpenClawToggleCronRequest>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }
    let workspace = openclaw_workspace_path(project.id)
        .to_string_lossy()
        .to_string();
    let result = invoke_openclaw_tool(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "cron",
        serde_json::json!({
            "action": "toggle",
            "id": cron_id,
            "enabled": payload.enabled,
            "workspace": workspace,
            "workspaceRoot": workspace,
        }),
        Some("main"),
    )
    .await?;
    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn get_openclaw_session_history(
    Extension(_project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, session_key)): axum::extract::Path<(String, String)>,
) -> Result<ResponseJson<ApiResponse<OpenClawSessionChatResponse>>, ApiError> {
    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Ok(ResponseJson(ApiResponse::success(
            OpenClawSessionChatResponse {
                session_key,
                messages: Vec::new(),
            },
        )));
    }

    let result = invoke_openclaw_rpc(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "chat.history",
        serde_json::json!({
            "sessionKey": session_key,
            "limit": 500,
        }),
    )
    .await?;
    let messages = parse_openclaw_messages(&result);

    Ok(ResponseJson(ApiResponse::success(
        OpenClawSessionChatResponse {
            session_key,
            messages,
        },
    )))
}

async fn send_openclaw_session_message(
    Extension(_project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, session_key)): axum::extract::Path<(String, String)>,
    Json(payload): Json<OpenClawSendMessageRequest>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let text = payload.text.trim();
    if text.is_empty() {
        return Err(ApiError::BadRequest(
            "Message text cannot be empty".to_string(),
        ));
    }

    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }

    let result = invoke_openclaw_rpc(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "chat.send",
        serde_json::json!({
            "sessionKey": session_key,
            "message": text,
            "deliver": true,
            "idempotencyKey": format!("viboard-openclaw-{}", Uuid::new_v4()),
        }),
    )
    .await?;

    if let Some(status) = result
        .get("status")
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_ascii_lowercase())
    {
        if matches!(status.as_str(), "error" | "forbidden" | "timeout" | "cancelled") {
            let message = result
                .get("error")
                .and_then(serde_json::Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("OpenClaw session send failed");
            return Err(ApiError::BadRequest(format!(
                "OpenClaw gateway tool sessions_send failed: {message}"
            )));
        }
    }

    Ok(ResponseJson(ApiResponse::success(result)))
}

async fn delete_openclaw_session(
    Extension(_project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((_, session_key)): axum::extract::Path<(String, String)>,
) -> Result<ResponseJson<ApiResponse<serde_json::Value>>, ApiError> {
    let key = session_key.trim().to_string();
    if key.is_empty() {
        return Err(ApiError::BadRequest(
            "Session key cannot be empty".to_string(),
        ));
    }

    let openclaw_settings = {
        let config = deployment.config().read().await;
        config.openclaw.clone()
    };
    let gateway_url = openclaw_settings.gateway_url.trim().trim_end_matches('/');
    if gateway_url.is_empty() {
        return Err(ApiError::BadRequest(
            "OpenClaw gateway URL is not configured".to_string(),
        ));
    }

    let sessions_result = invoke_openclaw_rpc(
        gateway_url,
        openclaw_settings.gateway_key.trim(),
        "sessions.list",
        serde_json::json!({
            "limit": 10000,
        }),
    )
    .await?;

    let sessions = extract_sessions_array(&sessions_result);
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    for row in sessions {
        let child_key = value_to_string(row.get("sessionKey").or_else(|| row.get("key")))
            .or_else(|| value_to_string(row.get("id")));
        let parent_key = value_to_string(row.get("parentSessionKey").or_else(|| row.get("parentId")));
        let (Some(child_key), Some(parent_key)) = (child_key, parent_key) else {
            continue;
        };
        children_by_parent.entry(parent_key).or_default().push(child_key);
    }

    fn collect_descendants_post_order(
        parent: &str,
        children_by_parent: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        output: &mut Vec<String>,
    ) {
        let Some(children) = children_by_parent.get(parent) else {
            return;
        };
        for child in children {
            if !visited.insert(child.clone()) {
                continue;
            }
            collect_descendants_post_order(child, children_by_parent, visited, output);
            output.push(child.clone());
        }
    }

    let mut keys_to_delete = Vec::new();
    let mut visited = HashSet::new();
    collect_descendants_post_order(&key, &children_by_parent, &mut visited, &mut keys_to_delete);
    keys_to_delete.push(key.clone());

    for key_to_delete in &keys_to_delete {
        invoke_openclaw_rpc(
            gateway_url,
            openclaw_settings.gateway_key.trim(),
            "sessions.delete",
            serde_json::json!({
                "key": key_to_delete,
                "deleteTranscript": true,
            }),
        )
        .await?;
    }

    Ok(ResponseJson(ApiResponse::success(serde_json::json!({
        "deleted": keys_to_delete,
    }))))
}

pub fn apply_project_settings(project: &mut Project, config: &services::services::config::Config) {
    let settings = config.project_settings(project.id);
    project.setup_script = settings.setup_script;
    project.dev_script = settings.dev_script;
    project.cleanup_script = settings.cleanup_script;
    project.copy_files = settings.copy_files;
    project.parallel_setup_script = settings.parallel_setup_script;
}

pub async fn get_project_branches(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<GitBranch>>>, ApiError> {
    let branches = deployment.git().get_all_branches(&project.git_repo_path)?;
    Ok(ResponseJson(ApiResponse::success(branches)))
}

pub async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let id = Uuid::new_v4();
    let CreateProject {
        name,
        git_repo_path,
        setup_script,
        dev_script,
        cleanup_script,
        copy_files,
        parallel_setup_script,
        use_existing_repo,
    } = payload;
    let project_settings = ProjectSettings::from_scripts(
        setup_script.clone(),
        dev_script.clone(),
        cleanup_script.clone(),
        copy_files.clone(),
        parallel_setup_script.unwrap_or(false),
    );
    tracing::debug!("Creating project '{}'", name);

    // Validate and setup git repository
    let path = std::path::absolute(expand_tilde(&git_repo_path))?;
    // Check if git repo path is already used by another project
    match Project::find_by_git_repo_path(&deployment.db().pool, path.to_string_lossy().as_ref())
        .await
    {
        Ok(Some(_)) => {
            return Ok(ResponseJson(ApiResponse::error(
                "A project with this git repository path already exists",
            )));
        }
        Ok(None) => {
            // Path is available, continue
        }
        Err(e) => {
            return Err(ProjectError::GitRepoCheckFailed(e.to_string()).into());
        }
    }

    if use_existing_repo {
        // For existing repos, validate that the path exists and is a git repository
        if !path.exists() {
            return Ok(ResponseJson(ApiResponse::error(
                "The specified path does not exist",
            )));
        }

        if !path.is_dir() {
            return Ok(ResponseJson(ApiResponse::error(
                "The specified path is not a directory",
            )));
        }

        if !path.join(".git").exists() {
            return Ok(ResponseJson(ApiResponse::error(
                "The specified directory is not a git repository",
            )));
        }

        // Ensure existing repo has a main branch if it's empty
        if let Err(e) = deployment.git().ensure_main_branch_exists(&path) {
            tracing::error!("Failed to ensure main branch exists: {}", e);
            return Ok(ResponseJson(ApiResponse::error(&format!(
                "Failed to ensure main branch exists: {}",
                e
            ))));
        }
    } else {
        // For new repos, create directory and initialize git

        // Create directory if it doesn't exist
        if !path.exists()
            && let Err(e) = std::fs::create_dir_all(&path)
        {
            tracing::error!("Failed to create directory: {}", e);
            return Ok(ResponseJson(ApiResponse::error(&format!(
                "Failed to create directory: {}",
                e
            ))));
        }

        // Check if it's already a git repo, if not initialize it
        if !path.join(".git").exists()
            && let Err(e) = deployment.git().initialize_repo_with_main_branch(&path)
        {
            tracing::error!("Failed to initialize git repository: {}", e);
            return Ok(ResponseJson(ApiResponse::error(&format!(
                "Failed to initialize git repository: {}",
                e
            ))));
        }
    }

    match Project::create(
        &deployment.db().pool,
        &CreateProject {
            name,
            git_repo_path: path.to_string_lossy().to_string(),
            use_existing_repo,
            setup_script: None,
            dev_script: None,
            cleanup_script: None,
            copy_files: None,
            parallel_setup_script: Some(false),
        },
        id,
    )
    .await
    {
        Ok(project) => {
            let mut config = deployment.config().write().await;
            config.set_project_settings(project.id, project_settings);
            if let Err(e) = save_config_to_file(&config, &utils::assets::config_path()).await {
                tracing::error!("Failed to persist project settings to config.json: {}", e);
                return Err(e.into());
            }
            drop(config);

            let mut project = project;
            let config = deployment.config().read().await;
            apply_project_settings(&mut project, &config);
            // Track project creation event

            Ok(ResponseJson(ApiResponse::success(project)))
        }
        Err(e) => Err(ProjectError::CreateFailed(e.to_string()).into()),
    }
}

pub async fn update_project(
    Extension(existing_project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, StatusCode> {
    // Destructure payload to handle field updates.
    // This allows us to treat `None` from the payload as an explicit `null` to clear a field,
    // as the frontend currently sends all fields on update.
    let UpdateProject {
        name,
        git_repo_path,
        setup_script,
        dev_script,
        cleanup_script,
        copy_files,
        parallel_setup_script,
    } = payload;
    // If git_repo_path is being changed, check if the new path is already used by another project
    let git_repo_path = if let Some(new_git_repo_path) = git_repo_path.map(|s| expand_tilde(&s))
        && new_git_repo_path != existing_project.git_repo_path
    {
        match Project::find_by_git_repo_path_excluding_id(
            &deployment.db().pool,
            new_git_repo_path.to_string_lossy().as_ref(),
            existing_project.id,
        )
        .await
        {
            Ok(Some(_)) => {
                return Ok(ResponseJson(ApiResponse::error(
                    "A project with this git repository path already exists",
                )));
            }
            Ok(None) => new_git_repo_path,
            Err(e) => {
                tracing::error!("Failed to check for existing git repo path: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        existing_project.git_repo_path
    };

    match Project::update(
        &deployment.db().pool,
        existing_project.id,
        name.unwrap_or(existing_project.name),
        git_repo_path.to_string_lossy().to_string(),
    )
    .await
    {
        Ok(mut project) => {
            let mut config = deployment.config().write().await;
            config.set_project_settings(
                existing_project.id,
                ProjectSettings::from_scripts(
                    setup_script,
                    dev_script,
                    cleanup_script,
                    copy_files,
                    parallel_setup_script.unwrap_or(false),
                ),
            );
            if let Err(e) = save_config_to_file(&config, &utils::assets::config_path()).await {
                tracing::error!("Failed to persist project settings to config.json: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            apply_project_settings(&mut project, &config);
            Ok(ResponseJson(ApiResponse::success(project)))
        }
        Err(e) => {
            tracing::error!("Failed to update project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_project(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    let tasks = Task::find_by_project_id_with_attempt_status(&deployment.db().pool, project.id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch tasks for project {}: {}", project.id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    for task_with_attempt_status in tasks {
        if let Err(e) = crate::routes::tasks::delete_task_with_cleanup(
            task_with_attempt_status.task,
            deployment.clone(),
        )
        .await
        {
            tracing::error!(
                "Failed to delete task while deleting project {}: {}",
                project.id,
                e
            );
            return Err(match e {
                ApiError::Conflict(_) => StatusCode::CONFLICT,
                ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
                ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            });
        }
    }

    match Project::delete(&deployment.db().pool, project.id).await {
        Ok(rows_affected) => {
            if rows_affected == 0 {
                Err(StatusCode::NOT_FOUND)
            } else {
                Ok(ResponseJson(ApiResponse::success(())))
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(serde::Deserialize)]
pub struct OpenEditorRequest {
    editor_type: Option<String>,
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
pub struct OpenEditorResponse {
    pub url: Option<String>,
}

pub async fn open_project_in_editor(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<Option<OpenEditorRequest>>,
) -> Result<ResponseJson<ApiResponse<OpenEditorResponse>>, ApiError> {
    let path = project.git_repo_path;

    let editor_config = {
        let config = deployment.config().read().await;
        let editor_type_str = payload.as_ref().and_then(|req| req.editor_type.as_deref());
        config.editor.with_override(editor_type_str)
    };

    match editor_config.open_file(&path, None).await {
        Ok(url) => {
            tracing::info!(
                "Opened editor for project {} at path: {}{}",
                project.id,
                path.to_string_lossy(),
                if url.is_some() { " (remote mode)" } else { "" }
            );

            Ok(ResponseJson(ApiResponse::success(OpenEditorResponse {
                url,
            })))
        }
        Err(e) => {
            tracing::error!("Failed to open editor for project {}: {:?}", project.id, e);
            Err(ApiError::EditorOpen(e))
        }
    }
}

pub async fn open_openclaw_workspace_in_editor(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<Option<OpenEditorRequest>>,
) -> Result<ResponseJson<ApiResponse<OpenEditorResponse>>, ApiError> {
    let path = openclaw_workspace_path(project.id);
    std::fs::create_dir_all(&path)?;
    let editor_config = {
        let config = deployment.config().read().await;
        let editor_type_str = payload.as_ref().and_then(|req| req.editor_type.as_deref());
        config.editor.with_override(editor_type_str)
    };

    match editor_config.open_file(&path, None).await {
        Ok(url) => Ok(ResponseJson(ApiResponse::success(OpenEditorResponse { url }))),
        Err(e) => Err(ApiError::EditorOpen(e)),
    }
}

pub async fn search_project_files(
    State(deployment): State<DeploymentImpl>,
    Extension(project): Extension<Project>,
    Query(search_query): Query<SearchQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<SearchResult>>>, StatusCode> {
    let query = search_query.q.trim();
    let mode = search_query.mode;

    if query.is_empty() {
        return Ok(ResponseJson(ApiResponse::error(
            "Query parameter 'q' is required and cannot be empty",
        )));
    }

    let repo_path = &project.git_repo_path;
    let file_search_cache = deployment.file_search_cache();

    // Try cache first
    match file_search_cache
        .search(repo_path, query, mode.clone())
        .await
    {
        Ok(results) => {
            tracing::debug!(
                "Cache hit for repo {:?}, query: {}, mode: {:?}",
                repo_path,
                query,
                mode
            );
            Ok(ResponseJson(ApiResponse::success(results)))
        }
        Err(CacheError::Miss) => {
            // Cache miss - fall back to filesystem search
            tracing::debug!(
                "Cache miss for repo {:?}, query: {}, mode: {:?}",
                repo_path,
                query,
                mode
            );
            match search_files_in_repo(&project.git_repo_path.to_string_lossy(), query, mode).await
            {
                Ok(results) => Ok(ResponseJson(ApiResponse::success(results))),
                Err(e) => {
                    tracing::error!("Failed to search files: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(CacheError::BuildError(e)) => {
            tracing::error!("Cache build error for repo {:?}: {}", repo_path, e);
            // Fall back to filesystem search
            match search_files_in_repo(&project.git_repo_path.to_string_lossy(), query, mode).await
            {
                Ok(results) => Ok(ResponseJson(ApiResponse::success(results))),
                Err(e) => {
                    tracing::error!("Failed to search files: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
    }
}

async fn search_files_in_repo(
    repo_path: &str,
    query: &str,
    mode: SearchMode,
) -> Result<Vec<SearchResult>, Box<dyn std::error::Error + Send + Sync>> {
    let repo_path = StdPath::new(repo_path);

    if !repo_path.exists() {
        return Err("Repository path does not exist".into());
    }

    let mut scored_results: Vec<(i32, SearchResult)> = Vec::new();
    let query_lower = query.to_lowercase();
    let (score_threshold, max_results) = match mode {
        SearchMode::Settings => (SETTINGS_FUZZY_SCORE_THRESHOLD, SETTINGS_MAX_RESULTS),
        SearchMode::TaskForm => (TASK_FORM_FUZZY_SCORE_THRESHOLD, TASK_FORM_MAX_RESULTS),
    };

    // Configure walker based on mode
    let walker = match mode {
        SearchMode::Settings => {
            // Settings mode: Include ignored files but exclude performance killers
            WalkBuilder::new(repo_path)
                .git_ignore(false) // Include ignored files like .env
                .git_global(false)
                .git_exclude(false)
                .hidden(false)
                .filter_entry(|entry| {
                    let name = entry.file_name().to_string_lossy();
                    // Always exclude .git directories and performance killers
                    name != ".git"
                        && name != "node_modules"
                        && name != "target"
                        && name != "dist"
                        && name != "build"
                })
                .build()
        }
        SearchMode::TaskForm => {
            // Task form mode: Respect gitignore (cleaner results)
            WalkBuilder::new(repo_path)
                .git_ignore(true) // Respect .gitignore
                .git_global(true) // Respect global .gitignore
                .git_exclude(true) // Respect .git/info/exclude
                .hidden(false) // Still show hidden files like .env (if not gitignored)
                .filter_entry(|entry| {
                    let name = entry.file_name().to_string_lossy();
                    name != ".git"
                })
                .build()
        }
    };

    for result in walker {
        let entry = result?;
        let path = entry.path();

        // Skip the root directory itself
        if path == repo_path {
            continue;
        }

        let relative_path = path.strip_prefix(repo_path)?;
        let relative_path_str = relative_path.to_string_lossy().to_lowercase();

        if let Some((score, match_type)) = fuzzy_file_score(&relative_path_str, &query_lower) {
            if score < score_threshold {
                continue;
            }
            scored_results.push((
                score,
                SearchResult {
                    path: relative_path.to_string_lossy().to_string(),
                    is_file: path.is_file(),
                    match_type,
                },
            ));
        }
    }

    scored_results.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.path.cmp(&b.1.path)));
    Ok(scored_results
        .into_iter()
        .take(max_results)
        .map(|(_, result)| result)
        .collect())
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let project_id_router = Router::new()
        .route(
            "/",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route("/openclaw/agents", get(list_openclaw_agents))
        .route("/openclaw/memories", get(get_openclaw_memories))
        .route(
            "/openclaw/crons",
            get(list_openclaw_crons).post(create_openclaw_cron),
        )
        .route(
            "/openclaw/crons/{cron_id}",
            axum::routing::patch(update_openclaw_cron).delete(delete_openclaw_cron),
        )
        .route(
            "/openclaw/crons/{cron_id}/toggle",
            post(toggle_openclaw_cron),
        )
        .route(
            "/openclaw/agents/{session_key}/history",
            get(get_openclaw_session_history),
        )
        .route(
            "/openclaw/agents/{session_key}/send",
            post(send_openclaw_session_message),
        )
        .route(
            "/openclaw/agents/{session_key}",
            axum::routing::delete(delete_openclaw_session),
        )
        .route("/openclaw/open-editor", post(open_openclaw_workspace_in_editor))
        .route("/branches", get(get_project_branches))
        .route("/search", get(search_project_files))
        .route("/open-editor", post(open_project_in_editor))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_project_middleware,
        ));

    let projects_router = Router::new()
        .route("/", get(get_projects).post(create_project))
        .nest("/{id}", project_id_router);

    Router::new().nest("/projects", projects_router)
}
