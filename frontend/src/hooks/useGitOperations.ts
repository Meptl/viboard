import { useRebase } from './useRebase';
import { useMerge } from './useMerge';
import { useChangeTargetBranch } from './useChangeTargetBranch';
import { useGitOperationsError } from '@/contexts/GitOperationsContext';
import { Result } from '@/lib/api';
import type { GitOperationError } from 'shared/types';

export function useGitOperations(
  attemptId: string | undefined,
  projectId: string | undefined
) {
  const { setError } = useGitOperationsError();

  const rebase = useRebase(
    attemptId,
    projectId,
    () => setError(null),
    (err: Result<void, GitOperationError>) => {
      if (!err.success) {
        const data = err?.error;
        const isConflict =
          data?.type === 'merge_conflicts' ||
          data?.type === 'rebase_in_progress';
        if (!isConflict) {
          setError(err.message || 'Failed to rebase');
        }
      }
    }
  );

  const merge = useMerge(
    attemptId,
    () => setError(null),
    (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'Failed to merge';
      setError(message);
    }
  );

  const changeTargetBranch = useChangeTargetBranch(
    attemptId,
    projectId,
    () => setError(null),
    (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'Failed to change target branch';
      setError(message);
    }
  );

  const isAnyLoading =
    rebase.isPending || merge.isPending || changeTargetBranch.isPending;

  return {
    actions: {
      rebase: rebase.mutateAsync,
      merge: merge.mutateAsync,
      changeTargetBranch: changeTargetBranch.mutateAsync,
    },
    isAnyLoading,
    states: {
      rebasePending: rebase.isPending,
      mergePending: merge.isPending,
      changeTargetBranchPending: changeTargetBranch.isPending,
    },
  };
}
