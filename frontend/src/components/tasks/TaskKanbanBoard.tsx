import { memo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/shadcn-io/kanban';
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
  onViewTaskDetails: (task: TaskWithAttemptStatus) => void;
  selectedTaskId?: string;
  onCreateTask?: () => void;
  projectId: string;
}

function TaskKanbanBoard({
  columns,
  onDragEnd,
  onViewTaskDetails,
  selectedTaskId,
  onCreateTask,
  projectId,
}: TaskKanbanBoardProps) {
  return (
    <KanbanProvider onDragEnd={onDragEnd}>
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
              onAddTask={onCreateTask}
              leadingIcon={
                statusKey === 'cancelled' ? (
                  <Trash2
                    className="h-3.5 w-3.5 text-destructive"
                    aria-hidden="true"
                  />
                ) : undefined
              }
              hideAddTask={statusKey === 'cancelled'}
            />
            <KanbanCards>
              {items.map((item, index) => {
                return (
                  <TaskCard
                    key={item.task.id}
                    task={item.task}
                    index={index}
                    status={statusKey}
                    onViewDetails={onViewTaskDetails}
                    isOpen={selectedTaskId === item.task.id}
                    projectId={projectId}
                  />
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
