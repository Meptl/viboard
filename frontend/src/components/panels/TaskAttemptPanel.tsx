import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import VirtualizedList from '@/components/logs/VirtualizedList';
import { TaskFollowUpSection } from '@/components/tasks/TaskFollowUpSection';
import { EntriesProvider } from '@/contexts/EntriesContext';
import { RetryUiProvider } from '@/contexts/RetryUiContext';
import { Loader } from '@/components/ui/loader';
import type { ReactNode } from 'react';

interface TaskAttemptPanelProps {
  attempt: TaskAttempt | undefined;
  task: TaskWithAttemptStatus | null;
  children: (sections: { logs: ReactNode; followUp: ReactNode }) => ReactNode;
}

const TaskAttemptPanel = ({
  attempt,
  task,
  children,
}: TaskAttemptPanelProps) => {
  if (!attempt) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <Loader message="Loading attempt..." />
      </div>
    );
  }

  return (
    <EntriesProvider key={attempt.id}>
      <RetryUiProvider attemptId={attempt.id}>
        {children({
          logs: <VirtualizedList key={attempt.id} attempt={attempt} />,
          followUp: task ? (
            <TaskFollowUpSection task={task} selectedAttemptId={attempt.id} />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Loading task...</div>
          ),
        })}
      </RetryUiProvider>
    </EntriesProvider>
  );
};

export default TaskAttemptPanel;
