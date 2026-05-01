import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { TaskWithAttemptStatus, TaskAttempt } from 'shared/types';
import { useOpenInEditor } from '@/hooks/useOpenInEditor';
import { DeleteTaskConfirmationDialog } from '@/components/dialogs/tasks/DeleteTaskConfirmationDialog';
import { ViewProcessesDialog } from '@/components/dialogs/tasks/ViewProcessesDialog';
import { CreateAttemptDialog } from '@/components/dialogs/tasks/CreateAttemptDialog';
import { useProject } from '@/contexts/ProjectContext';
import { openTaskForm } from '@/lib/openTaskForm';
import { cn } from '@/lib/utils';
import { attemptsApi } from '@/lib/api';
import { useTaskMutations } from '@/hooks/useTaskMutations';

interface ActionsDropdownProps {
  task?: TaskWithAttemptStatus | null;
  attempt?: TaskAttempt | null;
  triggerClassName?: string;
}

export function ActionsDropdown({
  task,
  attempt,
  triggerClassName,
}: ActionsDropdownProps) {
  const { projectId } = useProject();
  const { updateTask } = useTaskMutations();
  const openInEditor = useOpenInEditor(attempt?.id);

  const hasAttemptActions = Boolean(attempt);
  const hasTaskActions = Boolean(task);
  const stopEventPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId || !task) return;
    openTaskForm({ mode: 'edit', projectId, task });
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId || !task) return;
    openTaskForm({ mode: 'duplicate', projectId, initialTask: task });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId || !task) return;
    try {
      await DeleteTaskConfirmationDialog.show({
        task,
        projectId,
      });
    } catch {
      // User cancelled or error occurred
    }
  };

  const handleOpenInEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!attempt?.id) return;
    openInEditor();
  };

  const handleViewDetails = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task?.id) return;

    try {
      const taskAttempts = await attemptsApi.getAll(task.id);
      const latestAttempt = [...taskAttempts].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];

      if (!latestAttempt?.id) return;

      ViewProcessesDialog.show({ attemptId: latestAttempt.id });
    } catch (error) {
      console.error('Failed to open details from task actions:', error);
    }
  };

  const handleCreateNewAttempt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task?.id) return;
    CreateAttemptDialog.show({
      taskId: task.id,
    });
  };

  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task?.id) return;
    updateTask.mutate({
      taskId: task.id,
      data: {
        pinned: !task.pinned,
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="icon"
            aria-label="Actions"
            className={cn(triggerClassName)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasAttemptActions && (
            <>
              <DropdownMenuLabel
                onPointerDown={stopEventPropagation}
                onMouseDown={stopEventPropagation}
                onClick={stopEventPropagation}
              >
                Attempt
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!attempt?.id}
                onClick={handleOpenInEditor}
              >
                Open attempt in IDE
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreateNewAttempt}>
                Create new attempt
              </DropdownMenuItem>
              {hasTaskActions && (
                <DropdownMenuSeparator
                  onPointerDown={stopEventPropagation}
                  onMouseDown={stopEventPropagation}
                  onClick={stopEventPropagation}
                />
              )}
            </>
          )}

          {hasTaskActions && (
            <>
              <DropdownMenuLabel
                onPointerDown={stopEventPropagation}
                onMouseDown={stopEventPropagation}
                onClick={stopEventPropagation}
              >
                Task
              </DropdownMenuLabel>
              <DropdownMenuItem disabled={!projectId} onClick={handleEdit}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!projectId} onClick={handleDuplicate}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!task?.id}
                onClick={handleViewDetails}
              >
                Details
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!task?.id || updateTask.isPending}
                onClick={handleTogglePin}
              >
                {task?.pinned ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!projectId}
                onClick={handleDelete}
                className="text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
