# Electron Development Runtime

This section documents how the desktop shell behaves during local development so runtime behavior is predictable when debugging startup and backend issues.

## Backend Log Forwarding

The Electron main process forwards backend stdout and stderr to the parent terminal so developers can see normal runtime logs while startup URL detection still works.

The forwarding is implemented in `electron/main.cjs` inside `spawnBackend`.
