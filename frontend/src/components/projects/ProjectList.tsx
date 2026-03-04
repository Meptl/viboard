import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CreateProject } from 'shared/types';
import { FolderPickerDialog } from '@/components/dialogs/shared/FolderPickerDialog';
import { projectsApi } from '@/lib/api';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import ProjectCard from '@/components/projects/ProjectCard.tsx';
import { useKeyCreate, useKeyNextNotification, Scope } from '@/keyboard';
import { generateProjectNameFromPath } from '@/utils/string';
import { useProjects } from '@/hooks/useProjects';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';

export function ProjectList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('projects');
  const {
    data: projects = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useProjects();
  const [mutationError, setMutationError] = useState('');
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const { resolveNextNotification } = useTaskNotifications();

  const errorMessage = useMemo(() => {
    if (mutationError) return mutationError;
    if (isError) return t('errors.fetchFailed');
    return '';
  }, [isError, mutationError, t]);

  const handleCreateProject = useCallback(async () => {
    try {
      setMutationError('');
      const selectedPath = await FolderPickerDialog.show({
        title: 'Select Git Repository',
        description: 'Choose an existing git repository',
      });

      if (!selectedPath) {
        return;
      }

      const createData: CreateProject = {
        name: generateProjectNameFromPath(selectedPath),
        git_repo_path: selectedPath,
        use_existing_repo: true,
        setup_script: null,
        dev_script: null,
        cleanup_script: null,
        copy_files: null,
        parallel_setup_script: null,
      };

      await projectsApi.create(createData);
      await refetch();
    } catch (error) {
      console.error('Failed to create project:', error);
      setMutationError(t('errors.fetchFailed'));
    }
  }, [refetch, t]);

  // Semantic keyboard shortcut for creating new project
  useKeyCreate(handleCreateProject, { scope: Scope.PROJECTS });
  useKeyNextNotification(
    () => {
      resolveNextNotification();
    },
    {
      scope: Scope.PROJECTS,
      preventDefault: true,
    }
  );

  const handleEditProject = (projectId: string) => {
    navigate(`/settings/projects?projectId=${projectId}`, {
      state: {
        settingsFrom: `${location.pathname}${location.search}${location.hash}`,
      },
    });
  };

  // Set initial focus when projects are loaded
  useEffect(() => {
    if (projects.length > 0 && !focusedProjectId) {
      setFocusedProjectId(projects[0].id);
    }
  }, [projects, focusedProjectId]);

  return (
    <div className="space-y-6 p-8 pb-16 md:pb-8 h-full overflow-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={handleCreateProject}>
          <Plus className="mr-2 h-4 w-4" />
          {t('createProject')}
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-3">
            <span>{errorMessage}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => void refetch()}
            >
              {t('common:buttons.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('errors.fetchFailed')}</p>
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Plus className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{t('empty.title')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('empty.description')}
            </p>
            <Button className="mt-4" onClick={handleCreateProject}>
              <Plus className="mr-2 h-4 w-4" />
              {t('empty.createFirst')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isFocused={focusedProjectId === project.id}
              setError={setMutationError}
              onEdit={() => handleEditProject(project.id)}
              fetchProjects={() => void refetch()}
            />
          ))}
        </div>
      )}

      {isFetching && !isLoading ? (
        <div className="flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          {t('loading')}
        </div>
      ) : null}
    </div>
  );
}
