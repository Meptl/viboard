use std::{collections::HashMap, sync::Arc};

use anyhow::Error as AnyhowError;
use async_trait::async_trait;
use axum::response::sse::Event;
use db::{
    DBService,
    models::{
        project::{CreateProject, Project},
        task_attempt::TaskAttemptError,
    },
};
use executors::{executors::ExecutorError, profile::ExecutorConfigs};
use futures::{StreamExt, TryStreamExt};
use git2::Error as Git2Error;
use services::services::{
    approvals::Approvals,
    config::{Config, ConfigError, load_config_from_file, save_config_to_file},
    container::{ContainerError, ContainerService},
    events::{EventError, EventService},
    file_search_cache::FileSearchCache,
    filesystem::{FilesystemError, FilesystemService},
    filesystem_watcher::FilesystemWatcherError,
    git::{GitService, GitServiceError},
    image::{ImageError, ImageService},
    queued_message::QueuedMessageService,
    worktree_manager::WorktreeError,
};
use sqlx::{Error as SqlxError, types::Uuid};
use thiserror::Error;
use tokio::sync::RwLock;
use utils::{assets::config_path, msg_store::MsgStore};

use crate::container::LocalContainerService;
mod command;
pub mod container;
mod copy;

#[derive(Debug, Error)]
pub enum DeploymentError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] SqlxError),
    #[error(transparent)]
    Git2(#[from] Git2Error),
    #[error(transparent)]
    GitServiceError(#[from] GitServiceError),
    #[error(transparent)]
    FilesystemWatcherError(#[from] FilesystemWatcherError),
    #[error(transparent)]
    TaskAttempt(#[from] TaskAttemptError),
    #[error(transparent)]
    Container(#[from] ContainerError),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error(transparent)]
    Image(#[from] ImageError),
    #[error(transparent)]
    Filesystem(#[from] FilesystemError),
    #[error(transparent)]
    Worktree(#[from] WorktreeError),
    #[error(transparent)]
    Event(#[from] EventError),
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Other(#[from] AnyhowError),
}

#[async_trait]
pub trait Deployment: Clone + Send + Sync + 'static {
    async fn new() -> Result<Self, DeploymentError>;

    fn user_id(&self) -> &str;

    fn config(&self) -> &Arc<RwLock<Config>>;

    fn db(&self) -> &DBService;

    fn container(&self) -> &impl ContainerService;

    fn git(&self) -> &GitService;

    fn image(&self) -> &ImageService;

    fn filesystem(&self) -> &FilesystemService;

    fn events(&self) -> &EventService;

    fn file_search_cache(&self) -> &Arc<FileSearchCache>;

    fn approvals(&self) -> &Approvals;

    fn queued_message_service(&self) -> &QueuedMessageService;

    async fn trigger_auto_project_setup(&self) {
        let soft_timeout_ms = 2_000;
        let hard_timeout_ms = 2_300;
        let project_count = Project::count(&self.db().pool).await.unwrap_or(0);

        if project_count == 0
            && let Ok(repos) = self
                .filesystem()
                .list_common_git_repos(soft_timeout_ms, hard_timeout_ms, Some(4))
                .await
        {
            for repo in repos.into_iter().take(3) {
                let create_data = CreateProject {
                    name: repo.name,
                    git_repo_path: repo.path.to_string_lossy().to_string(),
                    use_existing_repo: true,
                    setup_script: None,
                    dev_script: None,
                    cleanup_script: None,
                    copy_files: None,
                    parallel_setup_script: None,
                };

                if let Err(e) = self.git().ensure_main_branch_exists(&repo.path) {
                    tracing::error!("Failed to ensure main branch exists: {}", e);
                    continue;
                }

                let project_id = Uuid::new_v4();
                match Project::create(&self.db().pool, &create_data, project_id).await {
                    Ok(_) => {
                        tracing::info!(
                            "Auto-created project '{}' from {}",
                            create_data.name,
                            create_data.git_repo_path
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to auto-create project '{}': {}",
                            create_data.name,
                            e
                        );
                    }
                }
            }
        }
    }

    async fn stream_events(
        &self,
    ) -> futures::stream::BoxStream<'static, Result<Event, std::io::Error>> {
        self.events()
            .msg_store()
            .history_plus_stream()
            .map_ok(|m| m.to_sse_event())
            .boxed()
    }
}

#[derive(Clone)]
pub struct LocalDeployment {
    config: Arc<RwLock<Config>>,
    user_id: String,
    db: DBService,
    container: LocalContainerService,
    git: GitService,
    image: ImageService,
    filesystem: FilesystemService,
    events: EventService,
    file_search_cache: Arc<FileSearchCache>,
    approvals: Approvals,
    queued_message_service: QueuedMessageService,
}

#[async_trait]
impl Deployment for LocalDeployment {
    async fn new() -> Result<Self, DeploymentError> {
        let mut raw_config = load_config_from_file(&config_path()).await;

        let profiles = ExecutorConfigs::get_cached();
        if !raw_config.onboarding_acknowledged
            && let Ok(recommended_executor) = profiles.get_recommended_executor_profile().await
        {
            raw_config.executor_profile = recommended_executor;
        }

        // Check if app version has changed and set release notes flag
        {
            let current_version = utils::version::APP_VERSION;
            let stored_version = raw_config.last_app_version.as_deref();

            if stored_version != Some(current_version) {
                // Show release notes only if this is an upgrade (not first install)
                raw_config.show_release_notes = stored_version.is_some();
                raw_config.last_app_version = Some(current_version.to_string());
            }
        }

        // Always save config (may have been migrated or version updated)
        save_config_to_file(&raw_config, &config_path()).await?;

        let config = Arc::new(RwLock::new(raw_config));
        let user_id = Uuid::new_v4().to_string();
        let git = GitService::new();
        let msg_stores = Arc::new(RwLock::new(HashMap::new()));
        let filesystem = FilesystemService::new();

        // Create shared components for EventService
        let events_msg_store = Arc::new(MsgStore::new());
        let events_entry_count = Arc::new(RwLock::new(0));

        // Create DB with event hooks
        let db = {
            let hook = EventService::create_hook(
                events_msg_store.clone(),
                events_entry_count.clone(),
                DBService::new().await?, // Temporary DB service for the hook
            );
            DBService::new_with_after_connect(hook).await?
        };

        let image = ImageService::new(db.clone().pool)?;
        {
            let image_service = image.clone();
            tokio::spawn(async move {
                tracing::info!("Starting orphaned image cleanup...");
                if let Err(e) = image_service.delete_orphaned_images().await {
                    tracing::error!("Failed to clean up orphaned images: {}", e);
                }
            });
        }

        let approvals = Approvals::new(msg_stores.clone());
        let queued_message_service = QueuedMessageService::new();

        let container = LocalContainerService::new(
            db.clone(),
            msg_stores.clone(),
            config.clone(),
            git.clone(),
            image.clone(),
            approvals.clone(),
            queued_message_service.clone(),
        )
        .await;

        let events = EventService::new(db.clone(), events_msg_store, events_entry_count);

        let file_search_cache = Arc::new(FileSearchCache::new());

        let deployment = Self {
            config,
            user_id,
            db,
            container,
            git,
            image,
            filesystem,
            events,
            file_search_cache,
            approvals,
            queued_message_service,
        };

        Ok(deployment)
    }

    fn user_id(&self) -> &str {
        &self.user_id
    }

    fn config(&self) -> &Arc<RwLock<Config>> {
        &self.config
    }

    fn db(&self) -> &DBService {
        &self.db
    }

    fn container(&self) -> &impl ContainerService {
        &self.container
    }

    fn git(&self) -> &GitService {
        &self.git
    }

    fn image(&self) -> &ImageService {
        &self.image
    }

    fn filesystem(&self) -> &FilesystemService {
        &self.filesystem
    }

    fn events(&self) -> &EventService {
        &self.events
    }

    fn file_search_cache(&self) -> &Arc<FileSearchCache> {
        &self.file_search_cache
    }

    fn approvals(&self) -> &Approvals {
        &self.approvals
    }

    fn queued_message_service(&self) -> &QueuedMessageService {
        &self.queued_message_service
    }
}
