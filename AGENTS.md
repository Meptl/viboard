# Overview
This is a kanban board system that interacts with AI agents and git.

## User naming
When referencing items the user may use these terms:
- Project page: The task view of a project at /projects/ID/tasks (route: frontend/src/App.tsx, page: frontend/src/pages/ProjectTasks.tsx)
- Project list: The projects page and home page at / or /projects (routes: frontend/src/App.tsx, page: frontend/src/pages/Projects.tsx, component: frontend/src/components/projects/ProjectList.tsx)
- Task page: When clicking a task, we enter a page with a split view of a chat window and diff/preview of the task attempt (route: frontend/src/App.tsx, page: frontend/src/pages/ProjectTasks.tsx, layout: frontend/src/components/layout/TasksLayout.tsx)
- Attempt page: Same as task page
- Chat window: Part of the task page (component: frontend/src/components/panels/TaskAttemptPanel.tsx)
- Diff view: Part of the task page (component: frontend/src/components/panels/DiffsPanel.tsx)
- Preview view: Part of the task page (component: frontend/src/components/panels/PreviewPanel.tsx)
- Settings page: General or project settings management page at /settings (route: frontend/src/App.tsx, layout: frontend/src/pages/settings/SettingsLayout.tsx, pages: frontend/src/pages/settings/GeneralSettings.tsx and frontend/src/pages/settings/ProjectSettings.tsx)
- Agent sidebar: A sidebar on the project page for openclaw with two sections. (component: frontend/src/components/layout/AgentsSidebar.tsx)
    An Agents list and a tabbed window of Memory, Crons, and Chat for management
    of openclaw.
- Openclaw sidebar: Same as agent sidebar
- Agents list: Part of the agent sidebar. (component: frontend/src/components/layout/AgentsList.tsx)
- Memory tab: Part of the agent sidebar. (component: frontend/src/components/layout/MemoryTab.tsx)
- Crons tab: Part of the agent sidebar. (component: frontend/src/components/layout/CronsTab.tsx)
- Agent chat: Part of the agent sidebar. (component: frontend/src/components/layout/ChatTab.tsx)
- Openclaw chat: Same as Agent chat.

## Testing
You can use the playwright tests which can start you a frontend and backend instance for testing purposes.
Openclaw gateway should be running.

### Local Test Fixture Startup
Use the sparse fixture stack for quick manual/e2e checks:

`pnpm run dev:test-fixture`

This command:
- allocates/reuses frontend/backend ports
- writes them to `.dev-ports.json`
- starts backend with `VIBOARD_ASSET_DIR=tests/fixtures/sparse_config`
- starts frontend with matching `FRONTEND_PORT`/`BACKEND_PORT`

Useful helpers:
- `node scripts/setup-dev-environment.js get` prints the currently assigned ports and JSON
- read `.dev-ports.json` for the active frontend/backend port pair
