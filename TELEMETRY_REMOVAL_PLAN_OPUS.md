# Telemetry Removal Plan — vibe-kanban

This document outlines every step required to fully remove **PostHog analytics** and **Sentry error tracking** from the vibe-kanban codebase.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Frontend — PostHog Removal](#2-frontend--posthog-removal)
3. [Frontend — Sentry Removal](#3-frontend--sentry-removal)
4. [Remote Frontend — PostHog Removal](#4-remote-frontend--posthog-removal)
5. [Backend (Local) — Analytics Service Removal](#5-backend-local--analytics-service-removal)
6. [Backend (Local) — Sentry Removal](#6-backend-local--sentry-removal)
7. [Remote Backend — Sentry Removal](#7-remote-backend--sentry-removal)
8. [Shared Types & Config](#8-shared-types--config)
9. [Build System & Dockerfiles](#9-build-system--dockerfiles)
10. [CI/CD Pipeline](#10-cicd-pipeline)
11. [Final Cleanup & Verification](#11-final-cleanup--verification)

---

## 1. Overview

| Service | Purpose | Components |
|---------|---------|------------|
| **PostHog** | Product analytics & event tracking | Frontend, Remote Frontend, Backend (local) |
| **Sentry** | Error tracking & performance monitoring | Frontend, Backend (local), Remote Backend |

### All Environment Variables to Remove

| Variable | Used By |
|----------|---------|
| `VITE_POSTHOG_API_KEY` | Frontend build |
| `VITE_POSTHOG_API_ENDPOINT` | Frontend build |
| `VITE_SENTRY_DSN` (unused at this commit — DSN is hardcoded) | — |
| `VITE_PUBLIC_POSTHOG_KEY` | Remote Frontend build / Dockerfile |
| `VITE_PUBLIC_POSTHOG_HOST` | Remote Frontend build / Dockerfile |
| `POSTHOG_API_KEY` | Backend compile-time (`build.rs`) |
| `POSTHOG_API_ENDPOINT` | Backend compile-time (`build.rs`) |
| `SENTRY_AUTH_TOKEN` | CI/CD (source map uploads) |
| `SENTRY_ORG` | CI/CD |
| `SENTRY_PROJECT` | CI/CD |

---

## 2. Frontend — PostHog Removal

### 2.1 Remove the dependency

**File:** `frontend/package.json`
- Remove `"posthog-js": "^1.276.0"` from dependencies (line 60)
- Run your package manager to update the lockfile

### 2.2 Remove PostHog initialization and provider wrapper

**File:** `frontend/src/main.tsx`

Remove:
- **Line 10:** `import posthog from 'posthog-js';`
- **Line 11:** `import { PostHogProvider } from 'posthog-js/react';`
- **Lines 38–54:** The entire `if (import.meta.env.VITE_POSTHOG_API_KEY ...) { posthog.init(...) } else { console.warn(...) }` block
- **Line 68:** `<PostHogProvider client={posthog}>` — unwrap the children (keep `<Sentry.ErrorBoundary>` or its replacement, and `<App />`)
- **Line 79:** The closing `</PostHogProvider>`

### 2.3 Remove analytics opt-in/opt-out logic in App.tsx

**File:** `frontend/src/App.tsx`

Remove:
- **Line 9:** `import { usePostHog } from 'posthog-js/react';`
- **Line 42:** `const posthog = usePostHog();`
- **Lines 46–57:** The entire `useEffect` block that calls `posthog.opt_in_capturing()`, `posthog.identify()`, and `posthog.opt_out_capturing()`

Also in App.tsx:
- **Line 37:** `const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);` — replace `SentryRoutes` with standard `Routes` throughout the JSX (line 119, line 158)
- **Line 28:** `import * as Sentry from '@sentry/react';` — remove (covered in Sentry section below)

### 2.4 Remove event tracking calls in ProjectTasks.tsx

**File:** `frontend/src/pages/ProjectTasks.tsx`

Remove:
- **Line 14:** `import { usePostHog } from 'posthog-js/react';`
- **Line 148 (approx):** `const posthog = usePostHog();` — (find the `usePostHog()` call)
- **Line 578:** `posthog?.capture('preview_navigated', {...})`
- **Line 585:** `posthog?.capture('diffs_navigated', {...})`
- **Line 611:** `posthog?.capture('preview_navigated', {...})`
- **Line 618:** `posthog?.capture('diffs_navigated', {...})`

For each capture call, remove the entire block including the surrounding `if` or callback that exists solely for tracking.

### 2.5 Remove event tracking in AttemptHeaderActions.tsx

**File:** `frontend/src/components/panels/AttemptHeaderActions.tsx`

Remove:
- **Line 14:** `import { usePostHog } from 'posthog-js/react';`
- **Line 36:** `const posthog = usePostHog();`
- **Lines 49–69:** The three `posthog?.capture(...)` calls inside the `onValueChange` handler:
  - Line 51: `posthog?.capture('preview_navigated', {...})`
  - Line 57: `posthog?.capture('diffs_navigated', {...})`
  - Line 64: `posthog?.capture('view_closed', {...})`

Keep the `onValueChange` callback itself — just remove the tracking calls from within it.

### 2.6 Remove analytics toggle in Settings

**File:** `frontend/src/pages/settings/GeneralSettings.tsx`

Remove the entire "Privacy" `<Card>` block (lines ~636–663) containing the `analytics-enabled` checkbox. This includes:
- The `<Card>` with CardHeader "Privacy"
- The `<Checkbox id="analytics-enabled" ...>` that toggles `draft?.analytics_enabled`
- The label and helper text referencing telemetry

### 2.7 Remove analytics i18n strings

**File:** `frontend/src/i18n/locales/en/settings.json`

Remove the privacy/telemetry section (lines ~165–172):
- `settings.general.privacy.title`
- `settings.general.privacy.description`
- `settings.general.privacy.telemetry.label`
- `settings.general.privacy.telemetry.helper`

Check other locale files (`ja`, `es`, `ko`, `zh_HANS`) for equivalent keys.

### 2.8 Remove analyticsUserId from ConfigProvider

**File:** `frontend/src/components/ConfigProvider.tsx`

Remove:
- **Line 26:** `analyticsUserId: string | null;` from `UserSystemState` interface
- **Line 44:** `analyticsUserId: string | null;` from `UserSystemContextType` interface
- **Line 76:** `const analyticsUserId = userSystemInfo?.analytics_user_id || null;`
- **Line 189:** `analyticsUserId,` from the `system` object in the memoized value
- **Line 196:** `analyticsUserId,` from the context value
- **Line 212:** `analyticsUserId,` from the `useMemo` dependency array

---

## 3. Frontend — Sentry Removal

### 3.1 Remove the dependencies

**File:** `frontend/package.json`

Remove:
- `"@sentry/react": "^9.34.0"` (line 41)
- `"@sentry/vite-plugin": "^3.5.0"` (line 42)

Run your package manager to update the lockfile.

### 3.2 Remove Sentry initialization

**File:** `frontend/src/main.tsx`

Remove:
- **Line 8:** `import * as Sentry from '@sentry/react';`
- **Lines 15–20:** React Router imports used only for Sentry (`useLocation`, `useNavigationType`, `createRoutesFromChildren`, `matchRoutes`) — check if any are used elsewhere first
- **Lines 22–36:** The entire `Sentry.init({...})` block and `Sentry.setTag('source', 'frontend')`
- **Lines 69–78:** Replace `<Sentry.ErrorBoundary fallback={...} showDialog>` with a plain wrapper or your own error boundary. Keep the children (`<ClickToComponent />`, `<VibeKanbanWebCompanion />`, `<App />`)

### 3.3 Remove SentryRoutes from App.tsx

**File:** `frontend/src/App.tsx`

- **Line 28:** Remove `import * as Sentry from '@sentry/react';`
- **Line 37:** Remove `const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);`
- **Line 119 & 158:** Replace `<SentryRoutes>` / `</SentryRoutes>` with plain `<Routes>` / `</Routes>`

### 3.4 Remove Sentry Vite plugin

**File:** `frontend/vite.config.ts`

- **Line 2:** Remove `import { sentryVitePlugin } from "@sentry/vite-plugin";`
- **Line 55:** Remove `sentryVitePlugin({ org: "bloop-ai", project: "vibe-kanban" }),` from the `plugins` array
- **Line 81:** Optionally remove `build: { sourcemap: true }` if source maps were only needed for Sentry

---

## 4. Remote Frontend — PostHog Removal

### 4.1 Remove the dependency

**File:** `remote-frontend/package.json`

- Remove `"posthog-js": "^1.283.0"` (line 17)
- Update lockfile

### 4.2 Remove PostHog initialization

**File:** `remote-frontend/src/main.tsx`

Remove:
- **Line 3:** `import posthog from "posthog-js";`
- **Line 4:** `import { PostHogProvider } from "posthog-js/react";`
- **Lines 8–12:** The entire `if (import.meta.env.VITE_PUBLIC_POSTHOG_KEY) { posthog.init(...) }` block
- **Line 16:** `<PostHogProvider client={posthog}>` — unwrap children
- **Line 18:** `</PostHogProvider>`

The resulting file should just render `<AppRouter />` directly.

### 4.3 Remove environment variable templates

**File:** `remote-frontend/.env.production.example`

- Remove **lines 7–9:** The `# PostHog analytics` comment and `VITE_PUBLIC_POSTHOG_KEY=` / `VITE_PUBLIC_POSTHOG_HOST=`

### 4.4 Search for additional tracking calls

Grep `remote-frontend/src/` for any `posthog.capture`, `posthog.identify` calls and remove.

---

## 5. Backend (Local) — Analytics Service Removal

### 5.1 Delete the analytics module

**File:** `crates/services/src/services/analytics.rs` — **Delete entirely**

This file (182 lines) contains:
- `AnalyticsContext` struct (lines 11–14)
- `AnalyticsConfig` struct and `new()` (lines 17–36)
- `AnalyticsService` struct, `new()`, and `track_event()` (lines 38–115)
- `generate_user_id()` function (lines 119–171) — generates machine-specific user ID
- `get_device_info()` helper (lines 173–182)
- Unit tests (lines 184–201)

### 5.2 Remove the module export

**File:** `crates/services/src/services/mod.rs`

- **Line 1:** Remove `pub mod analytics;`

### 5.3 Remove analytics from LocalDeployment

**File:** `crates/local-deployment/src/lib.rs`

Remove:
- **Line 8:** `analytics::{AnalyticsConfig, AnalyticsContext, AnalyticsService, generate_user_id},` from the `use services::services::{...}` block
- **Line 41:** `analytics: Option<AnalyticsService>,` from `LocalDeployment` struct
- **Line 91:** `let user_id = generate_user_id();` — replace with a fixed string or remove the `user_id` field if unused
- **Line 92:** `let analytics = AnalyticsConfig::new().map(AnalyticsService::new);`
- **Lines 163–168:** The `analytics_ctx` block that creates `AnalyticsContext`
- **Line 175:** `analytics_ctx,` argument to `LocalContainerService::new()`
- **Line 190:** `analytics,` in the `Self { ... }` struct initialization
- **Lines 221–223:** The `fn analytics(&self) -> &Option<AnalyticsService>` implementation

### 5.4 Remove analytics from the Deployment trait

**File:** `crates/deployment/src/lib.rs`

Remove:
- **Line 18:** `analytics::{AnalyticsContext, AnalyticsService},` from the `use services::services::{...}` block
- **Line 87:** `fn analytics(&self) -> &Option<AnalyticsService>;` from the trait definition
- **Lines 119–130:** `spawn_pr_monitor_service()` — remove the analytics parameter construction (lines 121–127), and pass `None` instead of `analytics` to `PrMonitorService::spawn()`
- **Lines 132–138:** Remove the entire `track_if_analytics_allowed()` method
- **Lines 188–199:** Remove the `track_if_analytics_allowed("project_created", ...)` call inside `trigger_auto_project_setup()`

### 5.5 Remove analytics from LocalContainerService

**File:** `crates/local-deployment/src/container.rs`

Remove:
- **Line 48:** `analytics::AnalyticsContext,` from imports
- **Line 80:** `analytics: Option<AnalyticsContext>,` from the struct
- **Line 95:** `analytics: Option<AnalyticsContext>,` from the `new()` parameter
- **Line 112:** `analytics,` from the struct initialization
- **Line 321:** `let analytics = self.analytics.clone();`
- **Lines 490–498:** The block that fires `"task_attempt_finished"` analytics event (checks `analytics_enabled` then calls `analytics.analytics_service.track_event(...)`)

### 5.6 Remove analytics from PrMonitorService

**File:** `crates/services/src/services/pr_monitor.rs`

Remove:
- **Line 18:** `analytics::AnalyticsContext,` from imports
- **Line 37:** `analytics: Option<AnalyticsContext>,` from the struct
- **Line 44:** `analytics: Option<AnalyticsContext>,` from the `spawn()` parameter
- **Line 50:** `analytics,` from struct initialization
- **Lines 133–139:** The block that fires `"pr_status_changed"` analytics event

### 5.7 Remove tracking calls from all route handlers

Each of these files contains `.track_if_analytics_allowed(...)` calls that must be removed. For each: remove the `.track_if_analytics_allowed(...)` call and its entire `await` chain, plus any variables that were only used to build the event properties.

| File | Lines | Events |
|------|-------|--------|
| `crates/server/src/main.rs` | 62 | `"session_start"` |
| `crates/server/src/routes/config.rs` | 170 | `"onboarding_disclaimer_accepted"`, `"onboarding_completed"`, `"analytics_session_start"` |
| `crates/server/src/routes/oauth.rs` | 160–209 | Auto-enable `analytics_enabled` on login (lines 160–194), `"analytics_session_start"` (185), `"$identify"` (202) |
| `crates/server/src/routes/approvals.rs` | 22 | `"tool_approval_requested"` |
| `crates/server/src/routes/images.rs` | 110 | `"image_uploaded"` |
| `crates/server/src/routes/tags.rs` | 44, 64 | `"tag_created"`, `"tag_updated"` |
| `crates/server/src/routes/tasks.rs` | 125, 167, 201, 367, 428 | `"task_created"`, `"task_updated"`, `"task_deleted"`, `"task_shared"`, `"start_sharing_task"` |
| `crates/server/src/routes/shared_tasks.rs` | 55, 75, 98 | `"reassign_shared_task"`, `"stop_sharing_task"`, `"link_shared_task_to_local"` |
| `crates/server/src/routes/projects.rs` | 185, 305, 397, 448 | `"project_created"`, `"project_updated"`, `"project_deleted"`, `"project_settings_updated"` |
| `crates/server/src/routes/organizations.rs` | 100, 144 | `"organization_created"`, `"organization_updated"` |
| `crates/server/src/routes/task_attempts.rs` | 167, 203, 563, 662, 886, 990, 1089, 1193, 1213, 1243, 1320, 1391, 1412 | `"task_attempt_started"`, `"agent_setup_script_executed"`, `"task_attempt_merged"`, `"task_attempt_editor_opened"`, `"task_attempt_target_branch_changed"`, `"task_attempt_branch_renamed"`, `"task_attempt_rebased"`, `"dev_server_started"`, `"dev_server_restarted"`, `"task_attempt_stopped"`, `"setup_script_executed"`, `"cleanup_script_executed"`, `"archive_script_executed"` |
| `crates/server/src/routes/task_attempts/pr.rs` | 276 | `"pull_request_created"` |
| `crates/server/src/routes/task_attempts/queue.rs` | 37, 60 | `"follow_up_queued"`, `"follow_up_dequeued"` |

**Special case — `oauth.rs` (lines 160–194):** This block auto-enables `analytics_enabled = true` on login. Remove the entire block that checks `analytics_enabled`, modifies config, and sends the `"analytics_session_start"` event. Also remove the `"$identify"` event at lines 199–209.

### 5.8 Remove compile-time environment variable injection

**File:** `crates/server/build.rs`

Remove lines 6–11:
```rust
if let Ok(api_key) = std::env::var("POSTHOG_API_KEY") {
    println!("cargo:rustc-env=POSTHOG_API_KEY={}", api_key);
}
if let Ok(api_endpoint) = std::env::var("POSTHOG_API_ENDPOINT") {
    println!("cargo:rustc-env=POSTHOG_API_ENDPOINT={}", api_endpoint);
}
```

Keep the `VK_SHARED_API_BASE` lines (12–14) and the frontend dist directory setup (16–28).

---

## 6. Backend (Local) — Sentry Removal

### 6.1 Delete the Sentry module

**File:** `crates/utils/src/sentry.rs` — **Delete entirely** (87 lines)

Contains:
- Hardcoded Sentry DSN (line 6): `https://1065a1d276a581316999a07d5dffee26@o4509603705192449.ingest.de.sentry.io/4509605576441937`
- `SentrySource` enum (lines 10–23)
- `init_once()` function (lines 33–48)
- `configure_user_scope()` function (lines 50–67)
- `sentry_layer()` tracing layer (lines 69–86)

### 6.2 Remove Sentry from utils module exports

**File:** `crates/utils/src/lib.rs`

- **Line 17:** Remove `pub mod sentry;`

### 6.3 Remove Sentry initialization from server main

**File:** `crates/server/src/main.rs`

Remove:
- **Line 13:** `sentry::{self as sentry_utils, SentrySource, sentry_layer},` from the `use utils::{...}` block
- **Line 30:** `sentry_utils::init_once(SentrySource::Backend);`
- **Line 40:** `.with(sentry_layer())` from the tracing subscriber chain
- **Line 49:** `deployment.update_sentry_scope().await?;`

### 6.4 Remove `update_sentry_scope` from Deployment trait

**File:** `crates/deployment/src/lib.rs`

- **Line 37:** Remove `use utils::sentry as sentry_utils;`
- **Lines 109–117:** Remove the `update_sentry_scope()` default method

### 6.5 Remove Sentry Cargo dependencies

**File:** `crates/utils/Cargo.toml`
- **Line 22:** Remove `sentry = { version = "0.41.0", features = [...] }`
- **Line 23:** Remove `sentry-tracing = { version = "0.41.0", features = [...] }`

**File:** `crates/server/Cargo.toml`
- **Line 36:** Remove `sentry = { version = "0.41.0", features = [...] }`

**File:** `crates/local-deployment/Cargo.toml`
- **Line 25:** Remove `sentry = { version = "0.41.0", features = [...] }`

---

## 7. Remote Backend — Sentry Removal

### 7.1 Remove Sentry from remote lib.rs

**File:** `crates/remote/src/lib.rs`

Remove:
- **Line 15:** `use sentry_tracing::{EventFilter, SentryLayer};`
- **Line 25:** `static INIT_GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();`
- **Line 43:** `.with(sentry_layer())` from the tracing subscriber chain
- **Lines 47–69:** `environment()` and `sentry_init_once()` functions (including the hardcoded remote Sentry DSN at line 58)
- **Lines 72–89:** `configure_user_scope()` function
- **Lines 91–108:** `sentry_layer()` function

### 7.2 Remove Sentry initialization from remote main

**File:** `crates/remote/src/main.rs`

- **Line 1:** Remove `sentry_init_once` from the import
- **Line 5:** Remove `sentry_init_once();`

### 7.3 Remove Sentry Cargo dependencies

**File:** `crates/remote/Cargo.toml`
- **Line 17:** Remove `sentry = { version = "0.41.0", features = [...] }`
- **Line 18:** Remove `sentry-tracing = { version = "0.41.0", features = [...] }`

---

## 8. Shared Types & Config

### 8.1 Remove analytics fields from TypeScript types

**File:** `shared/types.ts`

- **Line 175:** In `UserSystemInfo`, remove `analytics_user_id: string,`
- **Line 273:** In `Config`, remove `analytics_enabled: boolean,`

### 8.2 Remove analytics fields from Rust Config struct

Find the Rust `Config` struct (likely in `crates/services/src/services/config.rs`):
- Remove the `analytics_enabled: bool` field
- Remove any default value for it
- Remove the `analytics_user_id` field from the user system info response

### 8.3 Remove from API responses

**File:** `crates/server/src/routes/config.rs`

- **Lines 75, 94:** Remove `analytics_user_id` from the `UserSystemInfo` response construction
- **Lines 145–174:** Remove the `track_config_events()` function entirely

---

## 9. Build System & Dockerfiles

### 9.1 Dockerfile

**File:** `Dockerfile`

Remove:
- **Line 19:** `ARG POSTHOG_API_KEY`
- **Line 20:** `ARG POSTHOG_API_ENDPOINT`
- **Line 22:** `ENV VITE_PUBLIC_POSTHOG_KEY=$POSTHOG_API_KEY`
- **Line 23:** `ENV VITE_PUBLIC_POSTHOG_HOST=$POSTHOG_API_ENDPOINT`

### 9.2 Build script

**File:** `crates/server/build.rs`

Remove PostHog env var injection (lines 6–11) as described in section 5.8.

---

## 10. CI/CD Pipeline

**File:** `.github/workflows/pre-release.yml`

### 10.1 Frontend build step (line ~143)

Remove from the `Build frontend` step environment:
- **Line 146:** `SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}`
- **Line 147:** `VITE_POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}`
- **Line 148:** `VITE_POSTHOG_API_ENDPOINT: ${{ secrets.POSTHOG_API_ENDPOINT }}`

### 10.2 Remove Sentry release step (lines 150–160)

Delete the entire `Create Sentry release` step:
```yaml
- name: Create Sentry release
  uses: getsentry/action-release@v3
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
    SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
  with:
    release: ${{ needs.bump-version.outputs.new_version }}
    environment: production
    sourcemaps: "./frontend/dist"
    ignore_missing: true
```

### 10.3 Backend build steps (lines ~232–252)

Remove PostHog env vars from both "Build backend (Linux)" and "Build backend (non-Linux)" steps:
- **Line 239:** `POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}`
- **Line 240:** `POSTHOG_API_ENDPOINT: ${{ secrets.POSTHOG_API_ENDPOINT }}`
- **Line 250:** `POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}`
- **Line 251:** `POSTHOG_API_ENDPOINT: ${{ secrets.POSTHOG_API_ENDPOINT }}`

Keep `VK_SHARED_API_BASE` — that's not telemetry.

### 10.4 Remove Sentry CLI steps (lines 254–263)

Delete the `Setup Sentry CLI` step:
```yaml
- name: Setup Sentry CLI
  uses: matbour/setup-sentry-cli@v2
  with:
    token: ${{ secrets.SENTRY_AUTH_TOKEN }}
    organization: ${{ secrets.SENTRY_ORG }}
    project: ${{ secrets.SENTRY_PROJECT }}
    version: 2.21.2
```

Delete the `Upload source maps to Sentry` step:
```yaml
- name: Upload source maps to Sentry
  run: sentry-cli debug-files upload --include-sources target/${{ matrix.target }}/release
```

---

## 11. Final Cleanup & Verification

### 11.1 Grep for remaining references

Run these searches across the entire repo to catch anything missed:

```bash
# PostHog
grep -rn "posthog\|PostHog\|POSTHOG" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.toml" --include="*.yml" --include="*.yaml" --include="Dockerfile*"

# Sentry
grep -rn "sentry\|Sentry\|SENTRY" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.toml" --include="*.yml" --include="*.yaml" --include="Dockerfile*"

# Analytics (broader)
grep -rn "analytics_enabled\|analytics_user_id\|track_if_analytics_allowed\|track_event\|AnalyticsService\|AnalyticsContext\|AnalyticsConfig" --include="*.rs" --include="*.ts" --include="*.tsx"
```

### 11.2 Build verification

```bash
# Frontend
cd frontend && pnpm install && pnpm run build

# Remote Frontend
cd remote-frontend && pnpm install && pnpm run build

# Backend
cargo build --workspace
```

### 11.3 Test verification

```bash
cargo test --workspace
cd frontend && pnpm test
```

### 11.4 Lockfile updates

- Regenerate `pnpm-lock.yaml` for both `frontend/` and `remote-frontend/`
- Run `cargo update` if needed to clean up unused transitive Sentry/reqwest dependencies

### 11.5 Remove GitHub repository secrets (post-deploy)

After deploying a build without telemetry, remove these secrets from the GitHub repo settings:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `POSTHOG_API_KEY`
- `POSTHOG_API_ENDPOINT`

---

## Summary Checklist

- [ ] **Frontend PostHog:** Remove `posthog-js` dep, init in `main.tsx`, opt-in/out in `App.tsx`, capture calls in `ProjectTasks.tsx` and `AttemptHeaderActions.tsx`, analytics toggle in `GeneralSettings.tsx`, i18n strings, `analyticsUserId` from `ConfigProvider.tsx`
- [ ] **Frontend Sentry:** Remove `@sentry/react` + `@sentry/vite-plugin` deps, `Sentry.init()` in `main.tsx`, `Sentry.ErrorBoundary`, `SentryRoutes` in `App.tsx`, `sentryVitePlugin` in `vite.config.ts`
- [ ] **Remote Frontend:** Remove `posthog-js` dep, init in `main.tsx`, `.env.production.example` entries
- [ ] **Backend Analytics Service:** Delete `crates/services/src/services/analytics.rs`, remove `pub mod analytics;`, remove from `LocalDeployment`, `Deployment` trait, `LocalContainerService`, `PrMonitorService`
- [ ] **Backend Route Tracking:** Remove `track_if_analytics_allowed` calls from 14 route files (~37 call sites), special-case `oauth.rs` auto-enable logic
- [ ] **Backend Sentry:** Delete `crates/utils/src/sentry.rs`, remove from `main.rs` tracing setup, `Deployment` trait, 4 Cargo.toml files
- [ ] **Remote Backend Sentry:** Remove from `crates/remote/src/lib.rs` and `main.rs`, 1 Cargo.toml
- [ ] **Shared Types:** Remove `analytics_enabled` from `Config`, `analytics_user_id` from `UserSystemInfo`
- [ ] **Build System:** Clean `build.rs` and `Dockerfile`
- [ ] **CI/CD:** Remove Sentry release + CLI steps, PostHog build args from `.github/workflows/pre-release.yml`
- [ ] **Verify:** Grep, build, test
- [ ] **Deploy & Cleanup:** Remove GitHub repo secrets
