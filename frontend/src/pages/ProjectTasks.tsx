import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Plus } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { attemptsApi, tasksApi } from '@/lib/api';
import { openTaskForm } from '@/lib/openTaskForm';
import { ConfirmDialog } from '@/components/dialogs/shared/ConfirmDialog';
import { DoneCleanupDialog } from '@/components/dialogs/tasks/DoneCleanupDialog';
import { useUserSystem } from '@/components/ConfigProvider';

import { useSearch } from '@/contexts/SearchContext';
import { useProject } from '@/contexts/ProjectContext';
import { useProjectBranches } from '@/hooks/useProjectBranches';
import { useTaskAttempts } from '@/hooks/useTaskAttempts';
import { useTaskAttempt } from '@/hooks/useTaskAttempt';
import { useBranchStatus, useAttemptExecution } from '@/hooks';
import { paths } from '@/lib/paths';
import { isUnderlyingRepoNotDetectedError } from '@/lib/repositoryErrors';
import { ExecutionProcessesProvider } from '@/contexts/ExecutionProcessesContext';
import { DiffStreamProvider } from '@/contexts/DiffStreamContext';
import { ClickedElementsProvider } from '@/contexts/ClickedElementsProvider';
import { ReviewProvider } from '@/contexts/ReviewProvider';
import {
  GitOperationsProvider,
  useGitOperationsError,
} from '@/contexts/GitOperationsContext';
import {
  useKeyCreate,
  useKeyEditTask,
  useKeyNextNotification,
  useKeyExit,
  useKeyFocusSearch,
  Scope,
} from '@/keyboard';

import TaskKanbanBoard, {
  type KanbanColumnItem,
} from '@/components/tasks/TaskKanbanBoard';
import type {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
} from '@/components/ui/shadcn-io/kanban';
import { useProjectTasks } from '@/hooks/useProjectTasks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { TasksLayout, type LayoutMode } from '@/components/layout/TasksLayout';
import { PreviewPanel } from '@/components/panels/PreviewPanel';
import { DiffsPanel } from '@/components/panels/DiffsPanel';
import TaskAttemptPanel from '@/components/panels/TaskAttemptPanel';
import TodoPanel from '@/components/tasks/TodoPanel';
import { NewCard, NewCardHeader } from '@/components/ui/new-card';
import { AttemptHeaderActions } from '@/components/panels/AttemptHeaderActions';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';
import { ProjectTasksSnapshotProvider } from '@/contexts/ProjectTasksSnapshotContext';
import type { GitOperationsInputs } from '@/components/tasks/Toolbar/GitOperations';

import type {
  TaskAttempt,
  TaskWithAttemptStatus,
  TaskStatus,
} from 'shared/types';

type Task = TaskWithAttemptStatus;
type DropPreview = {
  status: TaskStatus;
  index: number;
  height?: number | null;
} | null;

const TASK_STATUSES = [
  'todo',
  'inprogress',
  'inreview',
  'done',
  'cancelled',
] as const;
const AUTO_DONE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const SAME_STATUS_DUPLICATE_MIN_DISTANCE_PX = 36;

const normalizeStatus = (status: string): TaskStatus =>
  status.toLowerCase() as TaskStatus;

const getDragDistance = (delta: DragEndEvent['delta']) =>
  Math.hypot(delta.x, delta.y);

const resolveDropStatus = (
  overId: string,
  tasksById: Record<string, Task>
): TaskStatus | null => {
  if (TASK_STATUSES.includes(overId as TaskStatus)) {
    return normalizeStatus(overId);
  }

  const overTask = tasksById[overId];
  if (!overTask) {
    return null;
  }

  return normalizeStatus(overTask.status);
};

function GitErrorBanner() {
  const { error: gitError } = useGitOperationsError();

  if (!gitError) return null;

  return (
    <div className="mx-4 mt-4 p-3 border border-destructive rounded">
      <div className="text-destructive text-sm">{gitError}</div>
    </div>
  );
}

function AttemptHeaderActionsWithGitOps({
  mode,
  onModeChange,
  task,
  attempt,
  gitOps,
  attemptSwitcher,
  onClose,
}: {
  mode: LayoutMode;
  onModeChange: (mode: LayoutMode) => void;
  task: TaskWithAttemptStatus;
  attempt: NonNullable<ReturnType<typeof useTaskAttempt>['data']>;
  gitOps?: Omit<GitOperationsInputs, 'isAttemptRunning'>;
  attemptSwitcher?: ReactNode;
  onClose: () => void;
}) {
  const { isAttemptRunning } = useAttemptExecution(attempt?.id);

  return (
    <AttemptHeaderActions
      mode={mode}
      onModeChange={onModeChange}
      task={task}
      attempt={attempt}
      gitOps={gitOps ? { ...gitOps, isAttemptRunning } : undefined}
      attemptSwitcher={attemptSwitcher}
      onClose={onClose}
    />
  );
}

export function ProjectTasks() {
  const { taskId, attemptId } = useParams<{
    projectId: string;
    taskId?: string;
    attemptId?: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { enableScope, disableScope } = useHotkeysContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dropPreview, setDropPreview] = useState<DropPreview>(null);
  const [duplicateOnDrop, setDuplicateOnDrop] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [optimisticStatusByTaskId, setOptimisticStatusByTaskId] = useState<
    Record<string, TaskStatus>
  >({});
  const [stopInFlightByTaskId, setStopInFlightByTaskId] = useState<
    Record<string, true>
  >({});

  const {
    projectId,
    isLoading: projectLoading,
    error: projectError,
  } = useProject();

  useEffect(() => {
    enableScope(Scope.KANBAN);

    return () => {
      disableScope(Scope.KANBAN);
    };
  }, [enableScope, disableScope]);

  const handleCreateTask = useCallback(() => {
    if (projectId) {
      openTaskForm({ mode: 'create', projectId });
    }
  }, [projectId]);
  const { query: searchQuery, focusInput } = useSearch();

  const {
    tasks: rawTasks,
    tasksById: rawTasksById,
    isLoading,
    isConnected,
  } = useProjectTasks(projectId || '');
  const { clearTaskNotifications, resolveNextNotification } =
    useTaskNotifications();

  const tasksById = useMemo(() => {
    if (Object.keys(optimisticStatusByTaskId).length === 0) {
      return rawTasksById;
    }

    const next: Record<string, TaskWithAttemptStatus> = { ...rawTasksById };
    Object.entries(optimisticStatusByTaskId).forEach(([id, status]) => {
      const task = next[id];
      if (!task || task.status === status) {
        return;
      }
      next[id] = { ...task, status };
    });
    return next;
  }, [rawTasksById, optimisticStatusByTaskId]);

  const tasks = useMemo(() => {
    if (Object.keys(optimisticStatusByTaskId).length === 0) {
      return rawTasks;
    }

    return rawTasks.map((task) => {
      const status = optimisticStatusByTaskId[task.id];
      if (!status || task.status === status) {
        return task;
      }
      return { ...task, status };
    });
  }, [rawTasks, optimisticStatusByTaskId]);

  useEffect(() => {
    if (Object.keys(optimisticStatusByTaskId).length === 0) {
      return;
    }

    setOptimisticStatusByTaskId((prev) => {
      const next = { ...prev };
      let changed = false;

      Object.entries(prev).forEach(([taskId, status]) => {
        if (stopInFlightByTaskId[taskId]) {
          return;
        }
        const task = rawTasksById[taskId];
        if (!task || task.status === status) {
          delete next[taskId];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [rawTasksById, optimisticStatusByTaskId, stopInFlightByTaskId]);

  const selectedTask = useMemo(
    () => (taskId ? (tasksById[taskId] ?? null) : null),
    [taskId, tasksById]
  );
  const hasCurrentProjectTasksSnapshot = useMemo(() => {
    if (!projectId) return false;

    const allTasks = Object.values(tasksById);
    if (allTasks.length === 0) {
      // Wait for the new project's stream to connect before deciding
      // whether a task route should fall back to the board.
      return isConnected;
    }

    return allTasks.every((task) => task.project_id === projectId);
  }, [projectId, tasksById, isConnected]);

  useEffect(() => {
    if (!projectId || !selectedTask) return;
    clearTaskNotifications(projectId, selectedTask.id);
  }, [projectId, selectedTask, clearTaskNotifications]);

  const isPanelOpen = Boolean(taskId && attemptId);
  const { config, updateAndSaveConfig } = useUserSystem();

  const isLatest = attemptId === 'latest';
  const effectiveAttemptId = attemptId === 'latest' ? undefined : attemptId;
  const {
    data: attempts = [],
    isLoading: isAttemptsLoading,
    isFetching: isAttemptsFetching,
  } = useTaskAttempts(taskId, {
    enabled: !!taskId && (isLatest || !!effectiveAttemptId),
  });

  const attemptsNewestFirst = useMemo(
    () =>
      [...attempts].sort((a, b) => {
        const diff =
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      }),
    [attempts]
  );

  const latestAttemptId = useMemo(() => {
    if (!attemptsNewestFirst.length) return undefined;
    return attemptsNewestFirst[0].id;
  }, [attemptsNewestFirst]);

  const attemptNumberById = useMemo(() => {
    return new Map(
      [...attemptsNewestFirst]
        .reverse()
        .map((taskAttempt, index) => [taskAttempt.id, index + 1])
    );
  }, [attemptsNewestFirst]);

  const attemptDropdownItems = useMemo(
    () =>
      [...attemptsNewestFirst].reverse().map((taskAttempt) => ({
        id: taskAttempt.id,
        label: `Attempt ${attemptNumberById.get(taskAttempt.id) ?? '?'}`,
      })),
    [attemptNumberById, attemptsNewestFirst]
  );

  const navigateWithSearch = useCallback(
    (pathname: string, options?: { replace?: boolean }) => {
      const search = searchParams.toString();
      navigate({ pathname, search: search ? `?${search}` : '' }, options);
    },
    [navigate, searchParams]
  );

  const navigateToAttemptDiffs = useCallback(
    (pathname: string, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams);
      params.set('view', 'diffs');
      const search = params.toString();
      navigate({ pathname, search: search ? `?${search}` : '' }, options);
    },
    [navigate, searchParams]
  );

  useEffect(() => {
    if (!projectId || !taskId) return;
    if (!isLatest) return;
    if (isAttemptsLoading || isAttemptsFetching) return;

    if (!latestAttemptId) {
      navigateWithSearch(paths.task(projectId, taskId), { replace: true });
      return;
    }

    navigateToAttemptDiffs(paths.attempt(projectId, taskId, latestAttemptId), {
      replace: true,
    });
  }, [
    projectId,
    taskId,
    isLatest,
    isAttemptsLoading,
    isAttemptsFetching,
    latestAttemptId,
    navigateWithSearch,
    navigateToAttemptDiffs,
  ]);

  useEffect(() => {
    if (!projectId || !taskId || isLoading) return;
    if (!hasCurrentProjectTasksSnapshot) return;
    if (selectedTask === null) {
      navigate(`/projects/${projectId}/tasks`, { replace: true });
    }
  }, [
    projectId,
    taskId,
    isLoading,
    hasCurrentProjectTasksSnapshot,
    selectedTask,
    navigate,
  ]);

  const isTaskView = !!taskId && !effectiveAttemptId;
  const { data: attempt, isLoading: isAttemptLoading } =
    useTaskAttempt(effectiveAttemptId);
  const taskRouteResolutionRef = useRef<string | null>(null);
  const skipNextAutomaticDoneCleanupRef = useRef<Record<string, true>>({});
  const doneCleanupDays = Math.max(0, config?.done_task_cleanup_days ?? 0);
  const automaticDoneCleanupByProject = useMemo(
    () => config?.automatic_done_task_cleanup_days_by_project ?? {},
    [config?.automatic_done_task_cleanup_days_by_project]
  );
  const automaticDoneCleanupDaysForProject = projectId
    ? automaticDoneCleanupByProject[projectId]
    : undefined;

  const { data: branchStatus } = useBranchStatus(attempt?.id);
  const { data: branches = [], error: projectBranchesError } =
    useProjectBranches(projectId);

  const rawMode = searchParams.get('view') as LayoutMode;
  const mode: LayoutMode =
    rawMode === 'preview' || rawMode === 'diffs' ? rawMode : null;

  // TODO: Remove this redirect after v0.1.0 (legacy URL support for bookmarked links)
  // Migrates old `view=logs` to `view=diffs`
  useEffect(() => {
    const view = searchParams.get('view');
    if (view === 'logs') {
      const params = new URLSearchParams(searchParams);
      params.set('view', 'diffs');
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const setMode = useCallback(
    (newMode: LayoutMode) => {
      const params = new URLSearchParams(searchParams);
      if (newMode === null) {
        params.delete('view');
      } else {
        params.set('view', newMode);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleCreateNewTask = useCallback(() => {
    handleCreateTask();
  }, [handleCreateTask]);

  const handleEditSelectedTask = useCallback(() => {
    if (!projectId || !selectedTask) return;
    if (!taskId) return;

    openTaskForm({ mode: 'edit', projectId, task: selectedTask });
  }, [projectId, selectedTask, taskId]);

  useKeyCreate(handleCreateNewTask, {
    scope: Scope.KANBAN,
    preventDefault: true,
  });

  useKeyEditTask(handleEditSelectedTask, {
    scope: Scope.KANBAN,
    when: Boolean(taskId && selectedTask),
    preventDefault: true,
  });

  useKeyNextNotification(
    () => {
      resolveNextNotification();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyFocusSearch(
    () => {
      focusInput();
    },
    {
      scope: Scope.KANBAN,
      when: !isPanelOpen,
      preventDefault: true,
    }
  );

  useKeyExit(
    () => {
      if (isPanelOpen) {
        handleClosePanel();
        return;
      }

      navigate(paths.projects(), { replace: true });
    },
    {
      scope: Scope.KANBAN,
      enableOnFormTags: true,
    }
  );

  const hasSearch = Boolean(searchQuery.trim());
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const kanbanColumns = useMemo(() => {
    const columns: Record<TaskStatus, KanbanColumnItem[]> = {
      todo: [],
      inprogress: [],
      inreview: [],
      done: [],
      cancelled: [],
    };

    const matchesSearch = (
      title: string,
      description?: string | null
    ): boolean => {
      if (!hasSearch) return true;
      const lowerTitle = title.toLowerCase();
      const lowerDescription = description?.toLowerCase() ?? '';
      return (
        lowerTitle.includes(normalizedSearch) ||
        lowerDescription.includes(normalizedSearch)
      );
    };

    tasks.forEach((task) => {
      const statusKey = normalizeStatus(task.status);

      if (!matchesSearch(task.title, task.description)) {
        return;
      }

      columns[statusKey].push({
        type: 'task',
        task,
      });
    });

    const getTimestamp = (item: KanbanColumnItem) => {
      return new Date(item.task.updated_at).getTime();
    };

    TASK_STATUSES.forEach((status) => {
      columns[status].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    });

    return columns;
  }, [hasSearch, normalizedSearch, tasks]);

  const doneTasks = useMemo(
    () => tasks.filter((task) => normalizeStatus(task.status) === 'done'),
    [tasks]
  );

  const visibleTasksByStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      inprogress: [],
      inreview: [],
      done: [],
      cancelled: [],
    };

    TASK_STATUSES.forEach((status) => {
      map[status] = kanbanColumns[status]
        .filter((item) => item.type === 'task')
        .map((item) => item.task);
    });

    return map;
  }, [kanbanColumns]);

  const hasVisibleLocalTasks = useMemo(
    () =>
      Object.values(visibleTasksByStatus).some(
        (items) => items && items.length > 0
      ),
    [visibleTasksByStatus]
  );
  const doneTasksRef = useRef(doneTasks);

  useEffect(() => {
    doneTasksRef.current = doneTasks;
  }, [doneTasks]);

  const handleClosePanel = useCallback(() => {
    if (projectId) {
      navigate(`/projects/${projectId}/tasks`, { replace: true });
    }
  }, [projectId, navigate]);

  const handleMergeSuccess = useCallback(() => {
    handleClosePanel();
  }, [handleClosePanel]);

  const handleViewTaskDetails = useCallback(
    async (task: Task, attemptIdToShow?: string) => {
      if (!projectId) return;

      try {
        if (attemptIdToShow) {
          navigateToAttemptDiffs(
            paths.attempt(projectId, task.id, attemptIdToShow)
          );
          return;
        }

        const existingAttempts = await attemptsApi.getAll(task.id);
        if (existingAttempts.length === 0) {
          openTaskForm({ mode: 'edit', projectId, task });
          return;
        }

        navigateToAttemptDiffs(
          `${paths.task(projectId, task.id)}/attempts/latest`
        );
      } catch (error) {
        console.error('Failed to open task details:', error);
      }
    },
    [projectId, navigateToAttemptDiffs]
  );

  useEffect(() => {
    if (!projectId || !isTaskView || !selectedTask) return;
    if (taskRouteResolutionRef.current === selectedTask.id) return;

    taskRouteResolutionRef.current = selectedTask.id;

    void (async () => {
      try {
        const existingAttempts = await attemptsApi.getAll(selectedTask.id);
        if (existingAttempts.length === 0) {
          openTaskForm({ mode: 'edit', projectId, task: selectedTask });
          navigate(paths.projectTasks(projectId), { replace: true });
          return;
        }

        navigateToAttemptDiffs(
          `${paths.task(projectId, selectedTask.id)}/attempts/latest`,
          { replace: true }
        );
      } catch (error) {
        console.error('Failed to resolve task attempt for navigation:', error);
      }
    })();
  }, [isTaskView, navigate, navigateToAttemptDiffs, projectId, selectedTask]);

  const handleDoneCleanup = useCallback(async () => {
    const deleteDoneTasksOlderThanDays = async (cleanupDays: number) => {
      const cutoffTime = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
      const tasksToDelete = doneTasks.filter(
        (task) => new Date(task.updated_at).getTime() <= cutoffTime
      );

      if (tasksToDelete.length === 0) {
        return { attempted: 0, failed: 0 };
      }

      const results = await Promise.allSettled(
        tasksToDelete.map((task) => tasksApi.delete(task.id))
      );

      const failedCount = results.filter(
        (resultItem) => resultItem.status === 'rejected'
      ).length;
      return { attempted: tasksToDelete.length, failed: failedCount };
    };

    const saveAutomaticCleanup = async ({
      enabled,
      olderThanDays,
    }: {
      enabled: boolean;
      olderThanDays: number;
    }) => {
      if (!projectId) {
        return;
      }
      const automaticCleanupDays = Math.max(0, Math.floor(olderThanDays));
      const nextByProject = { ...automaticDoneCleanupByProject };

      if (!enabled) {
        delete nextByProject[projectId];
      } else {
        skipNextAutomaticDoneCleanupRef.current[projectId] = true;
        nextByProject[projectId] = automaticCleanupDays;
      }

      await updateAndSaveConfig({
        automatic_done_task_cleanup_days_by_project: nextByProject,
      });
    };

    const result = await DoneCleanupDialog.show({
      defaultDays: doneCleanupDays,
      doneTasks: doneTasks.map((task) => ({
        id: task.id,
        updated_at: task.updated_at,
      })),
      automaticCleanupEnabled:
        typeof automaticDoneCleanupDaysForProject === 'number',
      automaticCleanupDays:
        typeof automaticDoneCleanupDaysForProject === 'number'
          ? automaticDoneCleanupDaysForProject
          : doneCleanupDays,
      onSaveAutomaticCleanup: saveAutomaticCleanup,
    }).finally(() => {
      DoneCleanupDialog.hide();
    });

    if (result.status !== 'confirmed') {
      return;
    }

    const cleanupDays = Math.max(0, Math.floor(result.olderThanDays));
    const currentDoneCleanupDays = config?.done_task_cleanup_days;
    if (currentDoneCleanupDays !== cleanupDays) {
      void updateAndSaveConfig({
        done_task_cleanup_days: cleanupDays,
      });
    }

    const { attempted, failed } =
      await deleteDoneTasksOlderThanDays(cleanupDays);
    if (attempted === 0) {
      return;
    }
    if (failed > 0) {
      console.error(
        `Done cleanup deleted ${attempted - failed}/${attempted} tasks`
      );
    }
  }, [
    automaticDoneCleanupByProject,
    automaticDoneCleanupDaysForProject,
    config,
    doneCleanupDays,
    doneTasks,
    projectId,
    updateAndSaveConfig,
  ]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    if (typeof automaticDoneCleanupDaysForProject !== 'number') {
      return;
    }

    const runAutomaticDoneCleanup = async () => {
      if (skipNextAutomaticDoneCleanupRef.current[projectId]) {
        delete skipNextAutomaticDoneCleanupRef.current[projectId];
        return;
      }

      const cleanupDays = Math.max(
        0,
        Math.floor(automaticDoneCleanupDaysForProject)
      );
      const cutoffTime = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
      const tasksToDelete = doneTasksRef.current.filter(
        (task) => new Date(task.updated_at).getTime() <= cutoffTime
      );

      if (tasksToDelete.length === 0) {
        return;
      }

      const results = await Promise.allSettled(
        tasksToDelete.map((task) => tasksApi.delete(task.id))
      );
      const failedCount = results.filter(
        (resultItem) => resultItem.status === 'rejected'
      ).length;
      if (failedCount > 0) {
        console.error(
          `Automatic done cleanup deleted ${tasksToDelete.length - failedCount}/${tasksToDelete.length} tasks for project ${projectId}`
        );
      }
    };

    void runAutomaticDoneCleanup();
    const intervalId = window.setInterval(() => {
      void runAutomaticDoneCleanup();
    }, AUTO_DONE_CLEANUP_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [automaticDoneCleanupDaysForProject, projectId]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDropPreview(null);
      setDraggingTaskId(null);
      const { active, over } = event;
      const shouldDuplicate = duplicateOnDrop;
      if (!active.data.current) {
        setDuplicateOnDrop(false);
        return;
      }

      const draggedTaskId = active.id as string;
      const task = tasksById[draggedTaskId];
      if (!task) {
        setDuplicateOnDrop(false);
        return;
      }
      const fallbackStatus = normalizeStatus(task.status);
      const newStatus = over
        ? resolveDropStatus(String(over.id), tasksById)
        : shouldDuplicate
          ? fallbackStatus
          : null;
      if (!newStatus) {
        setDuplicateOnDrop(false);
        return;
      }

      const isSameStatus = task.status === newStatus;
      if (isSameStatus) {
        if (
          !shouldDuplicate ||
          getDragDistance(event.delta) < SAME_STATUS_DUPLICATE_MIN_DISTANCE_PX
        ) {
          setDuplicateOnDrop(false);
          return;
        }
      }

      if (shouldDuplicate) {
        try {
          await tasksApi.create({
            project_id: task.project_id,
            title: task.title,
            description: task.description,
            status: newStatus,
            parent_task_attempt: task.parent_task_attempt,
            image_ids: null,
          });
        } catch (err) {
          console.error('Failed to duplicate task via shift-drag:', err);
        } finally {
          setDuplicateOnDrop(false);
        }
        return;
      }

      const shouldStopAgent =
        task.status === 'inprogress' &&
        newStatus !== 'inprogress' &&
        task.has_in_progress_attempt;

      try {
        if (shouldStopAgent) {
          setStopInFlightByTaskId((prev) => ({
            ...prev,
            [draggedTaskId]: true,
          }));
        }

        const shouldAutoStartAttempt =
          newStatus === 'inprogress' &&
          !!projectId &&
          !!config?.executor_profile;
        let existingAttempts = null;

        const confirmNewAttemptWarning = async (): Promise<boolean> => {
          let dontShowAgain = false;
          const confirmResult = await ConfirmDialog.show({
            title: 'Start a new attempt?',
            message:
              "This task already has an attempt. If you're looking to continue this conversation, do so in the chat window.",
            confirmText: 'Start New Attempt',
            cancelText: 'Cancel',
            variant: 'destructive',
            checkboxLabel: "Don't show again",
            onCheckboxChange: (checked) => {
              dontShowAgain = checked;
            },
          }).finally(() => {
            ConfirmDialog.hide();
          });

          if (confirmResult !== 'confirmed') {
            return false;
          }

          if (dontShowAgain) {
            void updateAndSaveConfig({
              show_new_attempt_drag_warning: false,
            });
          }

          return true;
        };

        if (shouldAutoStartAttempt) {
          try {
            existingAttempts = await attemptsApi.getAll(task.id);
          } catch (error) {
            console.warn(
              'Failed to load attempts before status update; continuing without pre-confirmation:',
              error
            );
          }

          if (
            existingAttempts &&
            existingAttempts.length > 0 &&
            config.show_new_attempt_drag_warning
          ) {
            const confirmed = await confirmNewAttemptWarning();
            if (!confirmed) {
              return;
            }
          }
        }

        setOptimisticStatusByTaskId((prev) => ({
          ...prev,
          [draggedTaskId]: newStatus,
        }));

        const updateTaskStatus = () =>
          tasksApi.update(draggedTaskId, {
            title: task.title,
            description: task.description,
            status: newStatus,
            parent_task_attempt: task.parent_task_attempt,
            image_ids: null,
          });

        clearTaskNotifications(task.project_id, task.id);
        await updateTaskStatus();

        if (shouldStopAgent) {
          void (async () => {
            try {
              const attempts = await attemptsApi.getAll(task.id);
              const runningAttempt = attempts[0];
              if (!runningAttempt) {
                return;
              }

              await attemptsApi.stop(runningAttempt.id);

              // Stopping execution sets task status to inreview server-side.
              // Re-apply the user's drop target for other destinations.
              if (newStatus !== 'inreview') {
                await updateTaskStatus();
              }
            } catch (stopError) {
              console.error(
                'Failed to stop running attempt after drag:',
                stopError
              );
            } finally {
              setStopInFlightByTaskId((prev) => {
                const next = { ...prev };
                delete next[draggedTaskId];
                return next;
              });
            }
          })();
        }

        if (!shouldAutoStartAttempt) {
          return;
        }

        if (!existingAttempts) {
          existingAttempts = await attemptsApi.getAll(task.id);
        }

        const latestAttempt =
          existingAttempts.length === 0
            ? null
            : [...existingAttempts].sort((a, b) => {
                const diff =
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime();
                if (diff !== 0) return diff;
                return a.id.localeCompare(b.id);
              })[0];

        let parentBranch: string | null = null;
        if (task.parent_task_attempt) {
          try {
            const parentAttempt = await attemptsApi.get(
              task.parent_task_attempt
            );
            parentBranch = parentAttempt.branch ?? null;
          } catch (err) {
            console.warn('Failed to load parent attempt branch:', err);
          }
        }

        const currentBranchName =
          branches.find((branch) => branch.is_current)?.name ?? null;
        const baseBranch =
          parentBranch ??
          currentBranchName ??
          latestAttempt?.target_branch ??
          latestAttempt?.branch ??
          null;

        if (!baseBranch) {
          console.warn(
            'Skipping auto-start attempt because no default base branch could be determined'
          );
          return;
        }

        const createdAttempt = await attemptsApi.create({
          task_id: task.id,
          executor_profile_id: config.executor_profile,
          base_branch: baseBranch,
        });

        queryClient.setQueryData(
          ['taskAttempts', task.id],
          (old: TaskAttempt[] | undefined) => {
            if (!old || old.length === 0) return [createdAttempt];
            const withoutCreated = old.filter(
              (attempt) => attempt.id !== createdAttempt.id
            );
            return [createdAttempt, ...withoutCreated];
          }
        );
      } catch (err) {
        if (shouldStopAgent) {
          setStopInFlightByTaskId((prev) => {
            const next = { ...prev };
            delete next[draggedTaskId];
            return next;
          });
        }
        setOptimisticStatusByTaskId((prev) => {
          const next = { ...prev };
          delete next[draggedTaskId];
          return next;
        });
        console.error(
          'Failed to update task status / auto-start attempt:',
          err
        );
      } finally {
        setDuplicateOnDrop(false);
      }
    },
    [
      branches,
      config?.executor_profile,
      config?.show_new_attempt_drag_warning,
      clearTaskNotifications,
      duplicateOnDrop,
      projectId,
      tasksById,
      queryClient,
      updateAndSaveConfig,
    ]
  );

  const clearDropPreview = useCallback(() => {
    setDropPreview(null);
    setDuplicateOnDrop(false);
    setDraggingTaskId(null);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDropPreview(null);
    setDraggingTaskId(String(event.active.id));
    const activatorEvent = event.activatorEvent;
    if (activatorEvent instanceof MouseEvent) {
      setDuplicateOnDrop(activatorEvent.shiftKey);
      return;
    }
    if (activatorEvent instanceof PointerEvent) {
      setDuplicateOnDrop(activatorEvent.shiftKey);
      return;
    }
    setDuplicateOnDrop(false);
  }, []);

  const handleDragOver = useCallback(
    (event: Pick<DragMoveEvent, 'active' | 'over' | 'delta'>) => {
      const { active, over, delta } = event;
      const activeTaskId = active.id as string;
      const task = tasksById[activeTaskId];
      if (!task) {
        setDropPreview(null);
        return;
      }

      const dragDistance = getDragDistance(delta);
      if (
        duplicateOnDrop &&
        dragDistance < SAME_STATUS_DUPLICATE_MIN_DISTANCE_PX
      ) {
        setDropPreview(null);
        return;
      }

      const fallbackStatus = normalizeStatus(task.status);
      const targetStatus = over
        ? resolveDropStatus(String(over.id), tasksById)
        : duplicateOnDrop
          ? fallbackStatus
          : null;
      if (!targetStatus) {
        setDropPreview(null);
        return;
      }
      const currentStatus = normalizeStatus(task.status);
      const isSameStatusDuplicate =
        duplicateOnDrop &&
        targetStatus === currentStatus &&
        dragDistance >= SAME_STATUS_DUPLICATE_MIN_DISTANCE_PX;

      if (targetStatus === currentStatus && !isSameStatusDuplicate) {
        setDropPreview(null);
        return;
      }

      const draggedUpdatedAt = new Date(task.updated_at).getTime();
      const targetItems = kanbanColumns[targetStatus].filter(
        (item) => item.task.id !== activeTaskId
      );

      let insertIndex = targetItems.length;
      for (let i = 0; i < targetItems.length; i++) {
        const itemTimestamp = new Date(
          targetItems[i].task.updated_at
        ).getTime();
        if (draggedUpdatedAt > itemTimestamp) {
          insertIndex = i;
          break;
        }
      }

      const previewIndex = isSameStatusDuplicate
        ? insertIndex + 1
        : insertIndex;

      setDropPreview((prev) => {
        const nextHeight = active.rect.current.initial?.height ?? prev?.height;
        if (
          prev &&
          prev.status === targetStatus &&
          prev.index === previewIndex &&
          prev.height === nextHeight
        ) {
          return prev;
        }

        return {
          status: targetStatus,
          index: previewIndex,
          height: nextHeight,
        };
      });
    },
    [duplicateOnDrop, kanbanColumns, tasksById]
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      handleDragOver(event);
    },
    [handleDragOver]
  );

  const isInitialTasksLoad = isLoading && tasks.length === 0;
  const isUnderlyingRepoMissing =
    isUnderlyingRepoNotDetectedError(projectBranchesError);

  if (isUnderlyingRepoMissing && projectId) {
    return (
      <Navigate to={paths.projectRepositoryNotDetected(projectId)} replace />
    );
  }

  if (projectError) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            Error
          </AlertTitle>
          <AlertDescription>
            {projectError.message || 'Failed to load project'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (projectLoading && isInitialTasksLoad) {
    return <Loader message="Loading tasks..." size={32} className="py-8" />;
  }

  const kanbanContent =
    tasks.length === 0 && !isConnected ? (
      <div className="max-w-7xl mx-auto mt-8">
        <Card>
          <CardContent className="py-10">
            <Loader
              message="Connecting to backend..."
              size={28}
              className="py-2"
            />
            <p className="text-center text-sm text-muted-foreground mt-2">
              Waiting for the backend connection to be established before
              loading tasks.
            </p>
          </CardContent>
        </Card>
      </div>
    ) : tasks.length === 0 ? (
      <div className="max-w-7xl mx-auto mt-8">
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">
              No tasks found for this project.
            </p>
            <Button className="mt-4" onClick={handleCreateNewTask}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Task
            </Button>
          </CardContent>
        </Card>
      </div>
    ) : !hasVisibleLocalTasks ? (
      <div className="max-w-7xl mx-auto mt-8">
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">No tasks match your search.</p>
          </CardContent>
        </Card>
      </div>
    ) : (
      <div className="w-full h-full overflow-x-auto overflow-y-auto overscroll-x-contain">
        <TaskKanbanBoard
          columns={kanbanColumns}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragCancel={clearDropPreview}
          onViewTaskDetails={handleViewTaskDetails}
          selectedTaskId={selectedTask?.id}
          onCreateTask={handleCreateNewTask}
          onDoneCleanup={handleDoneCleanup}
          disableDoneCleanup={doneTasks.length === 0}
          projectId={projectId!}
          dropPreview={dropPreview}
          duplicateDragTaskId={draggingTaskId}
          duplicateDragActive={duplicateOnDrop}
        />
      </div>
    );

  const effectiveMode: LayoutMode = mode ?? (attempt ? 'diffs' : null);
  const headerGitOps =
    attempt && projectId
      ? {
          projectId,
          branchStatus: branchStatus ?? null,
          branches,
          selectedBranch: branchStatus?.target_branch_name ?? null,
          onMergeSuccess: handleMergeSuccess,
        }
      : undefined;

  const rightHeader =
    selectedTask && attempt ? (
      <NewCardHeader
        className="shrink-0"
        actions={
          <AttemptHeaderActionsWithGitOps
            mode={effectiveMode}
            onModeChange={setMode}
            task={selectedTask}
            attempt={attempt}
            gitOps={headerGitOps}
            attemptSwitcher={
              attemptDropdownItems.length > 1 ? (
                <Select
                  value={
                    attemptDropdownItems.some((item) => item.id === attempt.id)
                      ? attempt.id
                      : undefined
                  }
                  onValueChange={(nextAttemptId) => {
                    if (!projectId) return;
                    navigateWithSearch(
                      paths.attempt(projectId, selectedTask.id, nextAttemptId)
                    );
                  }}
                >
                  <SelectTrigger
                    aria-label="Select attempt"
                    className="h-8 w-auto min-w-[7rem] shrink-0 px-2 pr-1.5"
                  >
                    <SelectValue
                      placeholder={`Attempt ${attemptNumberById.get(attempt.id) ?? '?'}`}
                    />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {attemptDropdownItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
            onClose={() =>
              navigate(`/projects/${projectId}/tasks`, { replace: true })
            }
          />
        }
      >
        <div className="mx-auto w-full">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1 truncate text-base md:text-lg font-semibold text-left">
              {selectedTask.title || 'Task'}
            </div>
          </div>
        </div>
      </NewCardHeader>
    ) : null;

  const attemptContent =
    taskId && attemptId ? (
      <NewCard className="h-full min-h-0 flex flex-col bg-diagonal-lines bg-muted border-0">
        {isAttemptLoading && !attempt ? (
          <div className="h-full flex items-center justify-center p-6">
            <Loader message="Loading..." />
          </div>
        ) : (
          <TaskAttemptPanel attempt={attempt} task={selectedTask}>
            {({ logs, followUp }) => (
              <>
                <GitErrorBanner />
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 min-h-0 flex flex-col">{logs}</div>

                  <div className="shrink-0 border-t">
                    <div className="mx-auto w-full max-w-[50rem]">
                      <TodoPanel />
                    </div>
                  </div>

                  <div className="min-h-0 max-h-[50%] border-t overflow-hidden bg-background">
                    <div className="mx-auto w-full max-w-[50rem] h-full min-h-0">
                      {followUp}
                    </div>
                  </div>
                </div>
              </>
            )}
          </TaskAttemptPanel>
        )}
      </NewCard>
    ) : null;

  const auxContent =
    taskId && attemptId ? (
      <div className="relative h-full w-full">
        {!attempt ? (
          <div className="h-full flex items-center justify-center p-6">
            <Loader message="Loading..." />
          </div>
        ) : (
          <>
            {effectiveMode === 'preview' && <PreviewPanel />}
            {effectiveMode === 'diffs' && (
              <DiffsPanel selectedAttempt={attempt} />
            )}
          </>
        )}
      </div>
    ) : (
      <div className="relative h-full w-full" />
    );
  const attemptArea = (
    <GitOperationsProvider attemptId={attempt?.id}>
      <ClickedElementsProvider attempt={attempt}>
        <ReviewProvider attemptId={attempt?.id}>
          <DiffStreamProvider attemptId={attempt?.id}>
            <ExecutionProcessesProvider attemptId={attempt?.id}>
              <TasksLayout
                kanban={kanbanContent}
                attempt={attemptContent}
                aux={auxContent}
                isPanelOpen={isPanelOpen}
                mode={effectiveMode}
                rightHeader={rightHeader}
              />
            </ExecutionProcessesProvider>
          </DiffStreamProvider>
        </ReviewProvider>
      </ClickedElementsProvider>
    </GitOperationsProvider>
  );

  return (
    <ProjectTasksSnapshotProvider value={{ projectId, tasks }}>
      <div className="min-h-full h-full flex flex-col">
        <div className="flex-1 min-h-0">{attemptArea}</div>
      </div>
    </ProjectTasksSnapshotProvider>
  );
}
