use anyhow::Error;
use executors::{executors::BaseCodingAgent, profile::ExecutorProfileId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
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
pub struct Config {
    pub config_version: String,
    pub theme: ThemeMode,
    pub executor_profile: ExecutorProfileId,
    pub disclaimer_acknowledged: bool,
    pub onboarding_acknowledged: bool,
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
}

impl Config {
    fn from_v8_config(old_config: v8::Config) -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: old_config.theme,
            executor_profile: old_config.executor_profile,
            disclaimer_acknowledged: old_config.disclaimer_acknowledged,
            onboarding_acknowledged: old_config.onboarding_acknowledged,
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
            onboarding_acknowledged: false,
            notifications: NotificationConfig::default(),
            editor: EditorConfig::default(),
            workspace_dir: None,
            show_new_attempt_drag_warning: default_show_new_attempt_drag_warning(),
            language: UiLanguage::default(),
            git_branch_prefix: super::default_git_branch_prefix(),
            showcases: ShowcaseState::default(),
            done_task_cleanup_days: default_done_task_cleanup_days(),
        }
    }
}
