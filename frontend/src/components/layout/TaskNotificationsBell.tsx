import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProject } from '@/contexts/ProjectContext';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';
import { paths } from '@/lib/paths';

function formatRelativeTime(timestamp: number) {
  const diffMs = timestamp - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  if (typeof Intl.RelativeTimeFormat !== 'function') {
    return new Date(timestamp).toLocaleString();
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absSec < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, 'day');
}

function outcomeLabel(outcome: 'merged' | 'failed' | 'completed') {
  if (outcome === 'merged') return 'Merged';
  if (outcome === 'failed') return 'Failed';
  return 'Completed';
}

export function TaskNotificationsBell() {
  const navigate = useNavigate();
  const { projectId } = useProject();
  const { notifications, clearTaskNotifications } = useTaskNotifications();

  const projectNotifications = useMemo(
    () =>
      projectId
        ? notifications.filter((notification) => notification.projectId === projectId)
        : [],
    [notifications, projectId]
  );

  if (!projectId) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {projectNotifications.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-rose-400"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {projectNotifications.length === 0 ? (
          <DropdownMenuItem disabled>No recent notifications</DropdownMenuItem>
        ) : (
          projectNotifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex cursor-pointer items-start gap-2 py-2"
              onClick={() => {
                clearTaskNotifications(notification.projectId, notification.taskId);
                navigate(paths.task(notification.projectId, notification.taskId));
              }}
            >
              <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {notification.taskTitle}
                </div>
                <div className="text-xs text-muted-foreground">
                  Attempt {outcomeLabel(notification.outcome)} •{' '}
                  {formatRelativeTime(notification.createdAt)}
                </div>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
