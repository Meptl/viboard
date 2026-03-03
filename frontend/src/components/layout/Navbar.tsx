import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Settings, Plus } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { SearchBar } from '@/components/SearchBar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearch } from '@/contexts/SearchContext';
import { openTaskForm } from '@/lib/openTaskForm';
import { useProject } from '@/contexts/ProjectContext';
import { useOpenProjectInEditor } from '@/hooks/useOpenProjectInEditor';
import { useProjects } from '@/hooks/useProjects';
import { paths } from '@/lib/paths';
import { OpenInIdeButton } from '@/components/ide/OpenInIdeButton';
import { TaskNotificationsBell } from '@/components/layout/TaskNotificationsBell';

function NavDivider() {
  return (
    <div
      className="mx-2 h-6 w-px bg-border/60"
      role="separator"
      aria-orientation="vertical"
    />
  );
}

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, project } = useProject();
  const { query, setQuery, active, clear, registerInputRef } = useSearch();
  const isProjectTaskRoute = /^\/projects\/[^/]+\/tasks(?:\/.*)?$/.test(
    location.pathname
  );
  const { data: projects = [] } = useProjects({ enabled: isProjectTaskRoute });
  const handleOpenInEditor = useOpenProjectInEditor(project || null);

  const projectSwitchValue =
    projectId && projects.some((entry) => entry.id === projectId)
      ? projectId
      : undefined;

  const setSearchBarRef = useCallback(
    (node: HTMLInputElement | null) => {
      registerInputRef(node);
    },
    [registerInputRef]
  );

  const handleCreateTask = () => {
    if (projectId) {
      openTaskForm({ mode: 'create', projectId });
    }
  };

  const handleOpenInIDE = () => {
    handleOpenInEditor();
  };

  const handleProjectChange = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    navigate(paths.projectTasks(nextProjectId));
  };

  return (
    <div className="border-b bg-background">
      <div className="w-full px-3">
        <div className="flex items-center h-12 py-2">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Link to="/projects">
              <Logo />
            </Link>
            {isProjectTaskRoute ? (
              <Select
                value={projectSwitchValue}
                onValueChange={handleProjectChange}
              >
                <SelectTrigger
                  aria-label="Select project"
                  className="h-9 w-[137px] lg:w-[169px]"
                >
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <SearchBar
              ref={setSearchBarRef}
              className="shrink-0"
              value={query}
              onChange={setQuery}
              disabled={!active}
              onClear={clear}
              project={project || null}
            />
          </div>

          <div className="flex flex-1 items-center justify-end gap-1">
            {projectId ? (
              <>
                <div className="flex items-center gap-1">
                  <OpenInIdeButton
                    onClick={handleOpenInIDE}
                    className="h-9 w-9"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={handleCreateTask}
                    aria-label="Create new task"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <NavDivider />
              </>
            ) : null}

            <div className="flex items-center gap-1 shrink-0">
              <TaskNotificationsBell />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                asChild
                aria-label="Settings"
              >
                <Link
                  to={
                    projectId
                      ? `/settings/projects?projectId=${projectId}`
                      : '/settings/general'
                  }
                  state={{
                    settingsFrom: `${location.pathname}${location.search}${location.hash}`,
                  }}
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
