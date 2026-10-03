# Transport and auth

This page covers how a Node protects its listener and decides which caller may reach which route:
TLS and certificate pins, the auth gates, task scope, and the WebSocket hub. Read it before you add a
route or a socket channel. It's part of the [security model](../security.md).
[Authentication](../authentication.md) owns the credential formats.

## Transport

- A Node binds `127.0.0.1` over TLS 1.3 and rejects an unexpected `Host` header.
  [Node distribution](../node-distribution.md#reaching-a-node-from-another-machine) covers binding
  beyond loopback.
- The certificate is self-signed, kept in the Node's data root, and pinned by fingerprint in the
  helper's broker. A changed fingerprint is a hard stop.
- The helper schema and the broker both check a renderer's request path as a same-origin absolute
  path, right before the broker joins it to the paired endpoint. A protocol-relative path, a
  backslash, or a fragment can't redirect a request that carries that Node's bearer.
- The broker bounds each HTTP answer to 64 MiB, the `/v1/node` probe to 16 KiB, and each WebSocket
  message to 8 MiB before it parses or forwards it. It opens at most four HTTP sockets per Node
  (`packages/custody/src/broker/`). Automatic agent image previews ask for an 8 MiB ceiling and
  refuse oversized metadata or bytes before raster encoding.
- The bearer rides the `/v1/events` upgrade headers, which a browser can't set. That's why the
  desktop's socket belongs to the helper. The terminal client is one Node process, so it sets the
  header itself, and an architecture rule keeps custody out of every `apps/tui` module that draws a
  cell.
- `/v1/events` authenticates the upgrade and rechecks device activity for long-lived streams. The
  Node enforces the 8 MiB ceiling before parsing. Upgrade, lookup, and handler failures stay inside
  their connection. A failed activity lookup closes the affected sockets. Disconnect cleanup runs
  every owner's hook on its own, including hooks that reject.
- The preview tunnel enforces 64 KiB per message at the Node and custody receivers
  ([WebSocket](../api-reference/websocket.md#preview-tunnel)). The helper's request limit is in
  [the shell contract](../shell/process.md#the-shell-process).
- Revoking a device closes its live sockets and fails its in-flight requests. A device may revoke
  its own row, which is the same as unpairing itself.
- A bearer that authenticated is remembered for 60 seconds, keyed by the SHA-256 of the whole token
  (`packages/node-core/src/server/auth/deviceTokens.ts`). Only a token that resolved is remembered,
  so a wrong secret or an unknown id reads the row every time. **Revoking a device drops its entries
  before it notifies anyone.** The window matches the socket sweep's, and `isActive`, which that
  sweep reads, is never cached.
- There's no cookie or ambient browser credential, so there's no CSRF middleware.

## The gates

Every protected route passes request-id assignment, principal resolution, the auth gate, and the
idempotency middleware, in that order ([request processing](../api-reference/transport.md#request-processing)).

`requireUser` is the single gate over `/v1/*`. It accepts a device or an internal credential, because
product routes such as the MCP server and agent sessions read and write task data as the owner.
`requireDevice` is narrower. It sits in front of everything an agent's child process must never
reach: pairing, devices, plugin administration, audit, security, storage, the attachment, node
providers, schedules, backup, preferences, projects, workspaces, model backends, search, authoring,
and telemetry. It answers 403, not 401. The caller authenticated fine. It isn't the owner at a
keyboard, and a 401 would invite a retry loop.

`requireProviderAccess` is one step wider. It admits device principals and the Node's own `service`
calls, which need provider reads to warm a mirror, and refuses a task token. It guards
`/v1/core/integrations` and `/v1/core/data-sources`.

The gates mount on path prefixes in `server/index.ts`, not inside each handler, so a route added under
a gated prefix inherits the gate. Every gate is written in two forms, the bare path and `/*`. The Hono
version this repo pins matches the bare path with `/*`, but that behavior has moved between versions.

`server/mountCoverage.test.ts` builds the app, reads every route under `/v1/core` off it the way a
request does, and fails unless each route is covered by a gate mount or named in an allowlist with the
reason a task token may reach it. It reads `/*` strictly, as not covering the bare path. Adding a
route under a gated prefix stays free. Adding one anywhere else is a decision someone writes down.

## Task scope

A task token names one task. The task-scope gate matches a task id out of the URL, at
`/v1/core/tasks/:id` and `/v1/p/<plugin>/tasks/:id` and everything under them, and refuses a token
minted for another task. Plugins mount two shapes the gate covers: `prefix: '/tasks'` with `/:id/…`
underneath (changes, database, editor), or `prefix: ''` with `/tasks/:id/…` underneath (memory,
workflows, docker).

A route addressed by another id carries nothing for the gate to match. Terminal's `/sessions/:sid`,
agents' `/sessions/:sessionId`, and workflows' `/runs/:runId` resolve the owning task and enforce
scope in their own router. That's a named exception to "mount the gate", and each route on the list
has its own check to show for it. A plugin router registered with `prefix: ''` sits outside every core
gate and carries its own. GitHub's device-flow routes and notes' workspace routes are device-only for
that reason.

Terminal's guard (`plugins/terminal/src/server/routes/terminal.ts`) shows what a self-check must get
right. It resolves the owning task before any handler runs, and answers an unknown session with the
same 404 as a foreign one, so a caller can't learn which session ids exist. When no PTY engine is
wired, it still answers the bridge's 503 rather than its own 404, because the client's degraded mode
keys on the 503.

Some lists are filtered rather than gated: `GET /v1/core/tasks`, `GET /v1/core/task-statuses`,
`GET /v1/core/runs`, and terminal's session roster. A task token has a reason to ask about its own task
and none to see every other task's title, branch, worktree path, and dirty count. `task-statuses`
filters before it runs any Git, so a confined caller can't make the Node do work for tasks it may not
see. Plugin frames reach that path under `core.tasks:read`, and the same filter covers them.

## The WebSocket hub

The hub (`server/transport/wsHub.ts`) keeps a connection's verified claims and checks scope once,
before a frame reaches any channel handler or the `term:` dispatch. It fails closed on an unknown
stream id, because failing open would let a caller race session creation. A task token can't open
`docker:exec:*` channels, which spawn a shell in any container on the machine.

Logical viewer dispatch reads these claims from its physical parent on every frame. A viewer token is
a resource-lifetime key, never a credential, so nesting a viewer envelope can't widen a task token's
reach.

A task-confined connection receives none of the hub's broadcasts. No broadcast channel is
task-addressed: `workflow:step:event` carries another task's agent stream, `workflow:notice` another
task's title, `agent:session` and `agent:event` another task's session, and `term:status` and
`docker:changed` are content-free pings worth nothing outside a UI. With nothing to narrow a frame to,
the filter withholds everything. The task's own session output still reaches it through the
per-session sink.

## Why

The internal token is in every PTY and agent environment. Without `requireDevice`, a prompt-injected
agent could open a pairing window, read the code from the answer, pair itself a device, and leave with
a permanent owner token. Preferences, projects, and workspaces joined the device-only list after a
review found each reachable by a task token. The agent-tool permission ceiling is a preference key, so
a task token could have raised its own ceiling. A project row holds the scripts the Node runs later,
so writing one is code execution with a delay.

Three route reviews in a row found the same hole: a route that should have been device-only, mounted
at `requireUser` because nobody wrote the line. That's why the gates mount by prefix and why the
coverage test exists. An earlier per-route task-scope check reached one call site in six, and left
another task's preview-url route open to arbitrary shell execution in its worktree.
