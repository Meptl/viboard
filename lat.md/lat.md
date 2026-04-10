This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[electron-dev]] — Desktop runtime behavior for local Electron development.
- [[project-navigation]] — Documents Escape-key behavior for exiting project task view to all projects.
- [[project-settings]] — Documents copy-files selector interaction behavior in project settings.
- [[ascii-block-text]] — Documents the terminal block-text generator and optional box-drawing drop shadow mode.
- [[rebase-abort-auto-commit]] — Documents cleanup of synthetic rebase auto-commit when conflicts are aborted.
- [[lazy-diff-loading]] — Documents metadata-first diff streaming and on-demand file content loading for diff views.
- [[config-v7]] — Documents v7 migration-chain compatibility for older config schemas.
- [[worktree-submodules]] — Documents worktree creation behavior that initializes submodules in new worktrees.
- [[task-attempt-startup-failures]] — Documents create-attempt startup failure propagation and orphan cleanup behavior.
- [[dark-theme-comment-actions]] — Documents dark-theme readability styling for draft comment edit/delete action icons.
- [[setup-script-stale-cleanup]] — Documents retaining setup-script subprocesses in review and cleaning them when attempts become stale.
- [[setup-node-pnpm-cache]] — Documents CI setup order that avoids pnpm cache lookup before pnpm installation.
- [[settings-storage]] — Documents where settings are persisted across config files, SQLite tables, and browser local storage.
- [[merge-dirty-worktree-blocking]] — Documents blocking merge when the base worktree has tracked local edits and surfacing a user warning instead of creating a chore commit.
- [[task-follow-up-setup-action]] — Documents the follow-up action-bar Run Setup control placed immediately left of Send and how it reruns the project setup script.
- [[codex-thread-resume-compatibility]] — Documents protocol dependency updates that add native `ContextCompaction` decoding for `thread/resume`.
- [[codex-default-autonomy]] — Documents Codex default profile policy using `danger-full-access` sandboxing.
- [[codex-mcp-server-requests]] — Documents Codex app-server handling for MCP-related request types and dynamic tool call fallback responses.
