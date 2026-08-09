# HTTP client

The HTTP plugin provides an owner-invoked, Bruno-style request workspace. Requests and variables are
Node-owned and encrypted where their values are sensitive.

## Data model

Requests can be project-filed or ad hoc. Variables can be plain, secret, or command-backed. Saved
requests and variables are stored in `plugins/http.sqlite`; unsaved task-pane edits remain drafts.
Secret values are encrypted with `SESSION_ENC_KEY` and are never returned as plaintext in list/read
responses.

The plugin migrates older plaintext fields at Node initialization and fails closed when the encryption
key is unavailable. A command variable stores its command metadata, not its generated secret value.

## Sending

The Node resolves interpolation once, validates the resulting URL and scheme and the headers, then
sends with `fetch` under its own bounded time and response-size limits (`plugins/http/src/server/send.ts`).

There is NO core HTTP service, and this paragraph used to say there was. Nothing central inspects an
outbound request and there is no host allowlist: the plugin's own validation is the whole control.
That is defensible while every plugin is first-party code in this repo — and it is exactly the thing
that has to change before a third-party plugin can make outbound requests, because at that point
"each plugin validates its own" stops being a control at all. Described here rather than built now:
a guard nobody can point at is worse than a documented absence. Command variables execute through
the process broker with their own grants and capture limits. Supplying an override for a command
variable suppresses command execution.

The send route requires a `device` principal. Internal agent/MCP callers cannot use the HTTP pane as
a general outbound or secret-reading oracle. Provider integrations use their own allowlisted clients.

## Other outbound consumers in the Node

There is one more, and it is deliberately not built on anything shared: the plugin installer
(`packages/node-core/src/main/pluginInstaller.ts`) fetches release metadata and a package archive when
an owner installs a plugin. It keeps its `fetch` usage inside its own module, with its own scheme guard
(https everywhere, http only on loopback, re-checked after redirects), a 32 MiB archive cap and a
60-second timeout. Same posture as the send path above, and for the same reason: a general client
assembled from two call sites would be a control nobody owns. The credential-injecting fetch broker
described in `docs/third-party/node-security.md` is the third, when it lands — and it is the one that
would be worth converging the other two onto, because it is the one with a host allowlist.

## Client

The API Requests source and task pane provide tabs, request history, variables, auth helpers,
curl import/export, response inspection, and memory-only drafts. Node freshness/offline status follows
the shared client model; a failed send leaves the request text in the pane.
