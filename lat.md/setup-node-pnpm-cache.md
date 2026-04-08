<<<<<<< HEAD
<<<<<<< HEAD
# Setup Node Pnpm Cache Order
=======
# Setup Node Pnpm Cache Ordering
>>>>>>> vk/cca1-settings-storage

This section documents CI setup ordering that prevents pnpm cache checks from running before pnpm is installed.

<<<<<<< HEAD
## Failure Mode

The pre-release `bump-version` job could fail in `setup node` when `actions/setup-node` attempted package-manager caching before `pnpm/action-setup` installed the pnpm executable.

## Resolution

`[[.github/actions/setup-node/action.yml]]` now sets `package-manager-cache: false` on `actions/setup-node`, while the composite action continues to cache the pnpm store explicitly after pnpm setup.
=======
# Setup Node Pnpm Cache Ordering

This section documents CI workflow ordering that installs pnpm before any pnpm cache lookup so setup steps do not fail on missing binaries.

The workflow must run the Node setup action with pnpm enabled before attempting to compute or restore a pnpm cache key. This avoids cache-stage failures caused by invoking `pnpm --version` before pnpm is available.
>>>>>>> vk/cca1-settings-storage
=======
The workflow disables premature package-manager cache probing during Node setup, then performs pnpm-specific cache steps only after pnpm installation succeeds.
>>>>>>> vk/cca1-settings-storage
