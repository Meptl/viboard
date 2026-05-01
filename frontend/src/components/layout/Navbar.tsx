import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
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
import { KeyboardShortcutsHelp } from '@/components/layout/KeyboardShortcutsHelp';

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
  const [searchParams] = useSearchParams();
  const { projectId, project } = useProject();
  const { query, setQuery, active, clear, registerInputRef } = useSearch();
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const isProjectTaskRoute = /^\/projects\/[^/]+\/tasks(?:\/.*)?$/.test(
    location.pathname
  );
  const isProjectRepositoryMissingRoute =
    /^\/projects\/[^/]+\/repository-not-detected$/.test(location.pathname);
  const isProjectScopedRoute =
    isProjectTaskRoute || isProjectRepositoryMissingRoute;
  const showProjectSwitcher = isProjectScopedRoute || isSettingsRoute;
  const { data: projects = [] } = useProjects({ enabled: showProjectSwitcher });
  const handleOpenInEditor = useOpenProjectInEditor(project || null);
  const settingsProjectId = searchParams.get('projectId');
  const selectedProjectId = isSettingsRoute ? settingsProjectId : projectId;

  const projectSwitchValue =
    selectedProjectId &&
    projects.some((entry) => entry.id === selectedProjectId)
      ? selectedProjectId
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
    if (nextProjectId === selectedProjectId) return;
    navigate(paths.project(nextProjectId));
  };

  return (
    <div className="border-b bg-background">
      <div className="w-full px-3">
        <div className="flex items-center h-12 py-2">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Link to="/projects" className="flex items-center">
              <Logo />
            </Link>
            {showProjectSwitcher ? (
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
            {isProjectTaskRoute && projectId ? (
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
              <KeyboardShortcutsHelp />
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
