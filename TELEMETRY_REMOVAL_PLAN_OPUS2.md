# Removing Telemetry from Vibe Kanban

This document outlines every change needed to fully remove telemetry from the repository. Two systems are in use:

- **Sentry** — error reporting/monitoring (backend + frontend)
- **PostHog** — analytics/event tracking (backend + frontend)

---

## Backend (Rust)

### 1. Remove the `analytics.rs` service

Delete the entire analytics service file:

```
vibe-kanban/crates/services/src/services/analytics.rs
```

Then remove any module declaration for it in the parent module file (likely `services/src/services/mod.rs` — remove the `pub mod analytics;` line).

### 2. Remove the `sentry.rs` utility

Delete the Sentry utility file:

```
vibe-kanban/crates/utils/src/sentry.rs
```

Remove its module declaration in `crates/utils/src/lib.rs` (remove `pub mod sentry;`).

### 3. Clean up `crates/server/src/main.rs`

- Remove the `sentry_utils::init_once(SentrySource::Backend)` call.
- Remove any `use` import for `sentry_utils`.
- Remove `deployment.update_sentry_scope().await?` (or equivalent call).

### 4. Clean up `crates/server/build.rs`

Remove the entire block that reads and forwards PostHog environment variables:

```rust
if let Ok(api_key) = std::env::var("POSTHOG_API_KEY") {
    println!("cargo:rustc-env=POSTHOG_API_KEY={}", api_key);
}
if let Ok(api_endpoint) = std::env::var("POSTHOG_API_ENDPOINT") {
    println!("cargo:rustc-env=POSTHOG_API_ENDPOINT={}", api_endpoint);
}
```

If this is the only content in `build.rs`, delete the file entirely.

### 5. Clean up `crates/server/src/routes/config.rs`

Remove all `track_if_analytics_allowed()` / analytics calls:

- `onboarding_disclaimer_accepted`
- `onboarding_completed`
- `analytics_session_start`

Remove any imports for the analytics service.

### 6. Clean up `crates/server/src/routes/organizations.rs`

Remove analytics calls:

- `organization_created`
- `invitation_created`

### 7. Clean up `crates/server/src/routes/task_attempts/queue.rs`

Remove any task execution event tracking calls.

### 8. Clean up `crates/server/src/routes/oauth.rs`

Remove any OAuth flow event tracking calls.

### 9. Clean up `crates/deployment/src/lib.rs`

- Remove `session_start` and `project_created` event tracking.
- Remove the `track_if_analytics_allowed()` method from the deployment trait (and any default implementation).
- Remove `update_sentry_scope()` method.
- Remove the `analytics()` method from the trait.

### 10. Clean up `crates/local-deployment/src/lib.rs`

- Remove analytics initialization.
- Remove any Sentry initialization.

### 11. Clean up `crates/remote/src/lib.rs`

- Remove the Sentry initialization block (including the hard-coded remote DSN).
- Remove the `update_sentry_scope()` implementation.

### 12. Remove analytics-related fields from config

In `crates/services/src/services/config/versions/v8.rs` (and any subsequent version), remove:

- `analytics_enabled: bool`
- `disclaimer_acknowledged: bool`
- `telemetry_acknowledged: bool` (deprecated, if still present)

Update the config migration/version logic accordingly. If removing these fields constitutes a schema change, bump the config version and add a migration.

Also remove any references to `analytics_enabled` in the config service that reads/writes it (e.g., in `config.rs` route handlers or config service methods).

### 13. Remove `AnalyticsService` from app state

Find where `AnalyticsService` is constructed and stored in the application state (likely in `main.rs` or a state initialization module). Remove:

- Construction of `AnalyticsService` / `AnalyticsConfig`
- The `analytics` field from the app state struct
- The `analytics()` accessor method

### 14. Remove `generate_user_id()` and related user ID logic

`generate_user_id()` exists solely to produce an anonymous analytics ID. Remove it and any stored `analytics_user_id` / `user_id()` fields that exist only for telemetry.

If a user ID is needed elsewhere (e.g., authentication), keep only that usage and remove the analytics-specific ID generation.

### 15. Remove Rust telemetry dependencies

In `crates/utils/Cargo.toml`, remove:

```toml
sentry = { version = "0.41.0", features = ["anyhow", "backtrace", "panic", "debug-images"] }
sentry-tracing = { version = "0.41.0", features = ["backtrace"] }
```

In `crates/services/Cargo.toml` (or wherever `os_info` is declared), remove:

```toml
os_info = "3.12.0"
```

Remove `reqwest` only if it is not used for any other HTTP calls in the services crate. If it is used elsewhere, keep it.

Run `cargo check` to confirm no remaining compilation errors.

---

## Frontend (React/TypeScript)

### 16. Remove Sentry initialization from `frontend/src/main.tsx`

Remove the `Sentry.init(...)` block entirely, including:

- `tracesSampleRate`
- `environment`
- `integrations: [Sentry.reactRouterV6BrowserTracingIntegration(...)]`
- `Sentry.setTag('source', 'frontend')`

Remove the `import * as Sentry from '@sentry/react'` import.

If `<PostHogProvider>` wrapping is also in this file, remove it too (see step 18).

### 17. Remove PostHog initialization from `frontend/src/main.tsx`

Remove the `posthog.init(...)` block and any conditional check on `VITE_POSTHOG_API_KEY` / `VITE_POSTHOG_API_ENDPOINT`.

Remove the `import posthog from 'posthog-js'` import.

Remove the `<PostHogProvider>` wrapper component from the React tree.

Remove the `import { PostHogProvider } from 'posthog-js/react'` import.

### 18. Remove PostHog user identification from `frontend/src/App.tsx`

Remove the `useEffect` block that calls:

```typescript
posthog.opt_in_capturing();
posthog.identify(analyticsUserId);
// or
posthog.opt_out_capturing();
```

Remove any `analyticsUserId` state or derived value that exists solely for PostHog.

Remove posthog imports from this file.

### 19. Remove event calls from `frontend/src/pages/ProjectTasks.tsx`

Remove all `posthog.capture(...)` calls:

- `preview_navigated`
- `diffs_navigated`

Remove any posthog import from this file.

### 20. Remove event calls from `frontend/src/components/panels/AttemptHeaderActions.tsx`

Remove all `posthog.capture(...)` calls:

- `preview_navigated`
- `diffs_navigated`
- `view_closed`

Remove any posthog import from this file.

### 21. Remove analytics toggle from the settings UI

Find the settings page/component that renders the analytics enable/disable checkbox (tied to `analytics_enabled` in config). Remove the toggle and any surrounding explanatory text.

### 22. Remove frontend npm dependencies

In `frontend/package.json`, remove:

```json
"@sentry/react": "^9.34.0",
"@sentry/vite-plugin": "^3.5.0",
"posthog-js": "^1.276.0"
```

In `frontend/vite.config.ts` (or `vite.config.js`), remove the `sentryVitePlugin(...)` entry from the `plugins` array and its import.

Run `npm install` (or `bun install`) to update `package-lock.json` / `bun.lockb`.

---

## Remote Frontend

### 23. Remove PostHog initialization from `remote-frontend/src/main.tsx`

Apply the same PostHog removal steps as for the main frontend (step 17):

- Remove `posthog.init(...)` block
- Remove `VITE_PUBLIC_POSTHOG_KEY` / `VITE_PUBLIC_POSTHOG_HOST` usage
- Remove PostHog imports

### 24. Remove PostHog from `remote-frontend/package.json`

Remove:

```json
"posthog-js": "^1.283.0"
```

Run `npm install` (or `bun install`) to update the lock file.

### 25. Clean up `remote-frontend/.env.production.example`

Remove the PostHog environment variable lines:

```
VITE_PUBLIC_POSTHOG_KEY=
VITE_PUBLIC_POSTHOG_HOST=
```

---

## Environment Variables

Remove references to the following environment variables from any `.env`, `.env.example`, `.env.production`, CI/CD configs, or deployment scripts:

**Backend:**
- `POSTHOG_API_KEY`
- `POSTHOG_API_ENDPOINT`

**Frontend:**
- `VITE_POSTHOG_API_KEY`
- `VITE_POSTHOG_API_ENDPOINT`
- `VITE_PUBLIC_POSTHOG_KEY`
- `VITE_PUBLIC_POSTHOG_HOST`

Sentry DSNs are hard-coded (not env vars), so no `.env` changes are needed for Sentry beyond removing the code itself.

---

## Verification Checklist

After making all changes, verify the following:

- [ ] `cargo build` completes without errors or warnings about unused imports
- [ ] `npm run build` (or `bun run build`) completes for both frontends without errors
- [ ] No remaining references to `sentry`, `posthog`, `analytics`, `track_event`, or `capture` (PostHog) in source files — run a global search to confirm:
  ```
  grep -r "sentry\|posthog\|analytics_enabled\|track_event\|posthog.capture" \
    vibe-kanban/crates vibe-kanban/frontend/src vibe-kanban/remote-frontend/src
  ```
- [ ] The settings UI no longer shows an analytics toggle
- [ ] The onboarding flow no longer shows a telemetry consent/disclaimer step (or the step is removed/repurposed)
- [ ] No network requests to `sentry.io` or PostHog endpoints are made at runtime (verify with browser devtools / `mitmproxy`)
