use std::sync::{Arc, OnceLock};

use tokio::sync::RwLock;
use utils;

use crate::services::config::{Config, NotificationConfig, SoundFile};

/// Service for handling cross-platform notifications including sound alerts and push notifications
#[derive(Debug, Clone)]
pub struct NotificationService {
    config: Arc<RwLock<Config>>,
}

/// Cache for WSL root path from PowerShell
static WSL_ROOT_PATH_CACHE: OnceLock<Option<String>> = OnceLock::new();

impl NotificationService {
    pub fn new(config: Arc<RwLock<Config>>) -> Self {
        Self { config }
    }

    /// Send both sound and push notifications if enabled
    pub async fn notify(&self, title: &str, message: &str) {
        self.notify_with_url(title, message, None).await;
    }

    /// Send both sound and push notifications if enabled, with optional source URL
    pub async fn notify_with_url(&self, title: &str, message: &str, url: Option<&str>) {
        let config = self.config.read().await.notifications.clone();
        Self::send_notification(&config, title, message, url).await;
    }

    /// Internal method to send notifications with a given config
    async fn send_notification(
        config: &NotificationConfig,
        title: &str,
        message: &str,
        url: Option<&str>,
    ) {
        if config.sound_enabled {
            Self::play_sound_notification(&config.sound_file).await;
        }

        if config.system_enabled {
            Self::send_push_notification(title, message, url).await;
        }
    }

    pub fn frontend_base_url() -> String {
        let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let host = match host.as_str() {
            "0.0.0.0" | "::" => "127.0.0.1",
            _ => host.as_str(),
        };
        let port = std::env::var("FRONTEND_PORT").unwrap_or_else(|_| "3000".to_string());
        format!("http://{host}:{port}")
    }

    pub fn attempt_url(
        project_id: uuid::Uuid,
        task_id: uuid::Uuid,
        attempt_id: uuid::Uuid,
    ) -> String {
        format!(
            "{}/projects/{}/tasks/{}/attempts/{}",
            Self::frontend_base_url(),
            project_id,
            task_id,
            attempt_id
        )
    }

    fn message_with_url(message: &str, url: Option<&str>) -> String {
        let _ = url;
        message.to_string()
    }

    /// Play a system sound notification across platforms
    async fn play_sound_notification(sound_file: &SoundFile) {
        let file_path = match sound_file.get_path().await {
            Ok(path) => path,
            Err(e) => {
                tracing::error!("Failed to create cached sound file: {}", e);
                return;
            }
        };

        // Use platform-specific sound notification
        // Note: spawn() calls are intentionally not awaited - sound notifications should be fire-and-forget
        if cfg!(target_os = "macos") {
            let _ = tokio::process::Command::new("afplay")
                .arg(&file_path)
                .spawn();
        } else if cfg!(target_os = "linux") && !utils::is_wsl2() {
            // Try different Linux audio players
            if tokio::process::Command::new("paplay")
                .arg(&file_path)
                .spawn()
                .is_ok()
            {
                // Success with paplay
            } else if tokio::process::Command::new("aplay")
                .arg(&file_path)
                .spawn()
                .is_ok()
            {
                // Success with aplay
            } else {
                // Try system bell as fallback
                let _ = tokio::process::Command::new("echo")
                    .arg("-e")
                    .arg("\\a")
                    .spawn();
            }
        } else if cfg!(target_os = "windows") || (cfg!(target_os = "linux") && utils::is_wsl2()) {
            // Convert WSL path to Windows path if in WSL2
            let file_path = if utils::is_wsl2() {
                if let Some(windows_path) = Self::wsl_to_windows_path(&file_path).await {
                    windows_path
                } else {
                    file_path.to_string_lossy().to_string()
                }
            } else {
                file_path.to_string_lossy().to_string()
            };

            let _ = tokio::process::Command::new("powershell.exe")
                .arg("-c")
                .arg(format!(
                    r#"(New-Object Media.SoundPlayer "{file_path}").PlaySync()"#
                ))
                .spawn();
        }
    }

    /// Send a cross-platform push notification
    async fn send_push_notification(title: &str, message: &str, url: Option<&str>) {
        if cfg!(target_os = "macos") {
            Self::send_macos_notification(title, message, url).await;
        } else if cfg!(target_os = "linux") && !utils::is_wsl2() {
            Self::send_linux_notification(title, message, url).await;
        } else if cfg!(target_os = "windows") || (cfg!(target_os = "linux") && utils::is_wsl2()) {
            Self::send_windows_notification(title, message, url).await;
        }
    }

    /// Send macOS notification using osascript
    async fn send_macos_notification(title: &str, message: &str, url: Option<&str>) {
        let message = Self::message_with_url(message, url);
        let script = format!(
            r#"display notification "{message}" with title "{title}" sound name "Glass""#,
            message = message.replace('"', r#"\""#),
            title = title.replace('"', r#"\""#)
        );

        let _ = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .spawn();
    }

    /// Send Linux notification using notify-rust
    #[cfg(target_os = "linux")]
    async fn send_linux_notification(title: &str, message: &str, url: Option<&str>) {
        use notify_rust::Notification;

        let title = title.to_string();
        let message = Self::message_with_url(message, url);
        let url = url.map(ToOwned::to_owned);

        let _handle = tokio::task::spawn_blocking(move || {
            let mut notification = Notification::new();
            notification
                .appname("vibe-kanban")
                .summary(&title)
                .timeout(10000);
            if !message.is_empty() {
                notification.body(&message);
            }

            if let Some(url) = url {
                notification.action("open", "Open");

                match notification.show() {
                    Ok(handle) => {
                        handle.wait_for_action(|action| {
                            if action == "open" {
                                let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
                            }
                        });
                    }
                    Err(e) => {
                        tracing::error!("Failed to send Linux notification: {}", e);
                    }
                }
            } else if let Err(e) = notification.show() {
                tracing::error!("Failed to send Linux notification: {}", e);
            }
        });
        drop(_handle); // Don't await, fire-and-forget
    }

    /// No-op Linux notification stub for non-Linux targets to keep cross-platform builds compiling.
    #[cfg(not(target_os = "linux"))]
    async fn send_linux_notification(_title: &str, _message: &str, _url: Option<&str>) {}

    /// Send Windows/WSL notification using PowerShell toast script
    async fn send_windows_notification(title: &str, message: &str, url: Option<&str>) {
        let script_path = match utils::get_powershell_script().await {
            Ok(path) => path,
            Err(e) => {
                tracing::error!("Failed to get PowerShell script: {}", e);
                return;
            }
        };

        // Convert WSL path to Windows path if in WSL2
        let script_path_str = if utils::is_wsl2() {
            if let Some(windows_path) = Self::wsl_to_windows_path(&script_path).await {
                windows_path
            } else {
                script_path.to_string_lossy().to_string()
            }
        } else {
            script_path.to_string_lossy().to_string()
        };

        let _ = tokio::process::Command::new("powershell.exe")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(script_path_str)
            .arg("-Title")
            .arg(title)
            .arg("-Message")
            .arg(message)
            .args(
                url.into_iter()
                    .flat_map(|value| ["-Url", value])
                    .collect::<Vec<_>>(),
            )
            .spawn();
    }

    /// Get WSL root path via PowerShell (cached)
    async fn get_wsl_root_path() -> Option<String> {
        if let Some(cached) = WSL_ROOT_PATH_CACHE.get() {
            return cached.clone();
        }

        match tokio::process::Command::new("powershell.exe")
            .arg("-c")
            .arg("(Get-Location).Path -replace '^.*::', ''")
            .current_dir("/")
            .output()
            .await
        {
            Ok(output) => {
                match String::from_utf8(output.stdout) {
                    Ok(pwd_str) => {
                        let pwd = pwd_str.trim();
                        tracing::info!("WSL root path detected: {}", pwd);

                        // Cache the result
                        let _ = WSL_ROOT_PATH_CACHE.set(Some(pwd.to_string()));
                        return Some(pwd.to_string());
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse PowerShell pwd output as UTF-8: {}", e);
                    }
                }
            }
            Err(e) => {
                tracing::error!("Failed to execute PowerShell pwd command: {}", e);
            }
        }

        // Cache the failure result
        let _ = WSL_ROOT_PATH_CACHE.set(None);
        None
    }

    /// Convert WSL path to Windows UNC path for PowerShell
    async fn wsl_to_windows_path(wsl_path: &std::path::Path) -> Option<String> {
        let path_str = wsl_path.to_string_lossy();

        // Relative paths work fine as-is in PowerShell
        if !path_str.starts_with('/') {
            tracing::debug!("Using relative path as-is: {}", path_str);
            return Some(path_str.to_string());
        }

        // Get cached WSL root path from PowerShell
        if let Some(wsl_root) = Self::get_wsl_root_path().await {
            // Simply concatenate WSL root with the absolute path - PowerShell doesn't mind /
            let windows_path = format!("{wsl_root}{path_str}");
            tracing::debug!("WSL path converted: {} -> {}", path_str, windows_path);
            Some(windows_path)
        } else {
            tracing::error!(
                "Failed to determine WSL root path for conversion: {}",
                path_str
            );
            None
        }
    }
}
