# Telemetry Removal Plan

This document outlines the steps to remove telemetry entirely from this repository across frontend and backend systems.

## Scope

Telemetry currently exists in two forms:
- Product analytics: PostHog (frontend + backend event capture)
- Error/trace reporting: Sentry (frontend + Rust services)

The goal is to remove both from application code, build pipelines, and documentation.

## 1. Frontend Removal (main `frontend/`)

### 1.1 Remove analytics and error-reporting runtime integration

- Edit `frontend/src/main.tsx`:
  - Remove `@sentry/react` imports and `Sentry.init(...)`.
  - Remove `Sentry.setTag(...)`.
  - Remove `posthog-js` + `PostHogProvider` initialization.
  - Remove `PostHogProvider` and `Sentry.ErrorBoundary` wrappers from the root render tree.
  - Render `<App />` directly under existing providers.

- Edit `frontend/src/App.tsx`:
  - Remove `usePostHog` import and usage.
  - Remove `Sentry.withSentryReactRouterV6Routing` and use `Routes` directly.
  - Remove analytics opt-in/opt-out `useEffect` tied to `config.analytics_enabled`.

- Edit direct event capture call sites:
  - `frontend/src/components/panels/AttemptHeaderActions.tsx`: remove `usePostHog` and `capture(...)` calls.
  - `frontend/src/pages/ProjectTasks.tsx`: remove `usePostHog` and keyboard navigation `capture(...)` calls.

### 1.2 Remove settings/UI references

- Edit `frontend/src/pages/settings/GeneralSettings.tsx`:
  - Remove the telemetry checkbox block under privacy settings (`analytics_enabled`).

- Edit i18n files and remove telemetry strings:
  - `frontend/src/i18n/locales/en/settings.json`
  - `frontend/src/i18n/locales/es/settings.json`
  - `frontend/src/i18n/locales/ja/settings.json`
  - `frontend/src/i18n/locales/ko/settings.json`
  - `frontend/src/i18n/locales/zh-Hans/settings.json`

### 1.3 Remove telemetry-related dependencies/build plugins

- Edit `frontend/package.json`:
  - Remove dependencies: `posthog-js`, `@sentry/react`, `@sentry/vite-plugin`.

- Edit `frontend/vite.config.ts`:
  - Remove `sentryVitePlugin` import and plugin entry.

## 2. Backend Removal (Rust crates)

### 2.1 Remove analytics service and usage

- Remove analytics module export:
  - `crates/services/src/services/mod.rs`: remove `pub mod analytics;`.

- Remove analytics implementation file:
  - Delete `crates/services/src/services/analytics.rs`.

- Remove analytics wiring from deployment trait and implementations:
  - `crates/deployment/src/lib.rs`:
    - Remove `AnalyticsService`/`AnalyticsContext` imports and `fn analytics(...)` trait method.
    - Remove `track_if_analytics_allowed(...)` method.
    - Remove analytics wiring from `spawn_pr_monitor_service(...)`.
    - Remove `update_sentry_scope(...)` (or replace with no-op if needed during transition).

  - `crates/local-deployment/src/lib.rs`:
    - Remove `analytics` field from `LocalDeployment`.
    - Remove `generate_user_id()` usage and `user_id` generation for telemetry.
    - Remove `AnalyticsConfig::new().map(AnalyticsService::new)` construction.
    - Remove `AnalyticsContext` creation and passing into `LocalContainerService` / `PrMonitorService`.
    - Remove `fn analytics(...)` implementation.

  - `crates/local-deployment/src/container.rs`:
    - Remove `analytics` field from `LocalContainerService` and constructor.
    - Remove `task_attempt_finished` tracking block.

  - `crates/services/src/services/pr_monitor.rs`:
    - Remove analytics field/parameter and `pr_merged` tracking.

- Remove analytics usage in route handlers:
  - Replace `.track_if_analytics_allowed(...)` calls with no-op behavior in:
    - `crates/server/src/main.rs`
    - `crates/server/src/routes/config.rs`
    - `crates/server/src/routes/oauth.rs`
    - `crates/server/src/routes/organizations.rs`
    - `crates/server/src/routes/projects.rs`
    - `crates/server/src/routes/tasks.rs`
    - `crates/server/src/routes/task_attempts.rs`
    - `crates/server/src/routes/task_attempts/pr.rs`
    - `crates/server/src/routes/task_attempts/queue.rs`
    - `crates/server/src/routes/approvals.rs`
    - `crates/server/src/routes/tags.rs`
    - `crates/server/src/routes/shared_tasks.rs`
    - `crates/server/src/routes/images.rs`

### 2.2 Remove Sentry integration

- Remove Sentry helpers from shared utils:
  - `crates/utils/src/lib.rs`: remove `pub mod sentry;`.
  - Delete `crates/utils/src/sentry.rs`.

- Remove Sentry from server startup:
  - `crates/server/src/main.rs`: remove `sentry_utils::init_once(...)`, `sentry_layer()`, and `update_sentry_scope()` call.

- Remove Sentry from MCP task server:
  - `crates/server/src/bin/mcp_task_server.rs`: remove Sentry init and tracing layer usage.

- Remove Sentry from remote service:
  - `crates/remote/src/main.rs`: remove `sentry_init_once()` call.
  - `crates/remote/src/lib.rs`: remove all Sentry init/layer/user-scope helpers and tracing layer integration.

### 2.3 Remove telemetry config fields and API shape

- Remove config field from current schema:
  - `crates/services/src/services/config/versions/v8.rs`: remove `analytics_enabled` from `Config`, conversion logic, and default.

- Keep older migration structs as backward-compat history unless you intentionally rewrite historical migrations.

- Remove API response field for analytics identity:
  - `crates/server/src/routes/config.rs`: remove `analytics_user_id` from `UserSystemInfo` and response payload.

- Regenerate shared TS types after backend type changes:
  - Run `pnpm run generate-types` (updates `shared/types.ts`).

### 2.4 Remove backend build-time telemetry envs

- Edit `crates/server/build.rs`:
  - Remove `POSTHOG_API_KEY` and `POSTHOG_API_ENDPOINT` passthrough.

## 3. Remote Frontend Removal (`remote-frontend/`)

- Edit `remote-frontend/src/main.tsx`:
  - Remove `posthog-js` imports/init and `PostHogProvider` wrapper.

- Edit `remote-frontend/src/vite-env.d.ts`:
  - Remove `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` types.

- Edit `remote-frontend/package.json`:
  - Remove `posthog-js` dependency.

- Edit `remote-frontend/.env.production.example`:
  - Remove PostHog variables.

## 4. CI/CD, Build, and Infra Cleanup

- Edit `frontend/vite.config.ts` and workflows to stop Sentry release steps.

- Edit `.github/workflows/pre-release.yml`:
  - Remove frontend build env vars: `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_API_ENDPOINT`.
  - Remove backend build env vars: `POSTHOG_API_KEY`, `POSTHOG_API_ENDPOINT`.
  - Remove Sentry release creation and source-map upload steps.
  - Remove Sentry CLI setup step.
  - Remove Sentry/PostHog secret dependencies in this workflow.

- Edit `Dockerfile`:
  - Remove `ARG POSTHOG_API_KEY`, `ARG POSTHOG_API_ENDPOINT`.
  - Remove `ENV VITE_PUBLIC_POSTHOG_KEY=...`, `ENV VITE_PUBLIC_POSTHOG_HOST=...`.

- Remove any leftover Sentry/PostHog env docs/secrets references in deployment manifests and scripts.

## 5. Dependency Cleanup

- Rust crates: remove `sentry` / `sentry-tracing` from:
  - `crates/server/Cargo.toml`
  - `crates/utils/Cargo.toml`
  - `crates/local-deployment/Cargo.toml`
  - `crates/remote/Cargo.toml`

- JS packages: remove telemetry deps from:
  - `frontend/package.json`
  - `remote-frontend/package.json`

- Refresh lockfiles:
  - `pnpm install`
  - `cargo check --workspace` (regenerates `Cargo.lock` as needed)

## 6. Documentation Cleanup

- Edit `README.md` and remove PostHog env variable entries.

- Edit `docs/configuration-customisation/global-settings.mdx`:
  - Remove Telemetry section and telemetry notice references.

- Search docs for telemetry references and remove/update wording.

## 7. Validation Checklist

After changes:

- Frontend checks:
  - `pnpm run check`
  - `pnpm run lint`

- Backend checks:
  - `pnpm run backend:check`
  - `cargo test --workspace`

- Type generation:
  - `pnpm run generate-types`
  - Verify `shared/types.ts` no longer contains `analytics_enabled` or `analytics_user_id`.

- Repository grep audit:
  - `rg -n "posthog|analytics_enabled|analytics_user_id|track_if_analytics_allowed|sentry|telemetry" .`
  - Confirm only intentional historical mentions remain (e.g., migration history notes if kept).

## 8. Suggested Execution Order

1. Remove runtime integrations (frontend + backend code paths).
2. Remove config/API schema fields and regenerate shared types.
3. Remove dependencies and build/plugin wiring.
4. Remove CI/CD and Docker telemetry env usage.
5. Update docs.
6. Run full validation checklist and final grep audit.

## Notes on Backward Compatibility

- Existing user config files may still contain `analytics_enabled`.
- If you remove the field from `v8::Config`, ensure serde ignores unknown fields (default serde behavior) so old config files still load.
- If strict migration semantics are required, create `v9` config without telemetry fields and migrate from `v8` to `v9`.
