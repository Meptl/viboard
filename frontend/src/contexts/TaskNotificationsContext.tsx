import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import type { TaskWithAttemptStatus } from 'shared/types';

type AttemptCompletionOutcome = 'merged' | 'failed' | 'completed';

export interface TaskNotification {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  outcome: AttemptCompletionOutcome;
  createdAt: number;
}

type TaskSnapshot = Pick<
  TaskWithAttemptStatus,
  'id' | 'title' | 'has_in_progress_attempt' | 'has_merged_attempt' | 'last_attempt_failed'
>;

interface TaskNotificationsContextValue {
  notifications: TaskNotification[];
  ingestProjectTasks: (projectId: string, tasks: TaskWithAttemptStatus[]) => void;
  clearTaskNotifications: (projectId: string, taskId: string) => void;
}

const TaskNotificationsContext =
  createContext<TaskNotificationsContextValue | null>(null);

function toTaskSnapshot(task: TaskWithAttemptStatus): TaskSnapshot {
  return {
    id: task.id,
    title: task.title,
    has_in_progress_attempt: task.has_in_progress_attempt,
    has_merged_attempt: task.has_merged_attempt,
    last_attempt_failed: task.last_attempt_failed,
  };
}

function getOutcome(task: TaskSnapshot): AttemptCompletionOutcome {
  if (task.has_merged_attempt) return 'merged';
  if (task.last_attempt_failed) return 'failed';
  return 'completed';
}

const MAX_NOTIFICATIONS = 20;

export function TaskNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const previousTasksByProjectRef = useRef<Record<string, Record<string, TaskSnapshot>>>(
    {}
  );
  const currentTaskRoute = useMemo(() => {
    const match = location.pathname.match(/^\/projects\/([^/]+)\/tasks\/([^/]+)/);
    if (!match) return null;
    return { projectId: match[1], taskId: match[2] };
  }, [location.pathname]);

  const clearTaskNotifications = useCallback((projectId: string, taskId: string) => {
    setNotifications((prev) =>
      prev.filter((n) => !(n.projectId === projectId && n.taskId === taskId))
    );
  }, []);

  const ingestProjectTasks = useCallback(
    (projectId: string, tasks: TaskWithAttemptStatus[]) => {
      if (!projectId) return;

      const currentSnapshots: Record<string, TaskSnapshot> = {};
      for (const task of tasks) {
        currentSnapshots[task.id] = toTaskSnapshot(task);
      }

      const prevSnapshots = previousTasksByProjectRef.current[projectId];
      if (!prevSnapshots) {
        previousTasksByProjectRef.current[projectId] = currentSnapshots;
        return;
      }

      const nextNotifications: TaskNotification[] = [];
      for (const task of tasks) {
        const prevTask = prevSnapshots[task.id];
        if (!prevTask) continue;

        const attemptJustFinished =
          prevTask.has_in_progress_attempt && !task.has_in_progress_attempt;
        if (!attemptJustFinished) continue;

        if (
          currentTaskRoute &&
          currentTaskRoute.projectId === projectId &&
          currentTaskRoute.taskId === task.id
        ) {
          continue;
        }

        const now = Date.now();

        nextNotifications.push({
          id: `${projectId}:${task.id}:${now}:${nextNotifications.length}`,
          projectId,
          taskId: task.id,
          taskTitle: task.title || 'Untitled task',
          outcome: getOutcome(toTaskSnapshot(task)),
          createdAt: now,
        });
      }

      previousTasksByProjectRef.current[projectId] = currentSnapshots;

      if (!nextNotifications.length) return;

      setNotifications((prev) => {
        const deduped = prev.filter(
          (existing) =>
            !nextNotifications.some(
              (added) =>
                added.projectId === existing.projectId &&
                added.taskId === existing.taskId &&
                existing.createdAt >= added.createdAt - 500
            )
        );
        return [...nextNotifications, ...deduped].slice(0, MAX_NOTIFICATIONS);
      });
    },
    [currentTaskRoute]
  );

  useEffect(() => {
    if (!currentTaskRoute) return;
    clearTaskNotifications(currentTaskRoute.projectId, currentTaskRoute.taskId);
  }, [currentTaskRoute, clearTaskNotifications]);

  const value = useMemo(
    () => ({
      notifications,
      ingestProjectTasks,
      clearTaskNotifications,
    }),
    [notifications, ingestProjectTasks, clearTaskNotifications]
  );

  return (
    <TaskNotificationsContext.Provider value={value}>
      {children}
    </TaskNotificationsContext.Provider>
  );
}

export function useTaskNotifications() {
  const context = useContext(TaskNotificationsContext);
  if (!context) {
    throw new Error(
      'useTaskNotifications must be used within a TaskNotificationsProvider'
    );
  }
  return context;
}
