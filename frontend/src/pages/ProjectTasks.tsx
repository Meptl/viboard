import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { attemptsApi, projectsApi, tasksApi } from '@/lib/api';
import type { GitBranch } from 'shared/types';
import { openTaskForm } from '@/lib/openTaskForm';
import { FeatureShowcaseDialog } from '@/components/dialogs/global/FeatureShowcaseDialog';
import { ConfirmDialog } from '@/components/dialogs/shared/ConfirmDialog';
import { showcases } from '@/config/showcases';
import { useUserSystem } from '@/components/ConfigProvider';

import { useSearch } from '@/contexts/SearchContext';
import { useProject } from '@/contexts/ProjectContext';
import { useTaskAttempts } from '@/hooks/useTaskAttempts';
import { useTaskAttempt } from '@/hooks/useTaskAttempt';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useBranchStatus, useAttemptExecution } from '@/hooks';
import { paths } from '@/lib/paths';
import { ExecutionProcessesProvider } from '@/contexts/ExecutionProcessesContext';
import { ClickedElementsProvider } from '@/contexts/ClickedElementsProvider';
import { ReviewProvider } from '@/contexts/ReviewProvider';
import {
  GitOperationsProvider,
  useGitOperationsError,
} from '@/contexts/GitOperationsContext';
import {
  useKeyCreate,
  useKeyExit,
  useKeyFocusSearch,
  useKeyNavUp,
  useKeyNavDown,
  useKeyNavLeft,
  useKeyNavRight,
  useKeyOpenDetails,
  Scope,
  useKeyDeleteTask,
  useKeyCycleViewBackward,
} from '@/keyboard';

import TaskKanbanBoard, {
  type KanbanColumnItem,
} from '@/components/tasks/TaskKanbanBoard';
import type {
  DragEndEvent,
  DragOverEvent,
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
import type { GitOperationsInputs } from '@/components/tasks/Toolbar/GitOperations';

import type { TaskWithAttemptStatus, TaskStatus } from 'shared/types';

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

const normalizeStatus = (status: string): TaskStatus =>
  status.toLowerCase() as TaskStatus;

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
  const { t } = useTranslation(['tasks', 'common']);
  const { taskId, attemptId } = useParams<{
    projectId: string;
    taskId?: string;
    attemptId?: string;
  }>();
  const navigate = useNavigate();
  const { enableScope, disableScope, activeScopes } = useHotkeysContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const isXL = useMediaQuery('(min-width: 1280px)');
  const isMobile = !isXL;
  const [dropPreview, setDropPreview] = useState<DropPreview>(null);

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
    tasks,
    tasksById,
    isLoading,
    isConnected,
  } = useProjectTasks(projectId || '');
  const { ingestProjectTasks, clearTaskNotifications } = useTaskNotifications();

  useEffect(() => {
    if (!projectId || isLoading) return;
    ingestProjectTasks(projectId, tasks);
  }, [projectId, tasks, isLoading, ingestProjectTasks]);

  const selectedTask = useMemo(
    () => (taskId ? (tasksById[taskId] ?? null) : null),
    [taskId, tasksById]
  );

  useEffect(() => {
    if (!projectId || !selectedTask) return;
    clearTaskNotifications(projectId, selectedTask.id);
  }, [projectId, selectedTask, clearTaskNotifications]);

  const isPanelOpen = Boolean(taskId && selectedTask && attemptId);

  const { config, updateAndSaveConfig, loading } = useUserSystem();

  const isLoaded = !loading;
  const showcaseId = showcases.taskPanel.id;
  const seenFeatures = useMemo(
    () => config?.showcases?.seen_features ?? [],
    [config?.showcases?.seen_features]
  );
  const seen = isLoaded && seenFeatures.includes(showcaseId);

  useEffect(() => {
    if (!isLoaded || !isPanelOpen || seen) return;

    FeatureShowcaseDialog.show({ config: showcases.taskPanel }).finally(() => {
      FeatureShowcaseDialog.hide();
      if (seenFeatures.includes(showcaseId)) return;
      void updateAndSaveConfig({
        showcases: { seen_features: [...seenFeatures, showcaseId] },
      });
    });
  }, [
    isLoaded,
    isPanelOpen,
    seen,
    showcaseId,
    updateAndSaveConfig,
    seenFeatures,
  ]);

  const isLatest = attemptId === 'latest';
  const effectiveAttemptId = attemptId === 'latest' ? undefined : attemptId;
  const { data: attempts = [], isLoading: isAttemptsLoading } = useTaskAttempts(
    taskId,
    {
      enabled: !!taskId && (isLatest || !!effectiveAttemptId),
    }
  );

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
    if (isAttemptsLoading) return;

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
    latestAttemptId,
    navigateWithSearch,
    navigateToAttemptDiffs,
  ]);

  useEffect(() => {
    if (!projectId || !taskId || isLoading) return;
    if (selectedTask === null) {
      navigate(`/projects/${projectId}/tasks`, { replace: true });
    }
  }, [projectId, taskId, isLoading, selectedTask, navigate]);

  const isTaskView = !!taskId && !effectiveAttemptId;
  const { data: attempt } = useTaskAttempt(effectiveAttemptId);
  const taskRouteResolutionRef = useRef<string | null>(null);

  const { data: branchStatus } = useBranchStatus(attempt?.id);
  const [branches, setBranches] = useState<GitBranch[]>([]);

  useEffect(() => {
    if (!projectId) return;
    projectsApi
      .getBranches(projectId)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [projectId]);

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

  useKeyCreate(handleCreateNewTask, {
    scope: Scope.KANBAN,
    preventDefault: true,
  });

  useKeyFocusSearch(
    () => {
      focusInput();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyExit(
    () => {
      if (isPanelOpen) {
        handleClosePanel();
      } else {
        navigate('/projects');
      }
    },
    { scope: Scope.KANBAN }
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

  useKeyNavUp(
    () => {
      selectPreviousTask();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavDown(
    () => {
      selectNextTask();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavLeft(
    () => {
      selectPreviousColumn();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  useKeyNavRight(
    () => {
      selectNextColumn();
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

  /**
   * Cycle the attempt area view.
   * - When panel is closed: opens task details (if a task is selected)
   * - When panel is open: cycles among [attempt, preview, diffs]
   */
  const cycleView = useCallback(
    (direction: 'forward' | 'backward' = 'forward') => {
      const order: LayoutMode[] = [null, 'preview', 'diffs'];
      const idx = order.indexOf(mode);
      const next =
        direction === 'forward'
          ? order[(idx + 1) % order.length]
          : order[(idx - 1 + order.length) % order.length];
      setMode(next);
    },
    [mode, setMode]
  );

  const cycleViewForward = useCallback(() => cycleView('forward'), [cycleView]);
  const cycleViewBackward = useCallback(
    () => cycleView('backward'),
    [cycleView]
  );

  // meta/ctrl+enter → open details or cycle forward
  const isFollowUpReadyActive = activeScopes.includes(Scope.FOLLOW_UP_READY);

  useKeyOpenDetails(
    () => {
      if (isPanelOpen) {
        cycleViewForward();
      } else if (selectedTask) {
        handleViewTaskDetails(selectedTask);
      }
    },
    { scope: Scope.KANBAN, when: () => !isFollowUpReadyActive }
  );

  // meta/ctrl+shift+enter → cycle backward
  useKeyCycleViewBackward(
    () => {
      if (isPanelOpen) {
        cycleViewBackward();
      }
    },
    { scope: Scope.KANBAN, preventDefault: true }
  );

  useKeyDeleteTask(
    () => {
      // Note: Delete is now handled by TaskActionsDropdown
      // This keyboard shortcut could trigger the dropdown action if needed
    },
    {
      scope: Scope.KANBAN,
      preventDefault: true,
    }
  );

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

  const selectNextTask = useCallback(() => {
    if (selectedTask) {
      const statusKey = normalizeStatus(selectedTask.status);
      const tasksInStatus = visibleTasksByStatus[statusKey] || [];
      const currentIndex = tasksInStatus.findIndex(
        (task) => task.id === selectedTask.id
      );
      if (currentIndex >= 0 && currentIndex < tasksInStatus.length - 1) {
        handleViewTaskDetails(tasksInStatus[currentIndex + 1]);
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectPreviousTask = useCallback(() => {
    if (selectedTask) {
      const statusKey = normalizeStatus(selectedTask.status);
      const tasksInStatus = visibleTasksByStatus[statusKey] || [];
      const currentIndex = tasksInStatus.findIndex(
        (task) => task.id === selectedTask.id
      );
      if (currentIndex > 0) {
        handleViewTaskDetails(tasksInStatus[currentIndex - 1]);
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectNextColumn = useCallback(() => {
    if (selectedTask) {
      const currentStatus = normalizeStatus(selectedTask.status);
      const currentIndex = TASK_STATUSES.findIndex(
        (status) => status === currentStatus
      );
      for (let i = currentIndex + 1; i < TASK_STATUSES.length; i++) {
        const tasks = visibleTasksByStatus[TASK_STATUSES[i]];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          return;
        }
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const selectPreviousColumn = useCallback(() => {
    if (selectedTask) {
      const currentStatus = normalizeStatus(selectedTask.status);
      const currentIndex = TASK_STATUSES.findIndex(
        (status) => status === currentStatus
      );
      for (let i = currentIndex - 1; i >= 0; i--) {
        const tasks = visibleTasksByStatus[TASK_STATUSES[i]];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          return;
        }
      }
    } else {
      for (const status of TASK_STATUSES) {
        const tasks = visibleTasksByStatus[status];
        if (tasks && tasks.length > 0) {
          handleViewTaskDetails(tasks[0]);
          break;
        }
      }
    }
  }, [selectedTask, visibleTasksByStatus, handleViewTaskDetails]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDropPreview(null);
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const draggedTaskId = active.id as string;
      const newStatus = over.id as Task['status'];
      const task = tasksById[draggedTaskId];
      if (!task || task.status === newStatus) return;

      try {
        await tasksApi.update(draggedTaskId, {
          title: task.title,
          description: task.description,
          status: newStatus,
          parent_task_attempt: task.parent_task_attempt,
          image_ids: null,
        });

        if (
          newStatus !== 'inprogress' ||
          !projectId ||
          !config?.executor_profile
        ) {
          return;
        }

        const existingAttempts = await attemptsApi.getAll(task.id);
        if (existingAttempts.length > 0) {
          const confirmResult = await ConfirmDialog.show({
            title: 'Start a new attempt?',
            message:
              'This task already has an attempt. Starting a new attempt will switch to a new conversation and you may lose your current conversation history.',
            confirmText: 'Start New Attempt',
            cancelText: 'Cancel',
            variant: 'destructive',
          }).finally(() => {
            ConfirmDialog.hide();
          });

          if (confirmResult !== 'confirmed') {
            return;
          }
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

        const newAttempt = await attemptsApi.create({
          task_id: task.id,
          executor_profile_id: config.executor_profile,
          base_branch: baseBranch,
        });

        navigateToAttemptDiffs(
          paths.attempt(projectId, task.id, newAttempt.id)
        );
      } catch (err) {
        console.error(
          'Failed to update task status / auto-start attempt:',
          err
        );
      }
    },
    [
      branches,
      config?.executor_profile,
      navigateToAttemptDiffs,
      projectId,
      tasksById,
    ]
  );

  const clearDropPreview = useCallback(() => {
    setDropPreview(null);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    void event;
    setDropPreview(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) {
        setDropPreview(null);
        return;
      }

      const activeTaskId = active.id as string;
      const task = tasksById[activeTaskId];
      if (!task) {
        setDropPreview(null);
        return;
      }

      if (!TASK_STATUSES.includes(String(over.id) as TaskStatus)) {
        setDropPreview(null);
        return;
      }

      const targetStatus = normalizeStatus(String(over.id));
      const currentStatus = normalizeStatus(task.status);

      if (targetStatus === currentStatus) {
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

      setDropPreview((prev) => {
        const nextHeight = active.rect.current.initial?.height ?? prev?.height;
        if (
          prev &&
          prev.status === targetStatus &&
          prev.index === insertIndex &&
          prev.height === nextHeight
        ) {
          return prev;
        }

        return {
          status: targetStatus,
          index: insertIndex,
          height: nextHeight,
        };
      });
    },
    [kanbanColumns, tasksById]
  );

  const isInitialTasksLoad = isLoading && tasks.length === 0;

  if (projectError) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            {t('common:states.error')}
          </AlertTitle>
          <AlertDescription>
            {projectError.message || 'Failed to load project'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (projectLoading && isInitialTasksLoad) {
    return <Loader message={t('loading')} size={32} className="py-8" />;
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
            <p className="text-muted-foreground">{t('empty.noTasks')}</p>
            <Button className="mt-4" onClick={handleCreateNewTask}>
              <Plus className="h-4 w-4 mr-2" />
              {t('empty.createFirst')}
            </Button>
          </CardContent>
        </Card>
      </div>
    ) : !hasVisibleLocalTasks ? (
      <div className="max-w-7xl mx-auto mt-8">
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">
              {t('empty.noSearchResults')}
            </p>
          </CardContent>
        </Card>
      </div>
    ) : (
      <div className="w-full h-full overflow-x-auto overflow-y-auto overscroll-x-contain">
        <TaskKanbanBoard
          columns={kanbanColumns}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={clearDropPreview}
          onViewTaskDetails={handleViewTaskDetails}
          selectedTaskId={selectedTask?.id}
          onCreateTask={handleCreateNewTask}
          projectId={projectId!}
          dropPreview={dropPreview}
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="min-w-0 max-w-full text-base md:text-lg font-semibold text-left whitespace-normal break-words hover:underline"
              onClick={() =>
                navigateWithSearch(paths.task(projectId!, selectedTask.id))
              }
            >
              {selectedTask.title || 'Task'}
            </button>
          </div>
        </div>
      </NewCardHeader>
    ) : null;

  const attemptContent =
    selectedTask && attempt ? (
      <NewCard className="h-full min-h-0 flex flex-col bg-diagonal-lines bg-muted border-0">
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
      </NewCard>
    ) : null;

  const auxContent =
    selectedTask && attempt ? (
      <div className="relative h-full w-full">
        {effectiveMode === 'preview' && <PreviewPanel />}
        {effectiveMode === 'diffs' && (
          <DiffsPanel selectedAttempt={attempt} />
        )}
      </div>
    ) : (
      <div className="relative h-full w-full" />
    );
  const attemptArea = (
    <GitOperationsProvider attemptId={attempt?.id}>
      <ClickedElementsProvider attempt={attempt}>
        <ReviewProvider attemptId={attempt?.id}>
          <ExecutionProcessesProvider attemptId={attempt?.id}>
            <TasksLayout
              kanban={kanbanContent}
              attempt={attemptContent}
              aux={auxContent}
              isPanelOpen={isPanelOpen}
              mode={effectiveMode}
              isMobile={isMobile}
              rightHeader={rightHeader}
            />
          </ExecutionProcessesProvider>
        </ReviewProvider>
      </ClickedElementsProvider>
    </GitOperationsProvider>
  );

  return (
    <div className="min-h-full h-full flex flex-col">
      <div className="flex-1 min-h-0">{attemptArea}</div>
    </div>
  );
}
