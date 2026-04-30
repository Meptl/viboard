import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader } from '@/components/ui/loader';
import GitOperations from '@/components/tasks/Toolbar/GitOperations';
import { useTaskAttempt } from '@/hooks/useTaskAttempt';
import { useBranchStatus, useAttemptExecution } from '@/hooks';
import { useProject } from '@/contexts/ProjectContext';
import { ExecutionProcessesProvider } from '@/contexts/ExecutionProcessesContext';
import {
  GitOperationsProvider,
  useGitOperationsError,
} from '@/contexts/GitOperationsContext';
import { projectsApi } from '@/lib/api';
import type { GitBranch, TaskAttempt } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';

export interface GitActionsDialogProps {
  attemptId: string;
  projectId?: string;
}

interface GitActionsDialogContentProps {
  attempt: TaskAttempt;
  projectId: string;
  branches: GitBranch[];
}

function GitActionsDialogContent({
  attempt,
  projectId,
  branches,
}: GitActionsDialogContentProps) {
  const { data: branchStatus } = useBranchStatus(attempt.id);
  const { isAttemptRunning } = useAttemptExecution(attempt.id);
  const { error: gitError } = useGitOperationsError();

  return (
    <div className="space-y-4">
      {gitError && (
        <div className="p-3 border border-destructive rounded text-destructive text-sm">
          {gitError}
        </div>
      )}
      <GitOperations
        selectedAttempt={attempt}
        projectId={projectId}
        branchStatus={branchStatus ?? null}
        branches={branches}
        isAttemptRunning={isAttemptRunning}
        selectedBranch={branchStatus?.target_branch_name ?? null}
        layout="vertical"
      />
    </div>
  );
}

const GitActionsDialogImpl = NiceModal.create<GitActionsDialogProps>(
  ({ attemptId, projectId: providedProjectId }) => {
    const modal = useModal();
    const { project } = useProject();

    const effectiveProjectId = providedProjectId ?? project?.id;
    const { data: attempt } = useTaskAttempt(attemptId);

    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [loadingBranches, setLoadingBranches] = useState(true);

    useEffect(() => {
      if (!effectiveProjectId) return;
      setLoadingBranches(true);
      projectsApi
        .getBranches(effectiveProjectId)
        .then(setBranches)
        .catch(() => setBranches([]))
        .finally(() => setLoadingBranches(false));
    }, [effectiveProjectId]);

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        modal.hide();
      }
    };

    const isLoading = !attempt || !effectiveProjectId || loadingBranches;

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Git Actions</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="py-8">
              <Loader size={24} />
            </div>
          ) : (
            <GitOperationsProvider attemptId={attempt.id}>
              <ExecutionProcessesProvider
                key={attempt.id}
                attemptId={attempt.id}
              >
                <GitActionsDialogContent
                  attempt={attempt}
                  projectId={effectiveProjectId}
                  branches={branches}
                />
              </ExecutionProcessesProvider>
            </GitOperationsProvider>
          )}
        </DialogContent>
      </Dialog>
    );
  }
);

export const GitActionsDialog = defineModal<GitActionsDialogProps, void>(
  GitActionsDialogImpl
);
