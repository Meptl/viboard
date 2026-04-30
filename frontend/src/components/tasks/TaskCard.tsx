import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { KanbanCard } from '@/components/ui/shadcn-io/kanban';
import { CheckCircle, Link, Loader2, XCircle } from 'lucide-react';
import type { TaskWithAttemptStatus } from 'shared/types';
import { ActionsDropdown } from '@/components/ui/actions-dropdown';
import { Button } from '@/components/ui/button';
import { useNavigateWithSearch } from '@/hooks';
import { paths } from '@/lib/paths';
import { attemptsApi } from '@/lib/api';
import { TaskCardHeader } from './TaskCardHeader';

type Task = TaskWithAttemptStatus;

interface TaskCardProps {
  task: Task;
  index: number;
  status: string;
  onViewDetails: (task: Task) => void;
  isOpen?: boolean;
  projectId: string;
  keepInPlaceWhileDragging?: boolean;
}

interface TaskCardContentProps {
  task: Task;
  right?: ReactNode;
}

export function TaskCardContent({ task, right }: TaskCardContentProps) {
  return (
    <div className="group flex flex-col gap-2">
      <TaskCardHeader title={task.title} right={right} />
    </div>
  );
}

export function TaskCard({
  task,
  index,
  status,
  onViewDetails,
  isOpen,
  projectId,
  keepInPlaceWhileDragging = false,
}: TaskCardProps) {
  const navigate = useNavigateWithSearch();
  const [isNavigatingToParent, setIsNavigatingToParent] = useState(false);

  const handleClick = useCallback(() => {
    onViewDetails(task);
  }, [task, onViewDetails]);

  const handleParentClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!task.parent_task_attempt || isNavigatingToParent) return;

      setIsNavigatingToParent(true);
      try {
        const parentAttempt = await attemptsApi.get(task.parent_task_attempt);
        navigate(
          paths.attempt(
            projectId,
            parentAttempt.task_id,
            task.parent_task_attempt
          )
        );
      } catch (error) {
        console.error('Failed to navigate to parent task attempt:', error);
        setIsNavigatingToParent(false);
      }
    },
    [task.parent_task_attempt, projectId, navigate, isNavigatingToParent]
  );

  const localRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !localRef.current) return;
    const el = localRef.current;
    requestAnimationFrame(() => {
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
  }, [isOpen]);

  return (
    <KanbanCard
      key={task.id}
      id={task.id}
      name={task.title}
      index={index}
      parent={status}
      onClick={handleClick}
      isOpen={isOpen}
      forwardedRef={localRef}
      keepInPlaceWhileDragging={keepInPlaceWhileDragging}
    >
      <TaskCardContent
        task={task}
        right={
          <>
            {task.has_in_progress_attempt && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            )}
            {task.has_merged_attempt && (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
            {task.last_attempt_failed && !task.has_merged_attempt && (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            {task.parent_task_attempt && (
              <Button
                variant="icon"
                onClick={handleParentClick}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={isNavigatingToParent}
                title="Navigate to parent task attempt"
              >
                <Link className="h-4 w-4" />
              </Button>
            )}
            <ActionsDropdown
              task={task}
              triggerClassName="h-7 w-7 -m-1 rounded-md opacity-0 text-foreground/45 transition-[opacity,color] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-foreground/80 data-[state=open]:text-foreground/80 dark:text-foreground/50 dark:hover:text-foreground/90 dark:data-[state=open]:text-foreground/90 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </>
        }
      />
    </KanbanCard>
  );
}
