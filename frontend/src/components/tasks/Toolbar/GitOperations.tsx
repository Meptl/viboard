import {
  ArrowRight,
  GitBranch as GitBranchIcon,
  RefreshCw,
  Settings,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx';
import { useMemo, useState } from 'react';
import type {
  BranchStatus,
  Merge,
  GitBranch,
  TaskAttempt,
} from 'shared/types';
import { ChangeTargetBranchDialog } from '@/components/dialogs/tasks/ChangeTargetBranchDialog';
import { useTranslation } from 'react-i18next';
import { useGitOperations } from '@/hooks/useGitOperations';

interface GitOperationsProps {
  selectedAttempt: TaskAttempt;
  projectId: string;
  branchStatus: BranchStatus | null;
  branches: GitBranch[];
  isAttemptRunning: boolean;
  selectedBranch: string | null;
  layout?: 'horizontal' | 'vertical';
}

export type GitOperationsInputs = Omit<GitOperationsProps, 'selectedAttempt'>;

function GitOperations({
  selectedAttempt,
  projectId,
  branchStatus,
  branches,
  isAttemptRunning,
  selectedBranch,
  layout = 'horizontal',
}: GitOperationsProps) {
  const { t } = useTranslation('tasks');

  const git = useGitOperations(selectedAttempt.id, projectId);
  const isChangingTargetBranch = git.states.changeTargetBranchPending;

  // Git status calculations
  const hasConflictsCalculated = useMemo(
    () => Boolean((branchStatus?.conflicted_files?.length ?? 0) > 0),
    [branchStatus?.conflicted_files]
  );

  // Local state for git operations
  const [merging, setMerging] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  // Target branch change handlers
  const handleChangeTargetBranchClick = async (newBranch: string) => {
    await git.actions.changeTargetBranch(newBranch);
  };

  const handleChangeTargetBranchDialogOpen = async () => {
    try {
      const result = await ChangeTargetBranchDialog.show({
        branches,
        isChangingTargetBranch: isChangingTargetBranch,
      });

      if (result.action === 'confirmed' && result.branchName) {
        await handleChangeTargetBranchClick(result.branchName);
      }
    } catch (error) {
      // User cancelled - do nothing
    }
  };

  // Memoize merge status information to avoid repeated calculations
  const mergeInfo = useMemo(() => {
    if (!branchStatus?.merges)
      return {
        hasMergedHistory: false,
        isCurrentHeadMerged: false,
      };

    const merges = branchStatus.merges.filter(
      (m: Merge) =>
        m.type === 'direct' ||
        (m.type === 'pr' && m.pr_info.status === 'merged')
    );

    const mergedCommitShas = new Set(
      merges
        .map((m) => {
          if (m.type === 'direct') return m.merge_commit;
          return m.pr_info.merge_commit_sha;
        })
        .filter((sha): sha is string => Boolean(sha))
    );

    return {
      hasMergedHistory: merges.length > 0,
      isCurrentHeadMerged: Boolean(
        branchStatus.head_oid && mergedCommitShas.has(branchStatus.head_oid)
      ),
    };
  }, [branchStatus?.head_oid, branchStatus?.merges]);

  const mergeButtonLabel = useMemo(() => {
    if (mergeSuccess) return t('git.states.merged');
    if (merging) return t('git.states.merging');
    return t('git.states.merge');
  }, [mergeSuccess, merging, t]);

  const rebaseButtonLabel = useMemo(() => {
    if (rebasing) return t('git.states.rebasing');
    return t('git.states.rebase');
  }, [rebasing, t]);

  const shouldShowRebaseAction = useMemo(
    () =>
      Boolean(
        branchStatus?.is_rebase_in_progress ||
          (branchStatus?.commits_behind ?? 0) > 0
      ),
    [branchStatus?.commits_behind, branchStatus?.is_rebase_in_progress]
  );

  const handleMergeClick = async () => {
    // Directly perform merge without checking branch status
    await performMerge();
  };

  const performMerge = async () => {
    try {
      setMerging(true);
      await git.actions.merge();
      setMergeSuccess(true);
      setTimeout(() => setMergeSuccess(false), 2000);
    } finally {
      setMerging(false);
    }
  };

  const handleRebaseClick = async () => {
    setRebasing(true);
    try {
      await git.actions.rebase({});
      // Uses backend defaults for old/new base, which resolve to the current target branch.
    } finally {
      setRebasing(false);
    }
  };

  const isVertical = layout === 'vertical';

  const containerClasses = isVertical
    ? 'grid grid-cols-1 items-start gap-3'
    : 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden';

  const settingsBtnClasses = isVertical
    ? 'inline-flex h-5 w-5 p-0 hover:bg-muted'
    : 'hidden md:inline-flex h-5 w-5 p-0 hover:bg-muted';

  const actionsClasses = isVertical
    ? 'flex flex-wrap items-center gap-2'
    : 'shrink-0 flex flex-wrap items-center gap-2 overflow-y-hidden overflow-x-visible max-h-8';

  return (
    <div className="w-full border-b py-2">
      <div className={containerClasses}>
        {/* Left: Branch flow */}
        <div
          className={
            isVertical
              ? 'flex flex-wrap items-center gap-2 min-w-0'
              : 'flex items-center gap-2 min-w-0 shrink-0 overflow-hidden'
          }
        >
          {/* Task branch chip */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden sm:inline-flex items-center gap-1.5 max-w-[280px] px-2 py-0.5 rounded-full bg-muted text-xs font-medium min-w-0">
                  <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{selectedAttempt.branch}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('git.labels.taskBranch')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <ArrowRight className="hidden sm:inline h-4 w-4 text-muted-foreground" />

          {/* Target branch chip + change button */}
          <div
            className={
              isVertical
                ? 'flex flex-wrap items-center gap-1 min-w-0'
                : 'flex items-center gap-1 min-w-0'
            }
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 max-w-[280px] px-2 py-0.5 rounded-full bg-muted text-xs font-medium min-w-0">
                    <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {branchStatus?.target_branch_name ||
                        selectedAttempt.target_branch ||
                        selectedBranch ||
                        t('git.branch.current')}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('rebase.dialog.targetLabel')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleChangeTargetBranchDialogOpen}
                    disabled={hasConflictsCalculated}
                    className={settingsBtnClasses}
                    aria-label={t('branches.changeTarget.dialog.title')}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('branches.changeTarget.dialog.title')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Center: Status chips */}
        <div
          className={
            isVertical
              ? 'flex flex-wrap items-center gap-2 text-xs min-w-0'
              : 'flex items-center gap-2 text-xs min-w-0 overflow-hidden whitespace-nowrap'
          }
        >
          {(() => {
            const commitsAhead = branchStatus?.commits_ahead ?? 0;
            const commitsBehind = branchStatus?.commits_behind ?? 0;

            if (hasConflictsCalculated) {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100/60 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('git.status.conflicts')}
                </span>
              );
            }

            if (branchStatus?.is_rebase_in_progress) {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100/60 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t('git.states.rebasing')}
                </span>
              );
            }

            if (
              mergeInfo.isCurrentHeadMerged &&
              (branchStatus?.commits_ahead ?? 0) === 0
            ) {
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('git.states.merged')}
                </span>
              );
            }

            const chips: React.ReactNode[] = [];
            if (mergeInfo.hasMergedHistory) {
              chips.push(
                <span
                  key="merged-history"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100/40 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  {t('git.states.merged')}
                </span>
              );
            }
            if (commitsAhead > 0) {
              chips.push(
                <span
                  key="ahead"
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                >
                  +{commitsAhead}{' '}
                  {t('git.status.commits', { count: commitsAhead })}{' '}
                  {t('git.status.ahead')}
                </span>
              );
            }
            if (commitsBehind > 0) {
              chips.push(
                <span
                  key="behind"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100/60 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                >
                  {commitsBehind}{' '}
                  {t('git.status.commits', { count: commitsBehind })}{' '}
                  {t('git.status.behind')}
                </span>
              );
            }
            if (chips.length > 0)
              return <div className="flex flex-wrap items-center gap-2">{chips}</div>;

            return (
              <span className="text-muted-foreground hidden sm:inline">
                {t('git.status.upToDate')}
              </span>
            );
          })()}
        </div>

        {/* Right: Actions */}
        {branchStatus && (
          <div className={actionsClasses}>
            <Button
              onClick={
                shouldShowRebaseAction ? handleRebaseClick : handleMergeClick
              }
              disabled={
                shouldShowRebaseAction
                  ? rebasing || isAttemptRunning || hasConflictsCalculated
                  : merging ||
                    hasConflictsCalculated ||
                    isAttemptRunning ||
                    ((branchStatus.commits_ahead ?? 0) === 0 && !mergeSuccess)
              }
              variant="outline"
              size="xs"
              className={`gap-1 shrink-0 ${
                shouldShowRebaseAction
                  ? 'border-warning text-warning hover:bg-warning'
                  : 'border-success text-success hover:bg-success'
              }`}
              aria-label={
                shouldShowRebaseAction ? rebaseButtonLabel : mergeButtonLabel
              }
            >
              {shouldShowRebaseAction ? (
                <RefreshCw
                  className={`h-3.5 w-3.5 ${rebasing ? 'animate-spin' : ''}`}
                />
              ) : (
                <GitBranchIcon className="h-3.5 w-3.5" />
              )}
              <span className="truncate max-w-[10ch]">
                {shouldShowRebaseAction ? rebaseButtonLabel : mergeButtonLabel}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GitOperations;
