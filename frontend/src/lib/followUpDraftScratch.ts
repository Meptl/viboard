import type { DraftFollowUpData, DraftReviewCommentData } from 'shared/types';

const STORAGE_KEY_PREFIX = 'follow-up-draft:';

function getStorageKey(attemptId: string) {
  return `${STORAGE_KEY_PREFIX}${attemptId}`;
}

function isDraftReviewCommentData(value: unknown): value is DraftReviewCommentData {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as {
    file_path?: unknown;
    line_number?: unknown;
    side?: unknown;
    text?: unknown;
    code_line?: unknown;
  };

  return (
    typeof candidate.file_path === 'string' &&
    typeof candidate.line_number === 'number' &&
    Number.isFinite(candidate.line_number) &&
    typeof candidate.side === 'string' &&
    typeof candidate.text === 'string' &&
    (candidate.code_line === undefined ||
      candidate.code_line === null ||
      typeof candidate.code_line === 'string')
  );
}

function isDraftFollowUpData(value: unknown): value is DraftFollowUpData {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as {
    message?: unknown;
    variant?: unknown;
    review_comments?: unknown;
    review_comment_drafts?: unknown;
  };

  const messageValid = typeof candidate.message === 'string';
  const variantValid =
    candidate.variant === null ||
    candidate.variant === undefined ||
    typeof candidate.variant === 'string';
  const reviewCommentsValid =
    candidate.review_comments === undefined ||
    (Array.isArray(candidate.review_comments) &&
      candidate.review_comments.every(isDraftReviewCommentData));
  const reviewCommentDraftsValid =
    candidate.review_comment_drafts === undefined ||
    (Array.isArray(candidate.review_comment_drafts) &&
      candidate.review_comment_drafts.every(isDraftReviewCommentData));

  return (
    messageValid && variantValid && reviewCommentsValid && reviewCommentDraftsValid
  );
}

function normalizeDraft(draft: DraftFollowUpData): DraftFollowUpData {
  return {
    message: draft.message,
    variant: draft.variant ?? null,
    review_comments: draft.review_comments ?? [],
    review_comment_drafts: draft.review_comment_drafts ?? [],
  };
}

export function readFollowUpDraftScratch(
  attemptId: string | undefined
): DraftFollowUpData | null {
  if (!attemptId || typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getStorageKey(attemptId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isDraftFollowUpData(parsed) ? normalizeDraft(parsed) : null;
  } catch {
    return null;
  }
}

export function writeFollowUpDraftScratch(
  attemptId: string | undefined,
  nextDraft: DraftFollowUpData
) {
  if (!attemptId || typeof window === 'undefined') return;

  const key = getStorageKey(attemptId);
  const normalized = normalizeDraft(nextDraft);
  const isEmpty =
    !normalized.message.trim() &&
    !normalized.variant &&
    normalized.review_comments.length === 0 &&
    normalized.review_comment_drafts.length === 0;

  if (isEmpty) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(normalized));
}

export function clearFollowUpDraftScratch(attemptId: string | undefined) {
  if (!attemptId || typeof window === 'undefined') return;
  window.localStorage.removeItem(getStorageKey(attemptId));
}
