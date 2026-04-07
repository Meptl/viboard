# Worktree Submodule Initialization

Worktree creation now initializes git submodules so new task worktrees include nested dependencies immediately.

## Creation Flow

When `[[crates/services/src/services/git/cli.rs#GitCli#worktree_add]]` adds a worktree, it runs recursive submodule initialization in the new worktree path.

## File Transport Compatibility

Submodule initialization allows file transport during setup so local-path submodules used in development repositories can clone successfully.

## Regression Coverage

`[[crates/services/src/services/worktree_manager.rs#create_worktree_initializes_submodules]]` verifies that worktree creation materializes submodules and avoids the uninitialized submodule state.
