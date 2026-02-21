# Backend Upstream Commit Notes

Baseline compared: `v0.0.136-20251215225138..origin/main`

## Recommended Cherry-Picks (Apply Cleanly)

### 94d9e519
- Title: `fix git diff performance on large git repos`
- Status: Recommended
- Notes: Improves `git diff` and status handling performance for large repos, including better path handling and stdin-driven pathspec staging.

### 2f496086
- Title: `non-blocking orphan worktree cleanup`
- Status: Recommended
- Notes: Makes periodic orphan-worktree cleanup spawn asynchronously so service initialization is not blocked.

### 47facf12
- Title: `Fix worktree path handling on windows`
- Status: Recommended
- Notes: Normalizes/canonicalizes worktree path comparison to avoid false mismatches on Windows path forms.

### d27006be
- Title: `worktree exists on disk but missing git metadata -> recreate instead of error`
- Status: Recommended
- Notes: Treats on-disk-but-unregistered worktree as recoverable (`Ok(false)`) to allow recreation flow.

### 3ea8bf1e
- Title: `support git worktree repo paths`
- Status: Recommended
- Notes: Uses repository common dir metadata lookup so operations also work when repo path itself is a worktree.

### 3902cc95
- Title: `Fix hardcoded shell paths to support NixOS and non-FHS systems`
- Status: Recommended
- Notes: Preserves real shell path from environment and avoids assuming `/bin/*` is always valid.

### 8a1d9bb3
- Title: `fix: base command handling bug`
- Status: Recommended
- Notes: Prevents empty parsed shell-parameter strings from causing command-builder failures (notably on Windows).

### b98afdb5
- Title: `Fix broken git2 status check being used for auto-commit check`
- Status: Recommended
- Notes: Uses richer worktree status check instead of binary clean/dirty call that could misreport state.

### 5676a483
- Title: `Fix Opencode process leak`
- Status: Recommended
- Notes: Adds explicit process-group termination path and server drop cleanup to avoid orphaned Opencode processes.

### 7765955a
- Title: `fix(db): Don't spam SQLite with workspace timestamp updates`
- Status: Recommended
- Notes: Debounces workspace touch/update writes to reduce lock contention and write amplification in SQLite.

### 907152ee
- Title: `fix: downgrade diff stream repo-not-found error to warning`
- Status: Recommended
- Notes: Treats deleted/missing repo during diff stream as expected degradation, reducing noisy error logging.

### 410ab07f
- Title: `fix: handle signature_delta in Claude streaming to suppress mismatch warning`
- Status: Recommended
- Notes: Adds `signature_delta` handling as a no-op in Claude streaming parser to prevent false mismatch warnings.

## Manual Port Candidate

### 7a2bf1df
- Title: `fix: skip cache build for non-existent repo paths instead of logging error`
- Status: Manual port
- Notes: Good behavior change, but upstream patch targets `crates/services/src/services/file_search.rs`; this branch uses `crates/services/src/services/file_search_cache.rs`, so port manually.

## Explicitly Skipped

### ff1a517b
- Title: `Fix duplicate workspace prompt recovery from executor actions`
- Status: Skip
- Notes: Depends on newer DB model layout (`crates/db/src/models/workspace.rs`) not present in this branch.

### 4a48233c
- Title: `perf: fix database query performance bottlenecks`
- Status: Skip
- Notes: Mixes useful optimizations with schema/model files absent in this branch (`workspace_repo`, migration/sqlx artifacts).

### 60174486
- Title: `Fix comparison between EP and Workspace during cleanup`
- Status: Skip
- Notes: Targets workspace model/sqlx artifacts not present in this branch.

### 170fd47c
- Title: `Fix migration failure for task titles exceeding 255 characters`
- Status: Skip
- Notes: Tied to cloud migration path; excluded by branch scope.

## Scope Exclusions Applied

The following categories were intentionally excluded from recommendations:
- UI/UX-only commits
- Telemetry/analytics/Sentry/PostHog commits
- Cloud/remote integration commits
- OAuth/auth flow commits
- GitHub integration-specific commits
