# Suggested Commands

## Install and dev
- `pnpm i`
- `pnpm run dev` (frontend + backend with auto-assigned ports)
- `pnpm run backend:dev:watch`
- `pnpm run frontend:dev`

## Checks and tests
- `pnpm run check` (frontend type checks)
- `pnpm run lint` (frontend lint)
- `pnpm run backend:check` (Rust `cargo check`)
- `cargo test --workspace`

## Types and DB prep
- `pnpm run generate-types`
- `pnpm run generate-types:check`
- `pnpm run prepare-db`
- `pnpm run remote:prepare-db`

## Packaging
- `pnpm run build:npx`
- In `npx-cli/`: `pnpm pack`

## Useful Linux/system commands
- `git status`, `git diff`, `git log --oneline`
- `ls`, `cd`, `find`, `rg` (preferred fast search), `cat`, `sed`, `awk`