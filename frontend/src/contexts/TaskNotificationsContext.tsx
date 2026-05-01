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
import { ArrowRight, CheckCircle, XCircle } from 'lucide-react';
import {
  type TaskNotificationOutcome,
  type TaskNotificationRecord,
} from '@/lib/api';
import { useUserSystem } from '@/components/ConfigProvider';
import { paths } from '@/lib/paths';
import { useJsonPatchWsStream } from '@/hooks/useJsonPatchWsStream';

export interface TaskNotification {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  outcome: TaskNotificationOutcome;
  createdAt: number;
}

interface TaskNotificationsContextValue {
  notifications: TaskNotification[];
  clearTaskNotifications: (projectId: string, taskId: string) => void;
  clearAllNotifications: () => void;
  resolveNextNotification: () => boolean;
}

interface InAppToast {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  outcome: TaskNotificationOutcome;
}

interface TaskNotificationsStreamState {
  task_notifications: Record<string, TaskNotificationRecord>;
}

type TaskNotificationsCommand =
  | { type: 'clear_task'; project_id: string; task_id: string }
  | { type: 'clear_all' };

const TaskNotificationsContext =
  createContext<TaskNotificationsContextValue | null>(null);

function normalizeOutcome(
  outcome: TaskNotificationOutcome
): TaskNotificationOutcome {
  return outcome === 'failed' ? 'failed' : 'completed';
}

function fromServerNotification(
  record: TaskNotificationRecord
): TaskNotification {
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
  const [notificationsById, setNotificationsById] = useState<
    Record<string, TaskNotification>
  >({});
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const toastTimersRef = useRef<Record<string, number>>({});
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const didHydrateRef = useRef(false);
  const sessionStartedAtRef = useRef(Date.now());
  const currentTaskRoute = useMemo(() => {
    const match = location.pathname.match(
      /^\/projects\/([^/]+)\/tasks\/([^/]+)/
    );
    if (!match) return null;
    return { projectId: match[1], taskId: match[2] };
  }, [location.pathname]);
  const initialStreamData = useCallback(
    (): TaskNotificationsStreamState => ({ task_notifications: {} }),
    []
  );

  const { data: streamData, sendJson } =
    useJsonPatchWsStream<TaskNotificationsStreamState>(
      '/api/task-notifications/stream/ws',
      true,
      initialStreamData
    );

  useEffect(() => {
    if (!streamData) return;

    const nextNotificationsById: Record<string, TaskNotification> = {};
    for (const [id, record] of Object.entries(
      streamData.task_notifications ?? {}
    )) {
      nextNotificationsById[id] = fromServerNotification(record);
    }
    setNotificationsById(nextNotificationsById);
  }, [streamData]);

  const sendCommand = useCallback(
    (command: TaskNotificationsCommand, errorLabel: string) => {
      if (!sendJson(command)) {
        console.error(errorLabel);
      }
    },
    [sendJson]
  );

  const clearTaskNotifications = useCallback(
    (projectId: string, taskId: string) => {
      setNotificationsById((prev) => {
        const next = { ...prev };
        for (const [id, notification] of Object.entries(prev)) {
          if (
            notification.projectId === projectId &&
            notification.taskId === taskId
          ) {
            delete next[id];
          }
        }
        return next;
      });

      sendCommand(
        {
          type: 'clear_task',
          project_id: projectId,
          task_id: taskId,
        },
        'Failed to send clear task notifications command over websocket'
      );
    },
    [sendCommand]
  );

  const clearAllNotifications = useCallback(() => {
    setNotificationsById({});
    sendCommand(
      { type: 'clear_all' },
      'Failed to send clear all notifications command over websocket'
    );
  }, [sendCommand]);

  const resolveNextNotification = useCallback(() => {
    const notifications = Object.values(notificationsById);
    if (notifications.length === 0) return false;

    const oldestNotification = notifications.reduce((oldest, current) =>
      current.createdAt < oldest.createdAt ? current : oldest
    );

    clearTaskNotifications(
      oldestNotification.projectId,
      oldestNotification.taskId
    );
    navigate(
      paths.attempt(
        oldestNotification.projectId,
        oldestNotification.taskId,
        'latest'
      )
    );
    return true;
  }, [clearTaskNotifications, navigate, notificationsById]);

  const removeToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    const timerId = toastTimersRef.current[toastId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete toastTimersRef.current[toastId];
    }
  }, []);

  const showInAppToast = useCallback(
    (notification: TaskNotification) => {
      const toast: InAppToast = {
        id: notification.id,
        projectId: notification.projectId,
        taskId: notification.taskId,
        title: notification.taskTitle,
        outcome: notification.outcome,
      };

      setToasts((prev) => [toast, ...prev.slice(0, 4)]);
      const timerId = window.setTimeout(() => removeToast(toast.id), 5000);
      toastTimersRef.current[toast.id] = timerId;
    },
    [removeToast]
  );

  const showBrowserNotification = useCallback(
    async (notification: TaskNotification) => {
      if (!('Notification' in window)) return;

      const title = notificationTitle(notification);

      const create = () => {
        const browserNotification = new Notification(title);
        browserNotification.onclick = () => {
          window.vibeKanban?.focusAppWindow();
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

  useEffect(() => {
    const notifications = Object.values(notificationsById);

    if (!didHydrateRef.current) {
      for (const notification of notifications) {
        seenNotificationIdsRef.current.add(notification.id);
      }
      didHydrateRef.current = true;
      return;
    }

    const newlyAdded = notifications.filter(
      (notification) => !seenNotificationIdsRef.current.has(notification.id)
    );

    if (!newlyAdded.length) return;

    for (const notification of newlyAdded) {
      seenNotificationIdsRef.current.add(notification.id);

      const isFromCurrentSession =
        notification.createdAt > sessionStartedAtRef.current;
      if (!isFromCurrentSession) {
        continue;
      }

      const isCurrentTask =
        currentTaskRoute &&
        currentTaskRoute.projectId === notification.projectId &&
        currentTaskRoute.taskId === notification.taskId;

      if (isCurrentTask && isAppFocused()) {
        clearTaskNotifications(notification.projectId, notification.taskId);
        continue;
      }

      if (isAppFocused()) {
        if (config?.notifications.toast_enabled) {
          showInAppToast(notification);
        }
      } else if (config?.notifications.system_enabled) {
        void showBrowserNotification(notification);
      }
    }
  }, [
    notificationsById,
    currentTaskRoute,
    clearTaskNotifications,
    config?.notifications.system_enabled,
    config?.notifications.toast_enabled,
    showBrowserNotification,
    showInAppToast,
  ]);

  useEffect(() => {
    if (!currentTaskRoute) return;
    clearTaskNotifications(currentTaskRoute.projectId, currentTaskRoute.taskId);
  }, [currentTaskRoute, clearTaskNotifications]);

  const notifications = useMemo(
    () =>
      Object.values(notificationsById).sort(
        (a, b) => b.createdAt - a.createdAt
      ),
    [notificationsById]
  );

  const value = useMemo(
    () => ({
      notifications,
      clearTaskNotifications,
      clearAllNotifications,
      resolveNextNotification,
    }),
    [
      notifications,
      clearTaskNotifications,
      clearAllNotifications,
      resolveNextNotification,
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
            className="group pointer-events-auto rounded-md border border-border bg-background px-4 py-3 text-left shadow-md transition hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              {toast.outcome === 'failed' ? (
                <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
              ) : (
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {toast.title}
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
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
