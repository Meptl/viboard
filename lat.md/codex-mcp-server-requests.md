# Codex MCP Server Request Handling

The Codex app-server client now returns protocol-valid responses for MCP-related server requests so custom MCP tools do not fail with `-32601` unsupported-request errors.

`crates/executors/src/executors/codex/client.rs` now handles permission requests, request-user-input prompts, and MCP elicitation requests with default responses. Dynamic tool calls are acknowledged with a structured failure response instead of a JSON-RPC method-not-found error.
