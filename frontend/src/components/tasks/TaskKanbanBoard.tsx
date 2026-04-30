import { Fragment, memo } from 'react';
import { Paintbrush, Trash2 } from 'lucide-react';
import {
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/shadcn-io/kanban';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TaskCard } from './TaskCard';
import type { TaskStatus, TaskWithAttemptStatus } from 'shared/types';
import { statusBoardColors, statusLabels } from '@/utils/statusLabels';

export type KanbanColumnItem = {
  type: 'task';
  task: TaskWithAttemptStatus;
};

export type KanbanColumns = Record<TaskStatus, KanbanColumnItem[]>;

interface TaskKanbanBoardProps {
  columns: KanbanColumns;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
  onViewTaskDetails: (task: TaskWithAttemptStatus) => void;
  selectedTaskId?: string;
  onCreateTask?: () => void;
  projectId: string;
  onDoneCleanup?: () => void;
  disableDoneCleanup?: boolean;
  dropPreview?: {
    status: TaskStatus;
    index: number;
    height?: number | null;
  } | null;
}

function TaskKanbanBoard({
  columns,
  onDragEnd,
  onDragStart,
  onDragOver,
  onDragCancel,
  onViewTaskDetails,
  selectedTaskId,
  onCreateTask,
  projectId,
  onDoneCleanup,
  disableDoneCleanup,
  dropPreview,
}: TaskKanbanBoardProps) {
  const renderDropPlaceholder = (statusKey: TaskStatus, index: number) => {
    if (
      !dropPreview ||
      dropPreview.status !== statusKey ||
      dropPreview.index !== index
    ) {
      return null;
    }

    return (
      <div
        aria-hidden="true"
        className="border-b"
        key={`drop-preview-${statusKey}-${index}`}
        style={{
          height: dropPreview.height ?? 64,
          backgroundColor: 'hsl(var(--muted-foreground) / 0.28)',
        }}
      />
    );
  };

  return (
    <KanbanProvider
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragCancel={onDragCancel}
    >
      {Object.entries(columns).map(([status, items]) => {
        const statusKey = status as TaskStatus;
        return (
          <KanbanBoard key={status} id={statusKey}>
            <KanbanHeader
              name={
                statusKey === 'cancelled' ? (
                  <span className="flex items-center gap-1.5">
                    <span>(1 hour)</span>
                  </span>
                ) : (
                  statusLabels[statusKey]
                )
              }
              color={statusBoardColors[statusKey]}
              onAddTask={statusKey === 'todo' ? onCreateTask : undefined}
              actions={
                statusKey === 'done' && onDoneCleanup ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          className="m-0 p-0 h-0 text-foreground/50 hover:text-foreground disabled:text-foreground/30"
                          onClick={onDoneCleanup}
                          aria-label="Clean up done tasks"
                          disabled={disableDoneCleanup}
                        >
                          <Paintbrush className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Clean up done tasks
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : undefined
              }
              leadingIcon={
                statusKey === 'cancelled' ? (
                  <Trash2
                    className="h-3.5 w-3.5 text-destructive"
                    aria-hidden="true"
                  />
                ) : undefined
              }
              hideAddTask={statusKey !== 'todo'}
            />
            <KanbanCards>
              {renderDropPlaceholder(statusKey, 0)}
              {items.map((item, index) => {
                return (
                  <Fragment key={item.task.id}>
                    <TaskCard
                      task={item.task}
                      index={index}
                      status={statusKey}
                      onViewDetails={onViewTaskDetails}
                      isOpen={selectedTaskId === item.task.id}
                      projectId={projectId}
                    />
                    {renderDropPlaceholder(statusKey, index + 1)}
                  </Fragment>
                );
              })}
            </KanbanCards>
          </KanbanBoard>
        );
      })}
    </KanbanProvider>
  );
}

export default memo(TaskKanbanBoard);
