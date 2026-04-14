use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, put},
};
use chrono::Utc;
use db::models::tag::{CreateTag, Tag, UpdateTag};
use local_deployment::Deployment;
use serde::Deserialize;
use services::services::config::save_config_to_file;
use ts_rs::TS;
use utils::{assets::config_path, response::ApiResponse};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Deserialize, TS)]
pub struct TagSearchParams {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub include_global: Option<bool>,
}

fn collect_project_local_tags_from_config(
    deployment_config: &services::services::config::Config,
    project_id: Uuid,
) -> Vec<Tag> {
    deployment_config
        .project_local_tags
        .get(&project_id.to_string())
        .into_iter()
        .flatten()
        .cloned()
        .map(|mut tag| {
            tag.project_id = Some(project_id);
            tag
        })
        .collect()
}

pub async fn get_tags(
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<TagSearchParams>,
) -> Result<ResponseJson<ApiResponse<Vec<Tag>>>, ApiError> {
    let mut tags = if let Some(project_id) = params.project_id {
        let mut merged_tags = {
            let config = deployment.config().read().await;
            collect_project_local_tags_from_config(&config, project_id)
        };

        if params.include_global.unwrap_or(false) {
            let mut global_tags = Tag::find_for_project(&deployment.db().pool, None, false).await?;
            merged_tags.append(&mut global_tags);
        }

        merged_tags
    } else {
        Tag::find_for_project(
            &deployment.db().pool,
            params.project_id,
            params.include_global.unwrap_or(false),
        )
        .await?
    };

    if let Some(search_query) = params.search {
        let search_lower = search_query.to_lowercase();
        tags.retain(|tag| tag.tag_name.to_lowercase().contains(&search_lower));
    }

    Ok(ResponseJson(ApiResponse::success(tags)))
}

pub async fn create_tag(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTag>,
) -> Result<ResponseJson<ApiResponse<Tag>>, ApiError> {
    if let Some(project_id) = payload.project_id {
        let now = Utc::now();
        let local_tag = Tag {
            id: Uuid::new_v4(),
            project_id: Some(project_id),
            tag_name: payload.tag_name,
            content: payload.content,
            created_at: now,
            updated_at: now,
        };

        let mut config = deployment.config().write().await;
        config
            .project_local_tags
            .entry(project_id.to_string())
            .or_default()
            .push(local_tag.clone());
        save_config_to_file(&config, &config_path()).await?;

        return Ok(ResponseJson(ApiResponse::success(local_tag)));
    }

    let tag = Tag::create(&deployment.db().pool, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(tag)))
}

pub async fn update_tag(
    Path(tag_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateTag>,
) -> Result<ResponseJson<ApiResponse<Tag>>, ApiError> {
    {
        let mut config = deployment.config().write().await;
        for (project_id, tags) in &mut config.project_local_tags {
            if let Some(local_tag) = tags.iter_mut().find(|tag| tag.id == tag_id) {
                if let Some(tag_name) = payload.tag_name.as_ref() {
                    local_tag.tag_name = tag_name.clone();
                }
                if let Some(content) = payload.content.as_ref() {
                    local_tag.content = content.clone();
                }
                local_tag.updated_at = Utc::now();

                let project_id = Uuid::parse_str(project_id).map_err(|error| {
                    ApiError::BadRequest(format!(
                        "Invalid project id found in config for local tags: {}",
                        error
                    ))
                })?;
                local_tag.project_id = Some(project_id);
                let updated_tag = local_tag.clone();
                save_config_to_file(&config, &config_path()).await?;

                return Ok(ResponseJson(ApiResponse::success(updated_tag)));
            }
        }
    }

    let updated_tag = Tag::update(&deployment.db().pool, tag_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(updated_tag)))
}

pub async fn delete_tag(
    Path(tag_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    {
        let mut config = deployment.config().write().await;
        let mut found = false;

        for tags in config.project_local_tags.values_mut() {
            let before = tags.len();
            tags.retain(|tag| tag.id != tag_id);
            if tags.len() != before {
                found = true;
                break;
            }
        }

        if found {
            config.project_local_tags.retain(|_, tags| !tags.is_empty());
            save_config_to_file(&config, &config_path()).await?;
            return Ok(ResponseJson(ApiResponse::success(())));
        }
    }

    let rows_affected = Tag::delete(&deployment.db().pool, tag_id).await?;
    if rows_affected == 0 {
        Err(ApiError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

pub fn router(_deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let inner = Router::new()
        .route("/", get(get_tags).post(create_tag))
        .route("/{tag_id}", put(update_tag).delete(delete_tag));

    Router::new().nest("/tags", inner)
}
