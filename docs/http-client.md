# HTTP client

The HTTP plugin provides an owner-invoked, Bruno-style request workspace. Requests and variables are
Node-owned and encrypted where their values are sensitive.

## Data model

Requests can be repository-filed or ad hoc. Variables can be plain, secret, or command-backed. Saved
requests and variables are stored in `plugins/http.sqlite`; unsaved task-pane edits remain drafts.
Secret values are encrypted with `SESSION_ENC_KEY` and are never returned as plaintext in list/read
responses.

The plugin migrates older plaintext fields at Node initialization and fails closed when the encryption
key is unavailable. A command variable stores its command metadata, not its generated secret value.

## Sending

The Node resolves interpolation once, validates the resulting URL/scheme and headers, and sends via
the core HTTP service with bounded time and response-size limits. Command variables execute through
the process broker with their own grants and capture limits. Supplying an override for a command
variable suppresses command execution.

The send route requires a `device` principal. Internal agent/MCP callers cannot use the HTTP pane as
a general outbound or secret-reading oracle. Provider integrations use their own allowlisted clients.

## Client

The API Requests source and task pane provide tabs, request history, variables, auth helpers,
curl import/export, response inspection, and memory-only drafts. Node freshness/offline status follows
the shared client model; a failed send leaves the request text in the pane.
