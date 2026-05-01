use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Error;
use db::models::tag::Tag;
use executors::{executors::BaseCodingAgent, profile::ExecutorProfileId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;
pub use v8::{EditorConfig, EditorType, ShowcaseState, SoundFile, ThemeMode, UiLanguage};

use crate::services::config::versions::v8;

fn default_badge_enabled() -> bool {
    true
}

fn default_toast_enabled() -> bool {
    true
}

fn default_show_new_attempt_drag_warning() -> bool {
    true
}

fn default_done_task_cleanup_days() -> u32 {
    0
}

fn default_task_title_prompt() -> Option<String> {
    None
}

fn default_task_description_prompt() -> Option<String> {
    None
}

fn default_openclaw_settings() -> OpenClawSettings {
    detect_openclaw_settings()
}

const OPENCLAW_DEFAULT_GATEWAY_URL: &str = "http://127.0.0.1:18789";

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct NotificationConfig {
    pub sound_enabled: bool,
    #[serde(alias = "push_enabled")]
    pub system_enabled: bool,
    #[serde(default = "default_badge_enabled")]
    pub badge_enabled: bool,
    #[serde(default = "default_toast_enabled")]
    pub toast_enabled: bool,
    pub sound_file: SoundFile,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            system_enabled: true,
            badge_enabled: default_badge_enabled(),
            toast_enabled: default_toast_enabled(),
            sound_file: SoundFile::AbstractSound4,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct OpenClawSettings {
    pub gateway_url: String,
    pub gateway_key: String,
}

impl Default for OpenClawSettings {
    fn default() -> Self {
        default_openclaw_settings()
    }
}

fn detect_openclaw_settings() -> OpenClawSettings {
    let mut settings = OpenClawSettings {
        gateway_url: OPENCLAW_DEFAULT_GATEWAY_URL.to_string(),
        gateway_key: String::new(),
    };

    if let Some(systemd_token) = read_openclaw_token_from_systemd() {
        settings.gateway_key = systemd_token;
    }

    let Some(home_dir) = std::env::var_os("HOME").map(PathBuf::from) else {
        return settings;
    };
    let openclaw_config_path = home_dir.join(".openclaw").join("openclaw.json");
    let Ok(raw_config) = fs::read_to_string(openclaw_config_path) else {
        return settings;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw_config) else {
        return settings;
    };

    if let Some(port) = parsed
        .get("gateway")
        .and_then(|gateway| gateway.get("port"))
        .and_then(serde_json::Value::as_u64)
    {
        settings.gateway_url = format!("http://127.0.0.1:{port}");
    }

    if settings.gateway_key.is_empty()
        && let Some(config_token) = parsed
            .get("gateway")
            .and_then(|gateway| gateway.get("auth"))
            .and_then(|auth| auth.get("token"))
            .and_then(serde_json::Value::as_str)
    {
        settings.gateway_key = config_token.to_string();
    }

    settings
}

fn read_openclaw_token_from_systemd() -> Option<String> {
    let home_dir = std::env::var_os("HOME").map(PathBuf::from)?;
    let service_paths = [
        home_dir.join(".config/systemd/user/openclaw-gateway.service"),
        PathBuf::from("/etc/systemd/system/openclaw-gateway.service"),
    ];

    for service_path in service_paths {
        if let Some(token) = read_openclaw_token_line(&service_path) {
            return Some(token);
        }
    }

    None
}

fn read_openclaw_token_line(service_path: &Path) -> Option<String> {
    let service_content = fs::read_to_string(service_path).ok()?;
    let (_, suffix) = service_content.split_once("OPENCLAW_GATEWAY_TOKEN=")?;
    let token = suffix.split_whitespace().next()?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct Config {
    pub config_version: String,
    pub theme: ThemeMode,
    pub executor_profile: ExecutorProfileId,
    pub disclaimer_acknowledged: bool,
    pub notifications: NotificationConfig,
    pub editor: EditorConfig,
    pub workspace_dir: Option<String>,
    #[serde(default = "default_show_new_attempt_drag_warning")]
    pub show_new_attempt_drag_warning: bool,
    #[serde(default)]
    pub language: UiLanguage,
    #[serde(default = "super::default_git_branch_prefix")]
    pub git_branch_prefix: String,
    #[serde(default)]
    pub showcases: ShowcaseState,
    #[serde(default = "default_done_task_cleanup_days")]
    pub done_task_cleanup_days: u32,
    #[serde(default)]
    pub automatic_done_task_cleanup_days_by_project: HashMap<String, u32>,
    #[serde(default = "default_task_title_prompt")]
    pub task_title_prompt: Option<String>,
    #[serde(default = "default_task_description_prompt")]
    pub task_description_prompt: Option<String>,
    #[serde(default = "default_openclaw_settings")]
    pub openclaw: OpenClawSettings,
    #[serde(default)]
    pub project_local_tags: HashMap<String, Vec<Tag>>,
    #[serde(default)]
    pub project_settings: HashMap<String, ProjectSettings>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
pub struct ProjectSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dev_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copy_files: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub parallel_setup_script: bool,
}

impl ProjectSettings {
    pub fn from_scripts(
        setup_script: Option<String>,
        dev_script: Option<String>,
        cleanup_script: Option<String>,
        copy_files: Option<String>,
        parallel_setup_script: bool,
    ) -> Self {
        Self {
            setup_script,
            dev_script,
            cleanup_script,
            copy_files,
            parallel_setup_script,
        }
    }
}

impl Config {
    pub fn project_settings(&self, project_id: Uuid) -> ProjectSettings {
        self.project_settings
            .get(&project_id.to_string())
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_project_settings(&mut self, project_id: Uuid, settings: ProjectSettings) {
        self.project_settings
            .insert(project_id.to_string(), settings);
    }

    fn from_v8_config(old_config: v8::Config) -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: old_config.theme,
            executor_profile: old_config.executor_profile,
            disclaimer_acknowledged: old_config.disclaimer_acknowledged,
            notifications: NotificationConfig {
                sound_enabled: old_config.notifications.sound_enabled,
                system_enabled: old_config.notifications.push_enabled,
                badge_enabled: default_badge_enabled(),
                toast_enabled: default_toast_enabled(),
                sound_file: old_config.notifications.sound_file,
            },
            editor: old_config.editor,
            workspace_dir: old_config.workspace_dir,
            show_new_attempt_drag_warning: default_show_new_attempt_drag_warning(),
            language: old_config.language,
            git_branch_prefix: old_config.git_branch_prefix,
            showcases: old_config.showcases,
            done_task_cleanup_days: default_done_task_cleanup_days(),
            automatic_done_task_cleanup_days_by_project: HashMap::new(),
            task_title_prompt: default_task_title_prompt(),
            task_description_prompt: default_task_description_prompt(),
            openclaw: default_openclaw_settings(),
            project_local_tags: HashMap::new(),
            project_settings: HashMap::new(),
        }
    }

    pub fn from_previous_version(raw_config: &str) -> Result<Self, Error> {
        let old_config = v8::Config::from(raw_config.to_string());
        Ok(Self::from_v8_config(old_config))
    }
}

impl From<String> for Config {
    fn from(raw_config: String) -> Self {
        if let Ok(config) = serde_json::from_str::<Config>(&raw_config)
            && config.config_version == "v9"
        {
            if config.openclaw.gateway_url.trim().is_empty() {
                let mut with_discovery = config;
                with_discovery.openclaw = default_openclaw_settings();
                return with_discovery;
            }
            return config;
        }

        match Self::from_previous_version(&raw_config) {
            Ok(config) => {
                tracing::info!("Config upgraded to v9");
                config
            }
            Err(e) => {
                tracing::warn!("Config migration failed: {}, using default", e);
                Self::default()
            }
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: ThemeMode::System,
            executor_profile: ExecutorProfileId::new(BaseCodingAgent::ClaudeCode),
            disclaimer_acknowledged: false,
            notifications: NotificationConfig::default(),
            editor: EditorConfig::default(),
            workspace_dir: None,
            show_new_attempt_drag_warning: default_show_new_attempt_drag_warning(),
            language: UiLanguage::default(),
            git_branch_prefix: super::default_git_branch_prefix(),
            showcases: ShowcaseState::default(),
            done_task_cleanup_days: default_done_task_cleanup_days(),
            automatic_done_task_cleanup_days_by_project: HashMap::new(),
            task_title_prompt: default_task_title_prompt(),
            task_description_prompt: default_task_description_prompt(),
            openclaw: default_openclaw_settings(),
            project_local_tags: HashMap::new(),
            project_settings: HashMap::new(),
        }
    }
}
