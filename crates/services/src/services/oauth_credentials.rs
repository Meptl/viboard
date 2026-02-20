use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};

/// Stub OAuth credentials - OAuth has been removed from local deployment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub access_token: Option<String>,
    pub refresh_token: String,
    pub expires_at: Option<DateTime<Utc>>,
}

impl Credentials {
    pub fn expires_soon(&self, _leeway: ChronoDuration) -> bool {
        true // Always expired
    }
}

pub struct OAuthCredentials;

impl OAuthCredentials {
    pub fn new() -> Self {
        Self
    }

    pub async fn load(&self) -> std::io::Result<()> {
        Ok(())
    }

    pub async fn save(&self, _creds: &Credentials) -> std::io::Result<()> {
        Ok(())
    }

    pub async fn clear(&self) -> std::io::Result<()> {
        Ok(())
    }

    pub async fn get(&self) -> Option<Credentials> {
        None
    }
}
