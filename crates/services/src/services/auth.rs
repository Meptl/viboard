use std::sync::Arc;

use tokio::sync::{Mutex as TokioMutex, OwnedMutexGuard};
use utils::api::oauth::ProfileResponse;

use super::oauth_credentials::Credentials;

/// Stub auth context - OAuth has been removed from local deployment
#[derive(Clone)]
pub struct AuthContext;

impl AuthContext {
    pub fn new() -> Self {
        Self
    }

    pub async fn get_credentials(&self) -> Option<Credentials> {
        None
    }

    pub async fn save_credentials(&self, _creds: &Credentials) -> std::io::Result<()> {
        Ok(())
    }

    pub async fn clear_credentials(&self) -> std::io::Result<()> {
        Ok(())
    }

    pub async fn cached_profile(&self) -> Option<ProfileResponse> {
        None
    }

    pub async fn set_profile(&self, _profile: ProfileResponse) {
        // no-op
    }

    pub async fn clear_profile(&self) {
        // no-op
    }

    pub async fn refresh_guard(&self) -> OwnedMutexGuard<()> {
        Arc::new(TokioMutex::new(())).lock_owned().await
    }
}
