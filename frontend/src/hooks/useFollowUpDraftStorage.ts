import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftFollowUpData } from 'shared/types';
import { draftApi } from '@/lib/api';

export function useFollowUpDraftStorage(attemptId?: string) {
  const [draft, setDraft] = useState<DraftFollowUpData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const mutationSeqRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const seqAtLoadStart = mutationSeqRef.current;

    if (!attemptId) {
      setDraft(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    draftApi
      .get(attemptId)
      .then((nextDraft) => {
        // Ignore stale loads that started before a newer save/clear.
        if (mounted && seqAtLoadStart === mutationSeqRef.current) {
          setDraft(nextDraft);
        }
      })
      .catch((error) => {
        console.error('Failed to load follow-up draft', error);
        if (mounted) {
          setDraft(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [attemptId]);

  const saveDraft = useCallback(
    async (nextDraft: DraftFollowUpData) => {
      if (!attemptId) return;
      const seq = ++mutationSeqRef.current;
      try {
        await draftApi.save(attemptId, nextDraft);
        // Ignore out-of-order save completions.
        if (seq === mutationSeqRef.current) {
          setDraft(nextDraft);
        }
      } catch (error) {
        console.error('Failed to save follow-up draft', error);
      }
    },
    [attemptId]
  );

  const clearDraft = useCallback(async () => {
    const seq = ++mutationSeqRef.current;
    // Clear immediately in UI; server clear runs in background.
    setDraft(null);

    if (!attemptId) {
      return;
    }

    try {
      await draftApi.clear(attemptId);
    } catch (error) {
      console.error('Failed to clear follow-up draft', error);
    }
    if (seq === mutationSeqRef.current) {
      setDraft(null);
    }
  }, [attemptId]);

  return {
    draft,
    isLoading,
    saveDraft,
    clearDraft,
  };
}
