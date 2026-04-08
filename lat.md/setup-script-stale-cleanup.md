# Setup Script Stale Cleanup

Setup-script subprocesses now persist through `inreview` so reviewers can keep using the attempt environment before closing out the task lifecycle.

## In-Review Retention

Attempt finalization no longer kills tracked setup-script subprocess groups when execution ends and the task moves to `inreview`.

## Stale Attempt Cleanup Triggers

Tracked setup-script subprocess groups are cleaned up when an attempt becomes stale for user workflows.

### New Attempt Supersedes Old Attempt

Creating a new attempt for the same task cleans setup-script subprocesses from existing attempts because those attempts are no longer active.

### Task Moves To Done

When a task is merged and moved to `done`, setup-script subprocesses are cleaned for all attempts on that task.

### Task Moves To Todo Or Cancelled

When a task status is changed to `todo` or `cancelled`, setup-script subprocesses are cleaned for all attempts on that task.
