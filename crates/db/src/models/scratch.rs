use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Data for a persisted review comment inside a draft follow-up
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DraftReviewCommentData {
    pub file_path: String,
    pub line_number: i32,
    pub side: String,
    pub text: String,
    #[serde(default)]
    pub code_line: Option<String>,
}

/// Data for a draft follow-up
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DraftFollowUpData {
    pub message: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub review_comments: Vec<DraftReviewCommentData>,
    #[serde(default)]
    pub review_comment_drafts: Vec<DraftReviewCommentData>,
}
