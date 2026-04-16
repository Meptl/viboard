use std::{path::Path, str::FromStr};

use executors::{command::CommandBuilder, executors::ExecutorError};
use serde::{Deserialize, Serialize};
use strum_macros::{EnumIter, EnumString};
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, Error)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum EditorOpenError {
    #[error("Editor executable '{executable}' not found in PATH")]
    ExecutableNotFound {
        executable: String,
        editor_type: EditorType,
    },
    #[error("Editor command for {editor_type:?} is invalid: {details}")]
    InvalidCommand {
        details: String,
        editor_type: EditorType,
    },
    #[error("Failed to launch '{executable}' for {editor_type:?}: {details}")]
    LaunchFailed {
        executable: String,
        details: String,
        editor_type: EditorType,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EditorConfig {
    editor_type: EditorType,
    custom_ide_dir_cmd: Option<String>,
    #[serde(default)]
    custom_ide_file_cmd: Option<String>,
    #[serde(default)]
    remote_ssh_host: Option<String>,
    #[serde(default)]
    remote_ssh_user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, EnumString, EnumIter)]
#[ts(use_ts_enum)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum EditorType {
    VsCode,
    Cursor,
    Windsurf,
    IntelliJ,
    Zed,
    Xcode,
    Custom,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            editor_type: EditorType::VsCode,
            custom_ide_dir_cmd: None,
            custom_ide_file_cmd: None,
            remote_ssh_host: None,
            remote_ssh_user: None,
        }
    }
}

impl EditorConfig {
    /// Create a new EditorConfig. This is primarily used by version migrations.
    pub fn new(
        editor_type: EditorType,
        custom_ide_dir_cmd: Option<String>,
        remote_ssh_host: Option<String>,
        remote_ssh_user: Option<String>,
    ) -> Self {
        Self {
            editor_type,
            custom_ide_dir_cmd,
            custom_ide_file_cmd: None,
            remote_ssh_host,
            remote_ssh_user,
        }
    }

    pub fn get_command(&self, is_file_open: bool) -> CommandBuilder {
        let base_command = match &self.editor_type {
            EditorType::VsCode => "code",
            EditorType::Cursor => "cursor",
            EditorType::Windsurf => "windsurf",
            EditorType::IntelliJ => "idea",
            EditorType::Zed => "zed",
            EditorType::Xcode => "xed",
            EditorType::Custom => {
                // Custom editor - workspace and file opens can use separate commands.
                let custom_command = if is_file_open {
                    self.custom_ide_file_cmd
                        .as_deref()
                        .or(self.custom_ide_dir_cmd.as_deref())
                } else {
                    self.custom_ide_dir_cmd.as_deref()
                };
                custom_command.unwrap_or("code")
            }
        };
        CommandBuilder::new(base_command)
    }

    /// Resolve the editor command to an executable path and args.
    /// This is shared logic used by both check_availability() and spawn_local().
    async fn resolve_command(
        &self,
        is_file_open: bool,
    ) -> Result<(std::path::PathBuf, Vec<String>), EditorOpenError> {
        let command_builder = self.get_command(is_file_open);
        let command_parts =
            command_builder
                .build_initial()
                .map_err(|e| EditorOpenError::InvalidCommand {
                    details: e.to_string(),
                    editor_type: self.editor_type.clone(),
                })?;

        let (executable, args) = command_parts.into_resolved().await.map_err(|e| match e {
            ExecutorError::ExecutableNotFound { program } => EditorOpenError::ExecutableNotFound {
                executable: program,
                editor_type: self.editor_type.clone(),
            },
            _ => EditorOpenError::InvalidCommand {
                details: e.to_string(),
                editor_type: self.editor_type.clone(),
            },
        })?;

        Ok((executable, args))
    }

    /// Check if the editor is available on the system.
    /// Uses the same command resolution logic as spawn_local().
    pub async fn check_availability(&self) -> bool {
        self.resolve_command(false).await.is_ok()
    }

    pub async fn open_file(
        &self,
        repo_root: &Path,
        file_path: Option<&Path>,
    ) -> Result<Option<String>, EditorOpenError> {
        let is_file_open = file_path.is_some();
        let target_path = file_path.unwrap_or(repo_root);
        if let Some(url) = self.remote_url(target_path) {
            return Ok(Some(url));
        }
        self.spawn_local(repo_root, target_path, is_file_open)
            .await?;
        Ok(None)
    }

    fn remote_url(&self, path: &Path) -> Option<String> {
        let remote_host = self.remote_ssh_host.as_ref()?;
        let scheme = match self.editor_type {
            EditorType::VsCode => "vscode",
            EditorType::Cursor => "cursor",
            EditorType::Windsurf => "windsurf",
            _ => return None,
        };
        let user_part = self
            .remote_ssh_user
            .as_ref()
            .map(|u| format!("{u}@"))
            .unwrap_or_default();
        // files must contain a line and column number
        let line_col = if path.is_file() { ":1:1" } else { "" };
        let path = path.to_string_lossy();
        Some(format!(
            "{scheme}://vscode-remote/ssh-remote+{user_part}{remote_host}{path}{line_col}"
        ))
    }

    pub async fn spawn_local(
        &self,
        repo_root: &Path,
        target_path: &Path,
        is_file_open: bool,
    ) -> Result<(), EditorOpenError> {
        let (executable, mut args) = self.resolve_command(is_file_open).await?;
        let has_path_placeholder = self.custom_command_has_any_placeholder(is_file_open);
        self.apply_custom_placeholders(&mut args, repo_root, target_path);

        let mut cmd = std::process::Command::new(&executable);
        cmd.args(&args);
        if !has_path_placeholder {
            cmd.arg(target_path);
        }
        cmd.spawn().map_err(|e| EditorOpenError::LaunchFailed {
            executable: executable.to_string_lossy().into_owned(),
            details: e.to_string(),
            editor_type: self.editor_type.clone(),
        })?;
        Ok(())
    }

    fn custom_command_has_any_placeholder(&self, is_file_open: bool) -> bool {
        if !matches!(self.editor_type, EditorType::Custom) {
            return false;
        }
        let custom_command = if is_file_open {
            self.custom_ide_file_cmd
                .as_deref()
                .or(self.custom_ide_dir_cmd.as_deref())
        } else {
            self.custom_ide_dir_cmd.as_deref()
        };
        custom_command.is_some_and(|cmd| cmd.contains("%repo_root%") || cmd.contains("%file%"))
    }

    fn apply_custom_placeholders(&self, args: &mut [String], repo_root: &Path, target_path: &Path) {
        if !matches!(self.editor_type, EditorType::Custom) {
            return;
        }

        let repo_root = repo_root.to_string_lossy();
        let target_path = target_path.to_string_lossy();
        for arg in args.iter_mut() {
            if arg.contains("%repo_root%") {
                *arg = arg.replace("%repo_root%", repo_root.as_ref());
            }
            if arg.contains("%file%") {
                *arg = arg.replace("%file%", target_path.as_ref());
            }
        }
    }

    pub fn with_override(&self, editor_type_str: Option<&str>) -> Self {
        if let Some(editor_type_str) = editor_type_str {
            let editor_type =
                EditorType::from_str(editor_type_str).unwrap_or(self.editor_type.clone());
            EditorConfig {
                editor_type,
                custom_ide_dir_cmd: self.custom_ide_dir_cmd.clone(),
                custom_ide_file_cmd: self.custom_ide_file_cmd.clone(),
                remote_ssh_host: self.remote_ssh_host.clone(),
                remote_ssh_user: self.remote_ssh_user.clone(),
            }
        } else {
            self.clone()
        }
    }
}
