# Remove Login Functionality Plan

## Goal

Remove GitHub/Google OAuth sign-in and all app login-dependent behavior from the frontend and local backend.

## Scope Clarification

This repo currently ties login to remote collaboration features (organizations, invitations, shared tasks, remote project linking).  
To fully remove login functionality, remove those login-dependent features as well.

Non-goal unless explicitly requested: GitHub CLI auth flows (`gh auth login`) used for PR tooling are separate from app OAuth login.

## Implementation Strategy

1. Remove login UX first (no sign-in/sign-out controls, no OAuth dialogs/prompts).
2. Remove frontend auth hooks and API clients.
3. Remove organization and sharing UI/routes that require authentication.
4. Remove backend `/api/auth/*` endpoints and login status plumbing.
5. Remove local OAuth credential/session handling.
6. Regenerate shared types, then run full checks.

## Detailed Steps

### 1. Frontend: remove auth entry points and settings surface

- Remove OAuth dialog and login prompt components:
  - `frontend/src/components/dialogs/global/OAuthDialog.tsx`
  - `frontend/src/components/dialogs/shared/LoginRequiredPrompt.tsx`
  - exports in `frontend/src/components/dialogs/index.ts`
- Remove navbar sign-in/sign-out behavior:
  - `frontend/src/components/layout/Navbar.tsx`
  - drop `OAuthDialog`, `oauthApi.logout()`, `isOAuthLoggedIn`, and login-dependent menu item.
- Remove organization settings route/tab:
  - `frontend/src/pages/settings/SettingsLayout.tsx`
  - `frontend/src/App.tsx` (`/settings/organizations` route)
  - `frontend/src/pages/settings/index.ts` export of `OrganizationSettings`
  - optional delete if unused: `frontend/src/pages/settings/OrganizationSettings.tsx`

### 2. Frontend: delete auth hooks and login state usage

- Remove auth hooks:
  - `frontend/src/hooks/auth/useAuth.ts`
  - `frontend/src/hooks/auth/useAuthMutations.ts`
  - `frontend/src/hooks/auth/useAuthStatus.ts`
  - `frontend/src/hooks/auth/useCurrentUser.ts`
  - clean exports in `frontend/src/hooks/index.ts`
- Remove `loginStatus` from user system context:
  - `frontend/src/components/ConfigProvider.tsx`
- Update consumers to no longer gate on login:
  - `frontend/src/hooks/useProjectTasks.ts`
  - `frontend/src/hooks/useAutoLinkSharedTasks.ts`
  - `frontend/src/hooks/useUserOrganizations.ts` (likely remove entire org hook if org features are removed)
  - `frontend/src/App.tsx` (remove `useAuth` dependency in effect deps)

### 3. Frontend: remove login-dependent collaboration flows

- Remove or redesign dialogs/features that currently require OAuth login:
  - `frontend/src/components/dialogs/tasks/ShareDialog.tsx`
  - `frontend/src/components/dialogs/projects/LinkProjectDialog.tsx`
  - `frontend/src/components/ui/actions-dropdown.tsx`
  - `frontend/src/components/tasks/TaskCard.tsx`
- Remove token-based remote API usage:
  - `frontend/src/lib/remoteApi.ts`
  - `frontend/src/lib/electric/config.ts`

If sharing/organizations are out of product scope, remove related hooks/components entirely (`useOrganization*`, org dialogs/components, settings i18n entries).

### 4. Frontend: API client cleanup

- Remove `oauthApi` from `frontend/src/lib/api.ts`:
  - `handoffInit`, `status`, `logout`, `getToken`, `getCurrentUser`
- Remove associated type usage from frontend after shared types update.

### 5. Backend (local server): remove auth routes and status exposure

- Remove OAuth router:
  - delete `crates/server/src/routes/oauth.rs`
  - remove module and merge in `crates/server/src/routes/mod.rs`
- Remove login status from user system info:
  - `crates/server/src/routes/config.rs` (`UserSystemInfo.login_status`, `get_login_status()` call)
- Remove auth-dependent guards in task routes:
  - `crates/server/src/routes/tasks.rs` (`ensure_shared_task_auth`, `auth_context` token access paths)
- Remove `/api/organizations` and remote-linked project routes if collaboration is removed:
  - `crates/server/src/routes/organizations.rs`
  - auth-dependent parts of `crates/server/src/routes/projects.rs`

### 6. Backend (local deployment/services): remove OAuth state

- Remove OAuth credentials and auth context wiring:
  - `crates/local-deployment/src/lib.rs` (`auth_context`, `oauth_handoffs`, `get_login_status`, handoff storage)
  - `crates/deployment/src/lib.rs` trait methods that expose auth context if unused
  - `crates/services/src/services/auth.rs`
  - `crates/services/src/services/oauth_credentials.rs`
- Remove token-auth methods in remote client if no longer needed:
  - `crates/services/src/services/remote_client.rs`

### 7. Shared types and generator

- Remove OAuth/login types and references from generator inputs:
  - `crates/server/src/bin/generate_types.rs` (`LoginStatus`, `StatusResponse`, `TokenResponse`, `CurrentUserResponse`)
  - `crates/utils/src/api/oauth.rs` (delete if no longer used)
- Update backend structs that previously embedded login fields:
  - `crates/server/src/routes/config.rs` (`UserSystemInfo`)
- Regenerate TS types:
  - `pnpm run generate-types`

### 8. i18n and docs cleanup

- Remove OAuth/login/organization strings (all locales):
  - `frontend/src/i18n/locales/*/common.json` (`oauth`, `signOut`)
  - `frontend/src/i18n/locales/*/settings.json` (`organizations`)
  - `frontend/src/i18n/locales/*/organization.json`
  - login-required strings in `tasks.json` and `projects.json`
- Update docs/screenshots referencing sign-in or organization settings.

### 9. Optional: remote service cleanup (if removing auth from full platform)

If remote service remains part of runtime, also remove OAuth/session features there:

- `crates/remote/src/routes/oauth.rs`
- `crates/remote/src/auth/*` (handoff/providers/middleware/token validator/jwt)
- `crates/remote/src/db/oauth*.rs`, `crates/remote/src/db/auth.rs`
- OAuth-related migrations in `crates/remote/migrations/*oauth*`

Do this only if remote deployment should also become fully non-authenticated.

## Order of Execution (Recommended)

1. Frontend login UX removal (`Navbar`, dialogs, settings route/tab).
2. Frontend auth hooks + `oauthApi` removal.
3. Server auth routes + config `login_status` removal.
4. Local deployment/service OAuth plumbing removal.
5. Shared type generation update.
6. i18n/docs cleanup.
7. Compile/test fixes.

## Validation Checklist

Run after each major phase:

- `pnpm run check`
- `pnpm run lint`
- `pnpm run backend:check`
- `cargo test --workspace`
- `pnpm run generate-types`

Manual verification:

- No Sign in/Sign out controls in navbar.
- Settings has no Organization section.
- No OAuth popup or `/api/auth/*` calls from frontend network traffic.
- App starts and normal project/task flows still work.
- No runtime errors from missing `login_status` or auth hooks.

