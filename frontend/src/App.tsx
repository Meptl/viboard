import { useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  generatePath,
  useParams,
} from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Projects } from '@/pages/Projects';
import { ProjectTasks } from '@/pages/ProjectTasks';
import { NormalLayout } from '@/components/layout/NormalLayout';

import {
  AgentSettings,
  GeneralSettings,
  McpSettings,
  ProjectSettings,
  SettingsLayout,
} from '@/pages/settings/';
import { UserSystemProvider, useUserSystem } from '@/components/ConfigProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { SearchProvider } from '@/contexts/SearchContext';

import { HotkeysProvider } from 'react-hotkeys-hook';

import { ProjectProvider } from '@/contexts/ProjectContext';
import { ThemeMode } from 'shared/types';
import { Loader } from '@/components/ui/loader';

import { DisclaimerDialog } from '@/components/dialogs/global/DisclaimerDialog';
import { ClickedElementsProvider } from './contexts/ClickedElementsProvider';
import NiceModal from '@ebay/nice-modal-react';
import { TaskNotificationsProvider } from '@/contexts/TaskNotificationsContext';

function ProjectRouteRedirect() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  return (
    <Navigate
      to={generatePath('/projects/:projectId/tasks', { projectId })}
      replace
    />
  );
}

function AppContent() {
  const { config, updateAndSaveConfig, loading } = useUserSystem();

  useEffect(() => {
    if (!config) return;
    let cancelled = false;

    const showNextStep = async () => {
      // 1) Disclaimer - first step
      if (!config.disclaimer_acknowledged) {
        await DisclaimerDialog.show();
        if (!cancelled) {
          await updateAndSaveConfig({ disclaimer_acknowledged: true });
        }
        DisclaimerDialog.hide();
        return;
      }

    };

    showNextStep();

    return () => {
      cancelled = true;
    };
  }, [config, updateAndSaveConfig]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader message="Loading..." size={32} />
      </div>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider initialTheme={config?.theme || ThemeMode.SYSTEM}>
        <SearchProvider>
          <TaskNotificationsProvider>
            <div className="h-screen flex flex-col bg-background">
              <Routes>
                <Route element={<NormalLayout />}>
                  <Route path="/" element={<Projects />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/:projectId" element={<ProjectRouteRedirect />} />
                  <Route
                    path="/projects/:projectId/tasks"
                    element={<ProjectTasks />}
                  />
                  <Route path="/settings/*" element={<SettingsLayout />}>
                    <Route index element={<Navigate to="general" replace />} />
                    <Route path="general" element={<GeneralSettings />} />
                    <Route path="projects" element={<ProjectSettings />} />
                    <Route path="agents" element={<AgentSettings />} />
                    <Route path="mcp" element={<McpSettings />} />
                  </Route>
                  <Route
                    path="/mcp-servers"
                    element={<Navigate to="/settings/mcp" replace />}
                  />
                  <Route
                    path="/projects/:projectId/tasks/:taskId"
                    element={<ProjectTasks />}
                  />
                  <Route
                    path="/projects/:projectId/tasks/:taskId/attempts/:attemptId"
                    element={<ProjectTasks />}
                  />
                </Route>
              </Routes>
            </div>
          </TaskNotificationsProvider>
        </SearchProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <UserSystemProvider>
        <ClickedElementsProvider>
          <ProjectProvider>
            <HotkeysProvider initiallyActiveScopes={['*', 'global', 'kanban']}>
              <NiceModal.Provider>
                <AppContent />
              </NiceModal.Provider>
            </HotkeysProvider>
          </ProjectProvider>
        </ClickedElementsProvider>
      </UserSystemProvider>
    </BrowserRouter>
  );
}

export default App;
