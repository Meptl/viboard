import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useProject } from '@/contexts/ProjectContext';
import { paths } from '@/lib/paths';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { projectsApi } from '@/lib/api';
import { useProjectMutations } from '@/hooks/useProjectMutations';
import { isUnderlyingRepoNotDetectedError } from '@/lib/repositoryErrors';

export function ProjectRepositoryNotDetected() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useProject();
  const [repoPathDraft, setRepoPathDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { updateProject } = useProjectMutations();

  useEffect(() => {
    if (!project?.git_repo_path) return;
    setRepoPathDraft(project.git_repo_path);
  }, [project?.git_repo_path]);

  if (!projectId) {
    return <Navigate to={paths.projects()} replace />;
  }

  const handleTryAgain = async () => {
    const nextPath = repoPathDraft.trim();
    if (!nextPath) {
      setError('Repository path is required.');
      return;
    }

    setError(null);

    try {
      if (project && nextPath !== project.git_repo_path) {
        await updateProject.mutateAsync({
          projectId,
          data: {
            name: project.name,
            git_repo_path: nextPath,
            setup_script: project.setup_script ?? null,
            dev_script: project.dev_script ?? null,
            cleanup_script: project.cleanup_script ?? null,
            copy_files: project.copy_files ?? null,
            parallel_setup_script: project.parallel_setup_script ?? null,
          },
        });
      }

      await projectsApi.getBranches(projectId);
      navigate(paths.projectTasks(projectId), { replace: true });
    } catch (retryError) {
      if (isUnderlyingRepoNotDetectedError(retryError)) {
        setError(
          'Repository still not detected. Check the path and make sure it points to a valid local git repository.'
        );
        return;
      }

      setError(
        (retryError as Error)?.message || 'Failed to validate repository path.'
      );
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle>Underlying repository not detected</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            We could not find the repository for this project. This usually
            happens when the folder was moved or deleted.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Update the repository path here, then press Try Again.
          </p>
          <div className="space-y-2">
            <Label htmlFor="repo-path-inline">Repository path</Label>
            <Input
              id="repo-path-inline"
              value={repoPathDraft}
              onChange={(e) => setRepoPathDraft(e.target.value)}
              placeholder="/path/to/your/existing/repo"
              disabled={updateProject.isPending}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void handleTryAgain()}
              disabled={updateProject.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button variant="ghost" onClick={() => navigate(paths.projects())}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Projects
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
