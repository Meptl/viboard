import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { Settings, Cpu, Server, X, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEffect, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { useKeyExit } from '@/keyboard/hooks';
import { Scope } from '@/keyboard/registry';

const settingsNavigation = [
  {
    path: 'general',
    icon: Settings,
    label: 'General',
    description: 'Theme, notifications, and preferences',
  },
  {
    path: 'projects',
    icon: FolderOpen,
    label: 'Projects',
    description: 'Project scripts and configuration',
  },
  {
    path: 'agents',
    icon: Cpu,
    label: 'Agents',
    description: 'Coding agent configurations',
  },
  {
    path: 'mcp',
    icon: Server,
    label: 'MCP Servers',
    description: 'Model Context Protocol servers',
  },
];

export function SettingsLayout() {
  const { enableScope, disableScope } = useHotkeysContext();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnToRef = useRef<string | null>(null);

  // Enable SETTINGS scope when component mounts
  useEffect(() => {
    enableScope(Scope.SETTINGS);
    return () => {
      disableScope(Scope.SETTINGS);
    };
  }, [enableScope, disableScope]);

  const navigate = useNavigate();

  useEffect(() => {
    const locationState = location.state as { settingsFrom?: string } | null;
    const fromState = locationState?.settingsFrom;

    if (fromState && !fromState.startsWith('/settings')) {
      returnToRef.current = fromState;
    }
  }, [location.state]);

  const handleBack = () => {
    // Trigger blur-driven autosave handlers before navigating away.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    const navigateAway = () => {
      const returnTo = returnToRef.current;
      if (returnTo && !returnTo.startsWith('/settings')) {
        navigate(returnTo, { replace: true });
        return;
      }

      const projectId = searchParams.get('projectId');
      if (projectId) {
        navigate(`/projects/${projectId}/tasks`, { replace: true });
        return;
      }

      navigate('/projects', { replace: true });
    };

    // Let blur events flush before route transition unmounts settings content.
    window.setTimeout(navigateAway, 0);
  };
  // Register ESC keyboard shortcut
  useKeyExit(handleBack, {
    scope: Scope.SETTINGS,
    enableOnFormTags: true,
  });

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto px-4 py-8">
        {/* Header with title and close button */}
        <div className="flex items-center justify-between sticky top-0 bg-background z-10 py-4 -mx-4 px-4">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="h-8 px-2 rounded-none border border-foreground/20 hover:border-foreground/30 transition-all hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 flex items-center gap-1.5"
            >
              <X className="h-4 w-4" />
              <span className="text-xs font-medium">ESC</span>
            </Button>
          </div>
        </div>
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="w-full lg:w-64 lg:shrink-0 lg:sticky lg:top-24 lg:h-fit lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            <div className="space-y-1">
              <nav className="space-y-1">
                {settingsNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      replace
                      end
                      className={({ isActive }) =>
                        cn(
                          'flex items-start gap-3 px-3 py-2 text-sm transition-colors',
                          'hover:text-accent-foreground',
                          isActive
                            ? 'text-primary-foreground'
                            : 'text-secondary-foreground'
                        )
                      }
                    >
                      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{item.label}</div>
                        <div>{item.description}</div>
                      </div>
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
