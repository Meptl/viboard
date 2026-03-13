# Vibe Kanban: Project Overview

- Purpose: Full-stack kanban/task management app with a Rust backend and React/TypeScript frontend, plus deployment tooling and a packaged NPX CLI.
- Platforms: Linux development environment.
- Main areas:
  - `crates/`: Rust workspace crates (server, db, services, executors, deployment tooling).
  - `frontend/`: React + TypeScript (Vite, Tailwind).
  - `shared/`: Generated TS types shared between Rust and frontend.
  - `scripts/`: Development helpers (ports, DB prep, environment setup).
  - `npx-cli/`: npm CLI packaging files.
  - `docs/`, `assets/`, `dev_assets*`: docs and asset bundles.
- Important note: `shared/types.ts` is generated; update Rust type definitions and regenerate instead of editing directly.