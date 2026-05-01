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
import { useUserSystem } from '@/components/ConfigProvider';
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
  if (outcome === 'failed') return 'Failed';
  return 'Completed';
}

export function TaskNotificationsBell() {
  const navigate = useNavigate();
  const { config } = useUserSystem();
  const { notifications, clearTaskNotifications, clearAllNotifications } =
    useTaskNotifications();

  const visibleNotifications = useMemo(() => notifications, [notifications]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 shrink-0"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {config?.notifications.badge_enabled &&
          visibleNotifications.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 h-2 w-2 -translate-x-[6px] translate-y-[6px] rounded-full bg-rose-400"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="px-0 py-0">
            Notifications
          </DropdownMenuLabel>
          {visibleNotifications.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                clearAllNotifications();
              }}
            >
              Clear All
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />

        {visibleNotifications.length === 0 ? (
          <DropdownMenuItem disabled>No recent notifications</DropdownMenuItem>
        ) : (
          visibleNotifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex cursor-pointer items-start gap-2 py-2"
              onClick={() => {
                clearTaskNotifications(
                  notification.projectId,
                  notification.taskId
                );
                navigate(
                  paths.task(notification.projectId, notification.taskId)
                );
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
