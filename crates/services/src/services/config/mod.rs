use std::path::PathBuf;

use serde_json::{Map, Value};
use thiserror::Error;
use utils::assets::{global_config_path, project_local_config_path};

pub mod editor;
mod versions;

pub use editor::EditorOpenError;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("Validation error: {0}")]
    ValidationError(String),
}

pub type Config = versions::v9::Config;
pub type NotificationConfig = versions::v9::NotificationConfig;
pub type EditorConfig = versions::v9::EditorConfig;
pub type ThemeMode = versions::v9::ThemeMode;
pub type SoundFile = versions::v9::SoundFile;
pub type EditorType = versions::v9::EditorType;
pub type UiLanguage = versions::v9::UiLanguage;
pub type ShowcaseState = versions::v9::ShowcaseState;
pub type ProjectSettings = versions::v9::ProjectSettings;

pub fn project_local_override_paths() -> Vec<String> {
    let Some(local_path) = project_local_config_path() else {
        return Vec::new();
    };

    let Ok(raw_local_overrides) = std::fs::read_to_string(local_path) else {
        return Vec::new();
    };

    let Ok(local_overrides) = serde_json::from_str::<Value>(&raw_local_overrides) else {
        return Vec::new();
    };

    let mut paths = Vec::new();
    flatten_override_paths(&local_overrides, None, &mut paths);
    paths
}

/// Will always return config, trying old schemas or eventually returning default
pub async fn load_config_from_file(config_path: &PathBuf) -> Config {
    if is_project_local_config_path(config_path) {
        let mut config = load_config_from_single_file(&global_config_path());
        match std::fs::read_to_string(config_path) {
            Ok(raw_local_overrides) => {
                if let Ok(local_overrides) = serde_json::from_str::<Value>(&raw_local_overrides) {
                    let mut base = serde_json::to_value(&config).unwrap_or(Value::Object(Map::new()));
                    merge_json(&mut base, &local_overrides);
                    config = Config::from(base.to_string());
                } else {
                    tracing::warn!("Failed to parse project local config overrides, ignoring");
                }
            }
            Err(_) => {
                tracing::info!("No project local config overrides found, using global config");
            }
        }

        return config;
    }

    load_config_from_single_file(config_path)
}

fn load_config_from_single_file(config_path: &PathBuf) -> Config {
    match std::fs::read_to_string(config_path) {
        Ok(raw_config) => Config::from(raw_config),
        Err(_) => {
            tracing::info!("No config file found, creating one");
            Config::default()
        }
    }
}

/// Saves the config to the given path
pub async fn save_config_to_file(
    config: &Config,
    config_path: &PathBuf,
) -> Result<(), ConfigError> {
    if is_project_local_config_path(config_path) {
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let base_config = load_config_from_single_file(&global_config_path());
        let base = serde_json::to_value(&base_config)?;
        let updated = serde_json::to_value(config)?;
        let overrides = json_diff(&base, &updated).unwrap_or(Value::Object(Map::new()));
        let raw_overrides = serde_json::to_string_pretty(&overrides)?;
        std::fs::write(config_path, raw_overrides)?;
        return Ok(());
    }

    let raw_config = serde_json::to_string_pretty(config)?;
    std::fs::write(config_path, raw_config)?;
    Ok(())
}

fn is_project_local_config_path(config_path: &PathBuf) -> bool {
    project_local_config_path()
        .as_ref()
        .is_some_and(|local_path| local_path == config_path)
}

fn merge_json(base: &mut Value, overrides: &Value) {
    match (base, overrides) {
        (Value::Object(base_obj), Value::Object(override_obj)) => {
            for (key, override_value) in override_obj {
                if let Some(base_value) = base_obj.get_mut(key) {
                    merge_json(base_value, override_value);
                } else {
                    base_obj.insert(key.clone(), override_value.clone());
                }
            }
        }
        (base_value, override_value) => {
            *base_value = override_value.clone();
        }
    }
}

fn json_diff(base: &Value, updated: &Value) -> Option<Value> {
    match (base, updated) {
        (Value::Object(base_obj), Value::Object(updated_obj)) => {
            let mut diff = Map::new();
            for (key, updated_value) in updated_obj {
                if let Some(base_value) = base_obj.get(key) {
                    if let Some(changed) = json_diff(base_value, updated_value) {
                        diff.insert(key.clone(), changed);
                    }
                } else {
                    diff.insert(key.clone(), updated_value.clone());
                }
            }

            if diff.is_empty() {
                None
            } else {
                Some(Value::Object(diff))
            }
        }
        _ => {
            if base == updated {
                None
            } else {
                Some(updated.clone())
            }
        }
    }
}

fn flatten_override_paths(value: &Value, prefix: Option<&str>, out: &mut Vec<String>) {
    if let Value::Object(map) = value {
        for (key, child) in map {
            let next = match prefix {
                Some(prefix) => format!("{prefix}.{key}"),
                None => key.clone(),
            };
            out.push(next.clone());
            flatten_override_paths(child, Some(&next), out);
        }
    }
}
