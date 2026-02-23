use anyhow::{self, Error as AnyhowError};
use chrono::{Duration as ChronoDuration, Utc};
use db::models::task::Task;
use local_deployment::{Deployment, DeploymentError};
use server::{DeploymentImpl, routes};
use services::services::container::ContainerService;
use sqlx::Error as SqlxError;
use strip_ansi_escapes::strip;
use thiserror::Error;
use tokio::time::{self, MissedTickBehavior};
use tracing_subscriber::{EnvFilter, prelude::*};
use utils::{assets::asset_dir, browser::open_browser, port_file::write_port_file};

#[derive(Debug, Error)]
pub enum VibeKanbanError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] SqlxError),
    #[error(transparent)]
    Deployment(#[from] DeploymentError),
    #[error(transparent)]
    Other(#[from] AnyhowError),
}

const CANCELLED_TASK_RETENTION: ChronoDuration = ChronoDuration::hours(1);
const CANCELLED_TASK_CLEANUP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

#[tokio::main]
async fn main() -> Result<(), VibeKanbanError> {
    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let filter_string = format!(
        "warn,server={level},services={level},db={level},executors={level},deployment={level},local_deployment={level},utils={level}",
        level = log_level
    );
    let env_filter = EnvFilter::try_new(filter_string).expect("Failed to create tracing filter");
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(env_filter))
        .init();

    // Create asset directory if it doesn't exist
    if !asset_dir().exists() {
        std::fs::create_dir_all(asset_dir())?;
    }

    let deployment = DeploymentImpl::new().await?;
    deployment
        .container()
        .cleanup_orphan_executions()
        .await
        .map_err(DeploymentError::from)?;
    deployment
        .container()
        .backfill_before_head_commits()
        .await
        .map_err(DeploymentError::from)?;
    // Pre-warm file search cache for most active projects
    let deployment_for_cache = deployment.clone();
    tokio::spawn(async move {
        if let Err(e) = deployment_for_cache
            .file_search_cache()
            .warm_most_active(&deployment_for_cache.db().pool, 3)
            .await
        {
            tracing::warn!("Failed to warm file search cache: {}", e);
        }
    });
    let deployment_for_cancelled_cleanup = deployment.clone();
    tokio::spawn(async move {
        run_cancelled_task_cleanup_loop(deployment_for_cancelled_cleanup).await;
    });

    let app_router = routes::router(deployment.clone());

    let port = std::env::var("BACKEND_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|s| {
            // remove any ANSI codes, then turn into String
            let cleaned =
                String::from_utf8(strip(s.as_bytes())).expect("UTF-8 after stripping ANSI");
            cleaned.trim().parse::<u16>().ok()
        })
        .unwrap_or_else(|| {
            tracing::info!("No PORT environment variable set, using port 0 for auto-assignment");
            0
        }); // Use 0 to find free port if no specific port provided

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    let actual_port = listener.local_addr()?.port(); // get → 53427 (example)

    // Write port file for discovery if prod, warn on fail
    if let Err(e) = write_port_file(actual_port).await {
        tracing::warn!("Failed to write port file: {}", e);
    }

    tracing::info!("Server running on http://{host}:{actual_port}");

    if !cfg!(debug_assertions) {
        tracing::info!("Opening browser...");
        tokio::spawn(async move {
            if let Err(e) = open_browser(&format!("http://127.0.0.1:{actual_port}")).await {
                tracing::warn!(
                    "Failed to open browser automatically: {}. Please open http://127.0.0.1:{} manually.",
                    e,
                    actual_port
                );
            }
        });
    }

    axum::serve(listener, app_router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    perform_cleanup_actions(&deployment).await;

    Ok(())
}

async fn run_cancelled_task_cleanup_loop(deployment: DeploymentImpl) {
    let mut interval = time::interval(CANCELLED_TASK_CLEANUP_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        interval.tick().await;
        if let Err(err) = cleanup_expired_cancelled_tasks(&deployment).await {
            tracing::warn!("Cancelled task cleanup sweep failed: {}", err);
        }
    }
}

async fn cleanup_expired_cancelled_tasks(deployment: &DeploymentImpl) -> Result<(), AnyhowError> {
    let cutoff = Utc::now() - CANCELLED_TASK_RETENTION;
    let expired_tasks = Task::find_cancelled_older_than(&deployment.db().pool, cutoff).await?;

    for task in expired_tasks {
        let task_id = task.id;
        match routes::tasks::delete_task_with_cleanup(task, deployment.clone()).await {
            Ok(()) => {
                tracing::info!("Auto-deleted expired cancelled task {}", task_id);
            }
            Err(server::error::ApiError::Conflict(msg)) => {
                tracing::info!(
                    "Skipped auto-delete for cancelled task {} due to conflict: {}",
                    task_id,
                    msg
                );
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to auto-delete expired cancelled task {}: {}",
                    task_id,
                    err
                );
            }
        }
    }

    Ok(())
}

pub async fn shutdown_signal() {
    // Always wait for Ctrl+C
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!("Failed to install Ctrl+C handler: {e}");
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        // Try to install SIGTERM handler, but don't panic if it fails
        let terminate = async {
            if let Ok(mut sigterm) = signal(SignalKind::terminate()) {
                sigterm.recv().await;
            } else {
                tracing::error!("Failed to install SIGTERM handler");
                // Fallback: never resolves
                std::future::pending::<()>().await;
            }
        };

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
    }

    #[cfg(not(unix))]
    {
        // Only ctrl_c is available, so just await it
        ctrl_c.await;
    }
}

pub async fn perform_cleanup_actions(deployment: &DeploymentImpl) {
    deployment
        .container()
        .kill_all_running_processes()
        .await
        .expect("Failed to cleanly kill running execution processes");
}
