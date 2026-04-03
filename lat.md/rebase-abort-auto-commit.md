# Rebase Abort Auto-Commit Cleanup

This section documents how conflict abort handles synthetic rebase prep commits so aborting a rebase returns the branch to its pre-rebase commit history.

## Synthetic Rebase Prep Commit

The rebase flow may create a temporary chore commit for tracked local edits so `git rebase` can start on a clean index without discarding user work.

That synthetic commit includes an `Attempt-id: <task-attempt-id>` trailer so cleanup can scope rollback to the current task attempt.

## Abort Cleanup Behavior

When a rebase is aborted from conflict state, the service removes the synthetic `chore: auto-commit local changes before rebase` commit only when its `Attempt-id:` trailer matches the current attempt.

## Working Tree Restoration

Cleanup uses a mixed reset to keep the user edits in the working tree while removing the synthetic commit from branch history.
