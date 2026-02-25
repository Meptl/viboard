import { useCallback, useEffect, useState } from 'react';
import type { DraftFollowUpData } from 'shared/types';

const STORAGE_KEY_PREFIX = 'follow-up-draft:';

function getStorageKey(attemptId: string) {
  return `${STORAGE_KEY_PREFIX}${attemptId}`;
}

function isDraftFollowUpData(value: unknown): value is DraftFollowUpData {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as { message?: unknown; variant?: unknown };
  const messageValid = typeof candidate.message === 'string';
  const variantValid =
    candidate.variant === null || typeof candidate.variant === 'string';

  return messageValid && variantValid;
}

function readDraft(attemptId: string | undefined): DraftFollowUpData | null {
  if (!attemptId || typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getStorageKey(attemptId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isDraftFollowUpData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function useFollowUpDraftStorage(attemptId?: string) {
  const [draft, setDraft] = useState<DraftFollowUpData | null>(() =>
    readDraft(attemptId)
  );

  useEffect(() => {
    setDraft(readDraft(attemptId));
  }, [attemptId]);

  const saveDraft = useCallback(
    (nextDraft: DraftFollowUpData) => {
      if (!attemptId || typeof window === 'undefined') return;

      const isEmpty = !nextDraft.message.trim() && !nextDraft.variant;
      const key = getStorageKey(attemptId);

      try {
        if (isEmpty) {
          window.localStorage.removeItem(key);
          setDraft(null);
          return;
        }

        window.localStorage.setItem(key, JSON.stringify(nextDraft));
        setDraft(nextDraft);
      } catch (error) {
        console.error('Failed to persist follow-up draft to localStorage', error);
      }
    },
    [attemptId]
  );

  const clearDraft = useCallback(() => {
    if (!attemptId || typeof window === 'undefined') {
      setDraft(null);
      return;
    }

    try {
      window.localStorage.removeItem(getStorageKey(attemptId));
    } catch (error) {
      console.error('Failed to clear follow-up draft from localStorage', error);
    }
    setDraft(null);
  }, [attemptId]);

  return {
    draft,
    isLoading: false,
    saveDraft,
    clearDraft,
  };
}
