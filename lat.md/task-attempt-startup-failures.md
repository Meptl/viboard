# Task Attempt Startup Failure Handling

Task attempt startup failures now follow the same failed-execution UX path as agent startup errors so users can see the failure in the attempt timeline.

## Failure Surfacing

`[[crates/server/src/routes/task_attempts.rs#create_task_attempt]]` now propagates `start_attempt` failures instead of only logging them and returning success.

## Failed Process Emission

`[[crates/services/src/services/container.rs#ContainerService#start_attempt]]` now records a failed `ExecutionProcess`, appends a stderr startup-error message, and moves the task to `inreview` when container/worktree creation fails.

## Attempt Retention

On startup failure, the route performs best-effort process/container cleanup but keeps the attempt record so clients can still load and display the failed-attempt context.
