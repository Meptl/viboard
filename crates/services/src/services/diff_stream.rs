use std::{
    collections::HashSet,
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

use executors::logs::utils::{ConversationPatch, patch::escape_json_pointer_segment};
use futures::StreamExt;
use notify_debouncer_full::DebouncedEvent;
use thiserror::Error;
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_stream::wrappers::ReceiverStream;
use utils::{diff::Diff, log_msg::LogMsg};

use crate::services::{
    filesystem_watcher::{self, FilesystemWatcherError},
    git::{Commit, DiffDetailLevel, DiffTarget, GitService, GitServiceError},
};

const DIFF_STREAM_CHANNEL_CAPACITY: usize = 1000;

/// Errors that can occur during diff stream creation and operation
#[derive(Error, Debug)]
pub enum DiffStreamError {
    #[error("Git service error: {0}")]
    GitService(#[from] GitServiceError),
    #[error("Filesystem watcher error: {0}")]
    FilesystemWatcher(#[from] FilesystemWatcherError),
    #[error("Task join error: {0}")]
    TaskJoin(#[from] tokio::task::JoinError),
}

/// Diff stream that owns the filesystem watcher task
/// When this stream is dropped, the watcher is automatically cleaned up
pub struct DiffStreamHandle {
    stream: futures::stream::BoxStream<'static, Result<LogMsg, io::Error>>,
    _watcher_task: Option<JoinHandle<()>>,
}

impl futures::Stream for DiffStreamHandle {
    type Item = Result<LogMsg, io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        // Delegate to inner stream
        std::pin::Pin::new(&mut self.stream).poll_next(cx)
    }
}

impl Drop for DiffStreamHandle {
    fn drop(&mut self) {
        if let Some(handle) = self._watcher_task.take() {
            handle.abort();
        }
    }
}

impl DiffStreamHandle {
    /// Create a new DiffStreamHandle from a boxed stream and optional watcher task
    pub fn new(
        stream: futures::stream::BoxStream<'static, Result<LogMsg, io::Error>>,
        watcher_task: Option<JoinHandle<()>>,
    ) -> Self {
        Self {
            stream,
            _watcher_task: watcher_task,
        }
    }
}

struct DiffWatcherContext {
    git_service: GitService,
    worktree_path: PathBuf,
    base_commit: Commit,
    target_branch: Option<String>,
    full_sent: Arc<std::sync::RwLock<HashSet<String>>>,
    tx: mpsc::Sender<Result<LogMsg, io::Error>>,
}

impl DiffWatcherContext {
    async fn handle_events(
        &self,
        events: Vec<DebouncedEvent>,
        canonical_worktree_path: &Path,
    ) -> bool {
        let changed_paths =
            extract_changed_paths(&events, canonical_worktree_path, &self.worktree_path);

        if changed_paths.is_empty() {
            return true;
        }

        let git_service = self.git_service.clone();
        let worktree_path = self.worktree_path.clone();
        let base_commit = self.base_commit.clone();
        let target_branch = self.target_branch.clone();
        let full_sent = self.full_sent.clone();

        match tokio::task::spawn_blocking(move || {
            process_file_changes(ProcessFileChangesInput {
                git_service: &git_service,
                worktree_path: &worktree_path,
                base_commit: &base_commit,
                target_branch: target_branch.as_deref(),
                changed_paths: &changed_paths,
                full_sent_paths: &full_sent,
            })
        })
        .await
        {
            Ok(Ok(messages)) => send_messages(&self.tx, messages).await,
            Ok(Err(err)) => {
                tracing::error!("Error processing file changes: {err}");
                send_error(&self.tx, err.to_string()).await;
                false
            }
            Err(join_err) => {
                tracing::error!("Diff processing task join error: {join_err}");
                send_error(
                    &self.tx,
                    format!("Diff processing task join error: {join_err}"),
                )
                .await;
                false
            }
        }
    }
}

pub async fn create(
    git_service: GitService,
    worktree_path: PathBuf,
    base_commit: Commit,
    target_branch: Option<String>,
) -> Result<DiffStreamHandle, DiffStreamError> {
    let (tx, rx) = mpsc::channel::<Result<LogMsg, io::Error>>(DIFF_STREAM_CHANNEL_CAPACITY);

    let full_sent = Arc::new(std::sync::RwLock::new(HashSet::<String>::new()));

    // Spawn a task to fetch initial diffs and set up the file watcher.
    // This allows the stream to be returned immediately while diff fetching
    // happens in the background, preventing WebSocket timeouts for large diffs.
    let tx_clone = tx.clone();
    let watcher_task = tokio::spawn(async move {
        // Fetch initial diffs in a blocking task to avoid blocking the async runtime
        let git_for_diff = git_service.clone();
        let worktree_for_diff = worktree_path.clone();
        let base_for_diff = base_commit.clone();
        let target_branch_for_diff = target_branch.clone();

        let initial_diffs_result = tokio::task::spawn_blocking(move || {
            // @lat: [[lazy-diff-loading#Metadata-First Diff Stream]]
            let effective_base = resolve_base_commit(
                &git_for_diff,
                &worktree_for_diff,
                &base_for_diff,
                target_branch_for_diff.as_deref(),
            )
            .unwrap_or_else(|err| {
                tracing::warn!(
                    "Failed to refresh diff base commit for initial stream snapshot: {err}"
                );
                base_for_diff.clone()
            });
            git_for_diff.get_diffs(
                DiffTarget::Worktree {
                    worktree_path: &worktree_for_diff,
                    base_commit: &effective_base,
                },
                None,
                DiffDetailLevel::MetadataOnly,
            )
        })
        .await;

        let initial_diffs_raw = match initial_diffs_result {
            Ok(Ok(diffs)) => diffs,
            Ok(Err(e)) => {
                tracing::error!("Failed to get initial diffs: {e}");
                send_error(&tx_clone, e.to_string()).await;
                return;
            }
            Err(join_err) => {
                tracing::error!("Diff fetch task join error: {join_err}");
                send_error(&tx_clone, format!("Diff fetch failed: {join_err}")).await;
                return;
            }
        };

        let mut initial_diffs = Vec::with_capacity(initial_diffs_raw.len());
        for diff in initial_diffs_raw {
            initial_diffs.push(diff);
        }

        {
            let mut guard = full_sent.write().unwrap();
            for diff in &initial_diffs {
                if !diff.content_omitted {
                    guard.insert(GitService::diff_path(diff));
                }
            }
        }

        if !send_initial_diffs(&tx_clone, initial_diffs).await {
            return;
        }
        // Signal initial snapshot completion while keeping the stream alive
        // for subsequent filesystem-driven updates.
        if tx_clone.send(Ok(LogMsg::Finished)).await.is_err() {
            return;
        }

        // Set up filesystem watcher for live updates
        let worktree_for_watcher = worktree_path.clone();
        let watcher_result = tokio::task::spawn_blocking(move || {
            filesystem_watcher::async_watcher(worktree_for_watcher)
        })
        .await;

        let (debouncer, mut watcher_rx, canonical_worktree_path) = match watcher_result {
            Ok(Ok(parts)) => parts,
            Ok(Err(e)) => {
                tracing::error!("Failed to set up filesystem watcher: {e}");
                send_error(&tx_clone, e.to_string()).await;
                return;
            }
            Err(join_err) => {
                tracing::error!("Failed to spawn watcher setup: {join_err}");
                send_error(
                    &tx_clone,
                    format!("Failed to spawn watcher setup: {join_err}"),
                )
                .await;
                return;
            }
        };

        let ctx = DiffWatcherContext {
            git_service,
            worktree_path,
            base_commit,
            target_branch,
            full_sent,
            tx: tx_clone,
        };

        let _debouncer_guard = debouncer;

        while let Some(result) = watcher_rx.next().await {
            match result {
                Ok(events) => {
                    if !ctx.handle_events(events, &canonical_worktree_path).await {
                        return;
                    }
                }
                Err(errors) => {
                    let message = errors
                        .iter()
                        .map(|e| e.to_string())
                        .collect::<Vec<_>>()
                        .join("; ");
                    tracing::error!("Filesystem watcher error: {message}");
                    send_error(&ctx.tx, message).await;
                    return;
                }
            }
        }
    });

    drop(tx);

    Ok(DiffStreamHandle::new(
        ReceiverStream::new(rx).boxed(),
        Some(watcher_task),
    ))
}

async fn send_initial_diffs(
    tx: &mpsc::Sender<Result<LogMsg, io::Error>>,
    diffs: Vec<Diff>,
) -> bool {
    for diff in diffs {
        let entry_index = GitService::diff_path(&diff);
        let patch = ConversationPatch::add_diff(escape_json_pointer_segment(&entry_index), diff);
        if tx.send(Ok(LogMsg::JsonPatch(patch))).await.is_err() {
            return false;
        }
    }
    true
}

async fn send_messages(
    tx: &mpsc::Sender<Result<LogMsg, io::Error>>,
    messages: Vec<LogMsg>,
) -> bool {
    for msg in messages {
        if tx.send(Ok(msg)).await.is_err() {
            return false;
        }
    }
    true
}

async fn send_error(tx: &mpsc::Sender<Result<LogMsg, io::Error>>, message: String) {
    let _ = tx.send(Err(io::Error::other(message))).await;
}

fn extract_changed_paths(
    events: &[DebouncedEvent],
    canonical_worktree_path: &Path,
    worktree_path: &Path,
) -> Vec<String> {
    events
        .iter()
        .flat_map(|event| &event.paths)
        .filter_map(|path| {
            path.strip_prefix(canonical_worktree_path)
                .or_else(|_| path.strip_prefix(worktree_path))
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .filter(|s| !s.is_empty())
        .collect()
}

struct ProcessFileChangesInput<'a> {
    git_service: &'a GitService,
    worktree_path: &'a Path,
    base_commit: &'a Commit,
    target_branch: Option<&'a str>,
    changed_paths: &'a [String],
    full_sent_paths: &'a Arc<std::sync::RwLock<HashSet<String>>>,
}

fn process_file_changes(
    input: ProcessFileChangesInput<'_>,
) -> Result<Vec<LogMsg>, DiffStreamError> {
    let ProcessFileChangesInput {
        git_service,
        worktree_path,
        base_commit,
        target_branch,
        changed_paths,
        full_sent_paths,
    } = input;

    let path_filter: Vec<&str> = changed_paths.iter().map(|s| s.as_str()).collect();

    let effective_base =
        resolve_base_commit(git_service, worktree_path, base_commit, target_branch).unwrap_or_else(
            |err| {
                tracing::warn!("Failed to refresh diff base commit during live update: {err}");
                base_commit.clone()
            },
        );

    let current_diffs = git_service.get_diffs(
        DiffTarget::Worktree {
            worktree_path,
            base_commit: &effective_base,
        },
        Some(&path_filter),
        DiffDetailLevel::MetadataOnly,
    )?;

    let mut msgs = Vec::new();
    let mut files_with_diffs = HashSet::new();

    for diff in current_diffs {
        let file_path = GitService::diff_path(&diff);
        files_with_diffs.insert(file_path.clone());
        if diff.content_omitted {
            if full_sent_paths.read().unwrap().contains(&file_path) {
                continue;
            }
        } else {
            let mut guard = full_sent_paths.write().unwrap();
            guard.insert(file_path.clone());
        }

        let patch = ConversationPatch::add_diff(escape_json_pointer_segment(&file_path), diff);
        msgs.push(LogMsg::JsonPatch(patch));
    }

    for changed_path in changed_paths {
        if !files_with_diffs.contains(changed_path) {
            let patch = ConversationPatch::remove_diff(escape_json_pointer_segment(changed_path));
            msgs.push(LogMsg::JsonPatch(patch));
        }
    }

    Ok(msgs)
}

fn resolve_base_commit(
    git_service: &GitService,
    worktree_path: &Path,
    fallback_base_commit: &Commit,
    target_branch: Option<&str>,
) -> Result<Commit, DiffStreamError> {
    let Some(target_branch) = target_branch else {
        return Ok(fallback_base_commit.clone());
    };

    let head = git_service.get_head_info(worktree_path)?;
    Ok(git_service.get_base_commit(worktree_path, &head.branch, target_branch)?)
}
