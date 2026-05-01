---
title: API Server Overview
description: Current API surface for the Axum server in `crates/server`, including REST, WebSocket, and SSE endpoints.
source: crates/server/src/routes
---

# API Server Overview

Use this document as a quick map of the backend endpoints exposed by the server.

## Base URL

- Server origin example: `http://127.0.0.1:<port>`
- API prefix: `/api`
- MCP endpoint prefix: `/mcp`

## Core Concepts

- All REST-like endpoints below are mounted under `/api`.
- Some endpoints are streaming:
- `.../ws` are WebSocket routes.
- `/api/events` is an SSE stream.
- Frontend routes (`/` and `/{*path}`) are served by the same server but are not API endpoints.

## Quick Reference

| Area | Method | Path |
|---|---|---|
| Health | GET | `/api/health` |
| Config | GET | `/api/info` |
| Config | PUT | `/api/config` |
| Config | GET | `/api/sounds/{sound}` |
| Config | GET, PUT | `/api/profiles` |
| Config | GET | `/api/editors/check-availability` |
| Config | GET | `/api/agents/check-availability` |
| Containers | GET | `/api/containers/info` |
| Containers | GET | `/api/containers/attempt-context` |
| Projects | GET, POST | `/api/projects/` |
| Projects | GET, PUT, DELETE | `/api/projects/{id}/` |
| Projects | GET | `/api/projects/{id}/branches` |
| Projects | GET | `/api/projects/{id}/search` |
| Projects | POST | `/api/projects/{id}/open-editor` |
| Tasks | GET, POST | `/api/tasks/` |
| Tasks | GET | `/api/tasks/stream/ws` |
| Tasks | POST | `/api/tasks/create-and-start` |
| Tasks | GET, PUT, DELETE | `/api/tasks/{task_id}/` |
| Task Attempts | GET, POST | `/api/task-attempts/` |
| Task Attempts | GET | `/api/task-attempts/{id}/` |
| Task Attempts | GET | `/api/task-attempts/{id}/diff` |
| Task Attempts | POST | `/api/task-attempts/{id}/follow-up` |
| Task Attempts | POST | `/api/task-attempts/{id}/run-setup-script` |
| Task Attempts | GET | `/api/task-attempts/{id}/commit-compare` |
| Task Attempts | POST | `/api/task-attempts/{id}/start-dev-server` |
| Task Attempts | GET | `/api/task-attempts/{id}/branch-status` |
| Task Attempts | GET | `/api/task-attempts/{id}/diff-metadata-ws` |
| Task Attempts | POST | `/api/task-attempts/{id}/merge` |
| Task Attempts | POST | `/api/task-attempts/{id}/rebase` |
| Task Attempts | POST | `/api/task-attempts/{id}/conflicts/abort` |
| Task Attempts | POST | `/api/task-attempts/{id}/open-editor` |
| Task Attempts | GET | `/api/task-attempts/{id}/children` |
| Task Attempts | POST | `/api/task-attempts/{id}/stop` |
| Task Attempts | POST | `/api/task-attempts/{id}/change-target-branch` |
| Task Attempts | POST | `/api/task-attempts/{id}/rename-branch` |
| Task Attempt Draft | GET, PUT, DELETE | `/api/task-attempts/{id}/draft/` |
| Task Attempt Queue | GET, POST, DELETE | `/api/task-attempts/{id}/queue/` |
| Task Attempt Images | GET | `/api/task-attempts/{id}/images/metadata` |
| Task Attempt Images | POST | `/api/task-attempts/{id}/images/upload` |
| Task Attempt Images | GET | `/api/task-attempts/{id}/images/file/{*path}` |
| Task Notifications | GET | `/api/task-notifications/stream/ws` |
| Execution Processes | GET | `/api/execution-processes/stream/ws` |
| Execution Processes | GET | `/api/execution-processes/{id}/` |
| Execution Processes | POST | `/api/execution-processes/{id}/stop` |
| Execution Processes | GET | `/api/execution-processes/{id}/raw-logs/ws` |
| Execution Processes | GET | `/api/execution-processes/{id}/normalized-logs/ws` |
| Tags | GET, POST | `/api/tags/` |
| Tags | PUT, DELETE | `/api/tags/{tag_id}` |
| Filesystem | GET | `/api/filesystem/directory` |
| Filesystem | GET | `/api/filesystem/git-repos` |
| Events | GET | `/api/events/` |
| Approvals | POST | `/api/approvals/{id}/respond` |
| Images | POST | `/api/images/upload` |
| Images | GET | `/api/images/{id}/file` |
| Images | DELETE | `/api/images/{id}` |
| Images | GET | `/api/images/task/{task_id}` |
| Images | GET | `/api/images/task/{task_id}/metadata` |
| Images | POST | `/api/images/task/{task_id}/upload` |

## Non-API Routes

- `GET /` serves frontend root.
- `GET /{*path}` serves frontend app routes.

## MCP Route

- `POST/GET ... /mcp/*` (mounted via `nest_service("/mcp", ...)`).
- Backed by the TaskServer Streamable HTTP MCP service.

## Source of Truth

Primary router composition lives in:
- `crates/server/src/routes/mod.rs`

Feature routers:
- `crates/server/src/routes/*.rs`
- `crates/server/src/routes/task_attempts/*.rs`
