# Lazy Diff Loading
The diff experience streams file metadata first and loads full file content lazily, so large attempts render quickly while preserving accurate summary counts.

## Metadata-First Diff Stream
The diff WebSocket now sends only per-file metadata without file bodies, which keeps payloads small and avoids whole-diff content generation on initial load.

The metadata stream is produced by [[crates/services/src/services/diff_stream.rs#create]] and consumed in [[frontend/src/components/panels/DiffsPanel.tsx#DiffsPanel]].
After initial metadata entries are sent, the stream emits a non-terminal `finished` marker so the UI can treat the snapshot as complete without closing live updates.

## Merged Attempt Terminal Snapshot
Merged attempts emit a fixed commit-diff snapshot while clean/not-ahead, and switch back to live worktree diffs as soon as new work resumes.

The merged-attempt branch is selected in [[crates/local-deployment/src/container.rs#LocalContainerService#stream_diff]].
The merged snapshot payload is emitted by [[crates/local-deployment/src/container.rs#LocalContainerService#create_merged_diff_stream]].
The diff WS route closes with an explicit close frame on stream completion in [[crates/server/src/routes/task_attempts.rs#handle_task_attempt_diff_ws]], preventing reconnect loops after finite merged snapshots.
The WebSocket client skips reconnect when close reason is `finished` in [[frontend/src/hooks/useJsonPatchWsStream.ts#useJsonPatchWsStream]], while still reconnecting unexpected closures for live streams.

## On-Demand File Content Fetch
Full text for a file is fetched only when needed through a dedicated per-file API endpoint, so backend diff computation stays scoped to the requested path.

The API is implemented in [[crates/server/src/routes/task_attempts.rs#get_task_attempt_diff_file]] and used from [[frontend/src/lib/api.ts#attemptsApi]].
The frontend now treats this fetch as the point where per-file stats processing is complete, including omitted files such as binaries.
Diff cards keep stats empty until parsed/fetched values exist, and show a warning icon with hover text for binary/non-text files only after this processing completes.

When path filters are provided, the Git CLI staging step also scopes to those paths so per-file fetches do not stage the full worktree before diffing.

## Viewport-Triggered Progressive Loading
Diff cards request file content when rows enter the viewport and also when users expand a file, providing progressive loading while scrolling the diff list.

The viewport-triggered behavior is handled by [[frontend/src/components/panels/DiffsPanel.tsx#ViewportAwareRow]].
The card renderer is memoized in [[frontend/src/components/DiffCard.tsx#DiffCard]] to avoid re-rendering unchanged cards as neighboring files finish loading.
Deferred content detection treats both `null` and `undefined` as unloaded content so cards keep showing loading state until full file bodies are fetched.
Timing logs are emitted on backend diff fetch and frontend fetch/parse paths to attribute latency between API work and rendering work.
Viewport observers keep a stable subscription per row while invoking the latest visibility callback, avoiding full observer teardown/recreate cycles on each diff panel render.
Diff cards short-circuit memo comparison when the diff object reference is unchanged so already-loaded large file contents are not repeatedly compared.
Collapsed diff cards skip `generateDiffFile` parsing entirely and parse only after expansion, so loading metadata for many files does not precompute hidden diff views.
Collapsed card headers still show per-file `+/-` totals from streamed/fetched diff metadata, so stats stay visible even when line-level parsing is deferred.
Expanded cards proactively re-fetch deferred file content whenever live metadata updates arrive, preventing stale `Loading diff content...` placeholders after out-of-band worktree edits.
Files with more than 400 changed lines (`additions + deletions`) are treated as large-card exceptions: while collapsed, viewport visibility does not auto-fetch their full content.
Inline review comment editors keep typing state locally in [[frontend/src/components/diff/CommentWidgetLine.tsx#CommentWidgetLine]] and only sync draft text back to global review state on teardown, avoiding whole-diff context fanout on each keypress.
Diff-local drafts are keyed by file inside [[frontend/src/components/panels/DiffsPanel.tsx#DiffsPanel]] and passed down as per-file slices to [[frontend/src/components/DiffCard.tsx#DiffCard]], so draft mutations only invalidate the affected file card.
Draft persistence is debounced in [[frontend/src/components/panels/DiffsPanel.tsx#DiffsPanel]] and merged with the latest follow-up message/variant from storage before writeback, while [[frontend/src/contexts/ReviewProvider.tsx#ReviewProvider]] now persists finalized review comments.

## Metadata-Only Header Health Signals
Diff header warnings now rely on streamed metadata flags instead of reparsing every file body, which prevents render-time main-thread spikes on large attempts.

The omitted-file indicator in [[frontend/src/components/panels/DiffsPanel.tsx#DiffsPanelContent]] counts `contentOmitted` entries directly so summary rendering stays O(n) over metadata only.

## Large Diff Default Collapse
Diff panels default to collapsed when more than 100 files are changed, reducing initial rendering pressure and making large reviews easier to navigate.

The thresholded default is applied in [[frontend/src/components/panels/DiffsPanel.tsx#DiffsPanel]] after the diff stream emits its initial snapshot-complete marker.
For smaller diffs, cards flagged with `contentOmitted` (for example binary or non-renderable files) also start collapsed so placeholder messages do not dominate the first render.
For smaller diffs, files with more than 400 changed lines also start collapsed, even when the global file-count rule would otherwise default to expanded cards.
The `Expand all diffs` control preserves this per-file guard by expanding all eligible cards while keeping over-threshold files collapsed until their individual expand button is clicked.
Diff cards remain behind the loading state until snapshot completion, so initial card expansion never flashes before the default collapse decision is applied.
