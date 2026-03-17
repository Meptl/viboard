import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, FileDiff, X } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import type { LayoutMode } from '../layout/TasksLayout';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { ActionsDropdown } from '../ui/actions-dropdown';
import GitOperations, {
  type GitOperationsInputs,
} from '@/components/tasks/Toolbar/GitOperations.tsx';

interface AttemptHeaderActionsProps {
  onClose: () => void;
  mode?: LayoutMode;
  onModeChange?: (mode: LayoutMode) => void;
  task: TaskWithAttemptStatus;
  attempt?: TaskAttempt | null;
  gitOps?: GitOperationsInputs;
  attemptSwitcher?: ReactNode;
}

export const AttemptHeaderActions = ({
  onClose,
  mode,
  onModeChange,
  task,
  attempt,
  gitOps,
  attemptSwitcher,
}: AttemptHeaderActionsProps) => {
  const { t } = useTranslation('tasks');
  const isPreviewMode = mode !== 'diffs';
  const isDiffMode = mode === 'diffs';
  const nextMode: LayoutMode = isPreviewMode ? 'diffs' : 'preview';

  return (
    <>
      {typeof mode !== 'undefined' && onModeChange && (
        <div className="inline-flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="icon"
                  onClick={() => onModeChange(nextMode)}
                  aria-label={`Switch to ${t(`attemptHeaderActions.${nextMode}`)}`}
                  className={`h-7 w-7 transition-all duration-200 ${
                    isPreviewMode ? 'rounded-full' : 'rounded-sm'
                  }`}
                >
                  {isDiffMode ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <FileDiff className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t(`attemptHeaderActions.${nextMode}`)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {attempt && gitOps && (
            <GitOperations
              selectedAttempt={attempt}
              {...gitOps}
              display="action-only"
            />
          )}
          {attemptSwitcher}
        </div>
      )}
      {typeof mode !== 'undefined' && onModeChange && (
        <div className="h-4 w-px bg-border" />
      )}
      <ActionsDropdown task={task} attempt={attempt} />
      <Button variant="icon" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </Button>
    </>
  );
};
