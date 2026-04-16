use std::path::Path as StdPath;

use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{get, post},
};
use db::models::{
    project::{CreateProject, Project, ProjectError, SearchResult, UpdateProject},
    task::Task,
};
use ignore::WalkBuilder;
use local_deployment::Deployment;
use services::services::{
    file_search_cache::{
        CacheError, SETTINGS_FUZZY_SCORE_THRESHOLD, SETTINGS_MAX_RESULTS, SearchMode, SearchQuery,
        TASK_FORM_FUZZY_SCORE_THRESHOLD, TASK_FORM_MAX_RESULTS, fuzzy_file_score,
    },
    git::GitBranch,
};
use utils::{path::expand_tilde, response::ApiResponse};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_project_middleware};

pub async fn get_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let projects = Project::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

pub async fn get_project(
    Extension(project): Extension<Project>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(project)))
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
            setup_script,
            dev_script,
            cleanup_script,
            copy_files,
            parallel_setup_script,
        },
        id,
    )
    .await
    {
        Ok(project) => {
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
        setup_script,
        dev_script,
        cleanup_script,
        copy_files,
        parallel_setup_script.unwrap_or(existing_project.parallel_setup_script),
    )
    .await
    {
        Ok(project) => Ok(ResponseJson(ApiResponse::success(project))),
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
