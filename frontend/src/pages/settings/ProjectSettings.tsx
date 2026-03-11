import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cloneDeep, isEqual } from 'lodash';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Folder } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useProjectMutations } from '@/hooks/useProjectMutations';
import { useScriptPlaceholders } from '@/hooks/useScriptPlaceholders';
import { CopyFilesField } from '@/components/projects/CopyFilesField';
import { TagManager } from '@/components/TagManager';
import { AutoExpandingTextarea } from '@/components/ui/auto-expanding-textarea';
import { FolderPickerDialog } from '@/components/dialogs/shared/FolderPickerDialog';
import type { Project, UpdateProject } from 'shared/types';

interface ProjectFormState {
  name: string;
  git_repo_path: string;
  setup_script: string;
  parallel_setup_script: boolean;
  dev_script: string;
  cleanup_script: string;
  copy_files: string;
}

function projectToFormState(project: Project): ProjectFormState {
  return {
    name: project.name,
    git_repo_path: project.git_repo_path,
    setup_script: project.setup_script ?? '',
    parallel_setup_script: project.parallel_setup_script ?? false,
    dev_script: project.dev_script ?? '',
    cleanup_script: project.cleanup_script ?? '',
    copy_files: project.copy_files ?? '',
  };
}

function normalizeProjectFormState(state: ProjectFormState): ProjectFormState {
  return {
    ...state,
    name: state.name.trim(),
    git_repo_path: state.git_repo_path.trim(),
    setup_script: state.setup_script.trim(),
    dev_script: state.dev_script.trim(),
    cleanup_script: state.cleanup_script.trim(),
    copy_files: state.copy_files.trim(),
  };
}

export function ProjectSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId') ?? '';
  const { t } = useTranslation('settings');

  // Fetch all projects
  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useProjects();

  // Selected project state
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    searchParams.get('projectId') || ''
  );
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Form state
  const [draft, setDraft] = useState<ProjectFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const latestDraftRef = useRef<ProjectFormState | null>(null);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const saveSeqRef = useRef(0);

  // Get OS-appropriate script placeholders
  const placeholders = useScriptPlaceholders();

  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !selectedProject) return false;
    return !isEqual(draft, projectToFormState(selectedProject));
  }, [draft, selectedProject]);

  // Handle project selection from dropdown
  const handleProjectSelect = useCallback(
    (id: string) => {
      // No-op if same project
      if (id === selectedProjectId) return;
      setDraft(null);
      setSelectedProject(null);
      setSuccess(false);
      setError(null);

      // Update state and URL
      setSelectedProjectId(id);
      if (id) {
        setSearchParams({ projectId: id });
      } else {
        setSearchParams({});
      }
    },
    [selectedProjectId, setSearchParams]
  );

  // Sync selectedProjectId when URL changes
  useEffect(() => {
    if (projectIdParam === selectedProjectId) return;
    setDraft(null);
    setSelectedProject(null);
    setSuccess(false);
    setError(null);
    setSelectedProjectId(projectIdParam);
  }, [projectIdParam, selectedProjectId]);

  // Populate draft from server data
  useEffect(() => {
    if (!projects) return;

    const nextProject = selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId)
      : null;

    setSelectedProject((prev) =>
      prev?.id === nextProject?.id ? prev : (nextProject ?? null)
    );

    if (!nextProject) {
      if (!hasUnsavedChanges) setDraft(null);
      return;
    }

    if (hasUnsavedChanges) return;

    setDraft(projectToFormState(nextProject));
  }, [projects, selectedProjectId, hasUnsavedChanges]);

  const { updateProject } = useProjectMutations();

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const updateDraft = (updates: Partial<ProjectFormState>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
  };

  const saveProjectSnapshot = useCallback(
    async (saveSnapshot: ProjectFormState, projectId: string, saveSeq: number) => {
      setSaving(true);
      setError(null);
      setSuccess(false);

      try {
        const updateData: UpdateProject = {
          name: saveSnapshot.name.trim(),
          git_repo_path: saveSnapshot.git_repo_path.trim(),
          setup_script: saveSnapshot.setup_script.trim() || null,
          parallel_setup_script: saveSnapshot.parallel_setup_script,
          dev_script: saveSnapshot.dev_script.trim() || null,
          cleanup_script: saveSnapshot.cleanup_script.trim() || null,
          copy_files: saveSnapshot.copy_files.trim() || null,
        };

        const updatedProject = await updateProject.mutateAsync({
          projectId,
          data: updateData,
        });

        const normalizedSnapshot = normalizeProjectFormState(saveSnapshot);

        if (selectedProjectIdRef.current === updatedProject.id) {
          setSelectedProject(updatedProject);
          if (isEqual(latestDraftRef.current, saveSnapshot)) {
            setDraft(projectToFormState(updatedProject));
          } else if (isEqual(latestDraftRef.current, normalizedSnapshot)) {
            setDraft(projectToFormState(updatedProject));
          }
        }

        if (saveSeq === saveSeqRef.current) {
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('settings.projects.save.error')
        );
        console.error('Error saving project settings:', err);
      } finally {
        if (saveSeq === saveSeqRef.current) {
          setSaving(false);
        }
      }
    },
    [t, updateProject]
  );

  const triggerSave = useCallback(
    async (snapshot?: ProjectFormState) => {
      if (!selectedProject) return;
      const saveSnapshot = cloneDeep(snapshot ?? latestDraftRef.current);
      if (!saveSnapshot) return;

      const normalizedSnapshot = normalizeProjectFormState(saveSnapshot);
      const current = normalizeProjectFormState(projectToFormState(selectedProject));
      if (isEqual(normalizedSnapshot, current)) return;
      if (!normalizedSnapshot.name || !normalizedSnapshot.git_repo_path) return;

      const saveSeq = ++saveSeqRef.current;
      await saveProjectSnapshot(saveSnapshot, selectedProject.id, saveSeq);
    },
    [saveProjectSnapshot, selectedProject]
  );

  const handleImmediateToggleChange = useCallback(
    (checked: boolean) => {
      if (!draft) return;
      const nextSnapshot = {
        ...draft,
        parallel_setup_script: checked,
      };
      updateDraft({ parallel_setup_script: checked });
      void triggerSave(nextSnapshot);
    },
    [draft, triggerSave]
  );

  const handleRepoPathPicked = useCallback(
    async (selectedPath: string) => {
      if (!draft) return;
      const nextSnapshot = {
        ...draft,
        git_repo_path: selectedPath,
      };
      updateDraft({ git_repo_path: selectedPath });
      await triggerSave(nextSnapshot);
    },
    [draft, triggerSave]
  );

  const handleTextFieldBlur = useCallback(() => {
    void triggerSave();
  }, [triggerSave]);

  const handleCopyFilesChange = useCallback(
    (value: string) => {
      updateDraft({ copy_files: value });
    },
    []
  );

  const handleCopyFilesBlur = useCallback(() => {
    void triggerSave();
  }, [triggerSave]);

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">{t('settings.projects.loading')}</span>
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="py-8">
        <Alert variant="destructive">
          <AlertDescription>
            {projectsError instanceof Error
              ? projectsError.message
              : t('settings.projects.loadError')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.projects.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-selector">
              {t('settings.projects.selector.label')}
            </Label>
            <Select
              value={selectedProjectId}
              onValueChange={handleProjectSelect}
            >
              <SelectTrigger id="project-selector">
                <SelectValue
                  placeholder={t('settings.projects.selector.placeholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {projects && projects.length > 0 ? (
                  projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-projects" disabled>
                    {t('settings.projects.selector.noProjects')}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedProject && draft && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.projects.general.title')}</CardTitle>
              <CardDescription>
                {t('settings.projects.general.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">
                  {t('settings.projects.general.name.label')}
                </Label>
                <Input
                  id="project-name"
                  type="text"
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  onBlur={handleTextFieldBlur}
                  placeholder={t('settings.projects.general.name.placeholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="git-repo-path">
                  {t('settings.projects.general.repoPath.label')}
                </Label>
                <div className="flex space-x-2">
                  <Input
                    id="git-repo-path"
                    type="text"
                    value={draft.git_repo_path}
                    onChange={(e) =>
                      updateDraft({ git_repo_path: e.target.value })
                    }
                    onBlur={handleTextFieldBlur}
                    placeholder={t(
                      'settings.projects.general.repoPath.placeholder'
                    )}
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const selectedPath = await FolderPickerDialog.show({
                        title: 'Select Git Repository',
                        description: 'Choose an existing git repository',
                        value: draft.git_repo_path,
                      });
                      if (selectedPath) {
                        await handleRepoPathPicked(selectedPath);
                      }
                    }}
                  >
                    <Folder className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.projects.scripts.title')}</CardTitle>
              <CardDescription>
                {t('settings.projects.scripts.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-script">
                  {t('settings.projects.scripts.setup.label')}
                </Label>
                <AutoExpandingTextarea
                  id="setup-script"
                  value={draft.setup_script}
                  onChange={(e) =>
                    updateDraft({ setup_script: e.target.value })
                  }
                  onBlur={handleTextFieldBlur}
                  placeholder={placeholders.setup}
                  maxRows={12}
                  className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.projects.scripts.setup.helper')}
                </p>

                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox
                    id="parallel-setup-script"
                    checked={draft.parallel_setup_script}
                    onCheckedChange={(checked) =>
                      handleImmediateToggleChange(checked === true)
                    }
                    disabled={!draft.setup_script.trim()}
                  />
                  <Label
                    htmlFor="parallel-setup-script"
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t('settings.projects.scripts.setup.parallelLabel')}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground pl-6">
                  {t('settings.projects.scripts.setup.parallelHelper')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dev-script">
                  {t('settings.projects.scripts.dev.label')}
                </Label>
                <AutoExpandingTextarea
                  id="dev-script"
                  value={draft.dev_script}
                  onChange={(e) => updateDraft({ dev_script: e.target.value })}
                  onBlur={handleTextFieldBlur}
                  placeholder={placeholders.dev}
                  maxRows={12}
                  className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.projects.scripts.dev.helper')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cleanup-script">
                  {t('settings.projects.scripts.cleanup.label')}
                </Label>
                <AutoExpandingTextarea
                  id="cleanup-script"
                  value={draft.cleanup_script}
                  onChange={(e) =>
                    updateDraft({ cleanup_script: e.target.value })
                  }
                  onBlur={handleTextFieldBlur}
                  placeholder={placeholders.cleanup}
                  maxRows={12}
                  className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.projects.scripts.cleanup.helper')}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t('settings.projects.scripts.copyFiles.label')}</Label>
                <CopyFilesField
                  value={draft.copy_files}
                  onChange={handleCopyFilesChange}
                  onBlur={handleCopyFilesBlur}
                  projectId={selectedProject.id}
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.projects.scripts.copyFiles.helper')}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Project Local Tags</CardTitle>
              <CardDescription>
                Create tags that are only available within this project.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TagManager projectId={selectedProject.id} hideHeader />
            </CardContent>
          </Card>

          {saving && !success && (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings.projects.save.button')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
