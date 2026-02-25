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
import { useLocation, useNavigate } from 'react-router-dom';
import type { TaskWithAttemptStatus } from 'shared/types';
import {
  taskNotificationsApi,
  type TaskNotificationOutcome,
  type TaskNotificationRecord,
} from '@/lib/api';
import { useUserSystem } from '@/components/ConfigProvider';
import { paths } from '@/lib/paths';

export interface TaskNotification {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  outcome: TaskNotificationOutcome;
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
  clearProjectNotifications: (projectId: string) => void;
  clearAllNotifications: () => void;
}

interface InAppToast {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
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

function getOutcome(task: TaskSnapshot): TaskNotificationOutcome {
  if (task.last_attempt_failed) return 'failed';
  return 'completed';
}

function normalizeOutcome(outcome: TaskNotificationOutcome): TaskNotificationOutcome {
  return outcome === 'failed' ? 'failed' : 'completed';
}

function fromServerNotification(record: TaskNotificationRecord): TaskNotification {
  return {
    id: record.id,
    projectId: record.project_id,
    taskId: record.task_id,
    taskTitle: record.task_title,
    outcome: normalizeOutcome(record.outcome),
    createdAt: Date.parse(record.created_at),
  };
}

function isAppFocused() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function notificationTitle(notification: TaskNotification): string {
  return notification.outcome === 'failed'
    ? `Task failed: ${notification.taskTitle}`
    : `Task completed: ${notification.taskTitle}`;
}

export function TaskNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { config } = useUserSystem();
  const location = useLocation();
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const toastTimersRef = useRef<Record<string, number>>({});
  const previousTasksByProjectRef = useRef<Record<string, Record<string, TaskSnapshot>>>(
    {}
  );
  const currentTaskRoute = useMemo(() => {
    const match = location.pathname.match(/^\/projects\/([^/]+)\/tasks\/([^/]+)/);
    if (!match) return null;
    return { projectId: match[1], taskId: match[2] };
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const records = await taskNotificationsApi.list();
        if (cancelled) return;
        setNotifications(records.map(fromServerNotification));
      } catch (error) {
        console.error('Failed to load task notifications', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const clearTaskNotifications = useCallback((projectId: string, taskId: string) => {
    setNotifications((prev) =>
      prev.filter((n) => !(n.projectId === projectId && n.taskId === taskId))
    );

    void taskNotificationsApi.clearTask(projectId, taskId).catch((error) => {
      console.error('Failed to clear task notifications', error);
    });
  }, []);

  const clearProjectNotifications = useCallback((projectId: string) => {
    setNotifications((prev) =>
      prev.filter((n) => n.projectId !== projectId)
    );

    void taskNotificationsApi.clearProject(projectId).catch((error) => {
      console.error('Failed to clear project notifications', error);
    });
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);

    void taskNotificationsApi.clearAll().catch((error) => {
      console.error('Failed to clear all notifications', error);
    });
  }, []);

  const removeToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    const timerId = toastTimersRef.current[toastId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete toastTimersRef.current[toastId];
    }
  }, []);

  const showInAppToast = useCallback((notification: TaskNotification) => {
    const toast: InAppToast = {
      id: notification.id,
      projectId: notification.projectId,
      taskId: notification.taskId,
      title: notificationTitle(notification),
    };

    setToasts((prev) => [toast, ...prev.slice(0, 4)]);
    const timerId = window.setTimeout(() => removeToast(toast.id), 5000);
    toastTimersRef.current[toast.id] = timerId;
  }, [removeToast]);

  const showBrowserNotification = useCallback(
    async (notification: TaskNotification) => {
      if (!('Notification' in window)) return;

      const title = notificationTitle(notification);

      const create = () => {
        const browserNotification = new Notification(title);
        browserNotification.onclick = () => {
          window.focus();
          navigate(paths.task(notification.projectId, notification.taskId));
        };
      };

      if (Notification.permission === 'granted') {
        create();
        return;
      }

      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          create();
        }
      }
    },
    [navigate]
  );

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(toastTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      toastTimersRef.current = {};
    };
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
        return [...nextNotifications, ...deduped];
      });

      if (config?.notifications.push_enabled) {
        for (const notification of nextNotifications) {
          if (isAppFocused()) {
            showInAppToast(notification);
          } else {
            void showBrowserNotification(notification);
          }
        }
      }

      for (const notification of nextNotifications) {
        void taskNotificationsApi
          .create({
            project_id: notification.projectId,
            task_id: notification.taskId,
            task_title: notification.taskTitle,
            outcome: normalizeOutcome(notification.outcome),
          })
          .catch((error) => {
            console.error('Failed to persist task notification', error);
          });
      }
    },
    [
      config?.notifications.push_enabled,
      currentTaskRoute,
      showBrowserNotification,
      showInAppToast,
    ]
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
      clearProjectNotifications,
      clearAllNotifications,
    }),
    [
      notifications,
      ingestProjectTasks,
      clearTaskNotifications,
      clearProjectNotifications,
      clearAllNotifications,
    ]
  );

  return (
    <TaskNotificationsContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => {
              removeToast(toast.id);
              navigate(paths.task(toast.projectId, toast.taskId));
            }}
            className="pointer-events-auto rounded-md border border-border bg-background px-4 py-3 text-left shadow-md transition hover:bg-accent"
          >
            <div className="text-sm font-medium text-foreground">{toast.title}</div>
          </button>
        ))}
      </div>
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
