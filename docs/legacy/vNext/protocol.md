# Protocol

Everything between client and Node is HTTPS + one WebSocket, under `/v2`. All shapes are Zod
schemas in `@acorn/protocol`; both sides validate at the boundary. JSON, UTF-8, camelCase, IDs are
UUIDv7, timestamps are epoch milliseconds.

## Transport and identity

- A Node generates on first start: a `nodeId` (UUIDv7), a long-lived self-signed TLS certificate,
  and a human-checkable fingerprint (short hash of the cert, rendered as 6 words / grouped base32).
- All connections are TLS with the client **pinning that certificate** for that nodeId. No CA, no
  hostname validation — the pin is the identity. A changed fingerprint is a hard security stop in
  the UI, never an auto-retrust.
- The bundled local Node binds loopback only. Remote use requires the owner to explicitly enable a
  non-loopback bind (or reach the Node over their own VPN/tunnel — the recommended path).
- Every authenticated request carries `Authorization: Bearer <token>`. On the client side, all
  requests flow through the desktop app's connection broker (architecture.md), which owns the
  pins and tokens; the renderer never talks to a Node directly.

There are two token classes:

- **Device tokens** — issued by pairing, full owner authority, keychain-held by the client.
- **Internal tokens** — issued by the Node itself to child processes it spawns (agent sessions,
  MCP servers, command-variable executions). Task- or session-scoped, expiring, and restricted:
  they can call only the routes their scope declares, and can never read secrets back, mint
  tokens, pair, or touch device management. This is V1's `x-acorn-internal` principal, carried
  forward as a first-class token class.

## Pairing

Pairing issues a device token. It is off by default and owner-initiated on both ends.

1. Owner opens a pairing window on the Node (from an already-paired client, or the Node CLI):
   Node generates a one-time 128-bit code, shows it as QR + text with its endpoint + fingerprint.
   Window: 10 minutes, 5 attempts, single use.
2. New client connects, verifies the TLS cert matches the advertised fingerprint (user confirms
   the word-fingerprint for manual entry), and `POST /v2/pair` with the code and its device name.
3. Node stores a hash of nothing — the code dies; it creates a `device` row and returns a random
   256-bit device token (stored hashed on the Node, in the OS keychain on the client).
4. Every paired device has full owner authority. The pairing screen says so.

Local bundle: no code. Electron spawns the Node, and the Node hands the endpoint + a pre-created
device token to its parent over the supervision channel (stdio/IPC), like V1's internal token.

Revocation: deleting a device row invalidates its token immediately — open sockets are closed,
in-flight requests fail. Long-lived streams re-check the device every 60s as a backstop.

## HTTP conventions

Plugins and core register ordinary REST routes, like V1:

- Core: `GET/POST /v2/core/...` (workspaces, tasks, devices, node info, settings).
- Plugins: `/v2/p/<plugin>/...` (e.g. `/v2/p/github/pulls`, `/v2/p/terminal/sessions`).

Rules, applied by shared middleware:

- **Reads are side-effect-free.** Provider-backed reads return `{ data, freshness }` where
  freshness is `live | stale | offline` plus `observedAt` (the serve-then-revalidate pattern V1
  already uses).
- **Mutations that clients may retry carry an `Idempotency-Key` header** (UUIDv7). Endpoints
  where duplicate delivery is harmless (pure upserts) may skip it; endpoints with external side
  effects (create PR, post comment, send agent turn) require it. Middleware semantics:
  - the Node stores `(deviceId, key) → requestHash, response` for 24h and replays the stored
    response on retry;
  - same key + different request hash → `409 idempotency_conflict`;
  - a duplicate arriving while the first is still executing waits for it and gets its response;
  - only final outcomes (2xx/4xx) are stored; 5xx/timeouts are not, so a genuine retry re-executes.
- **Conflict-prone resources use revisions.** Resources like notes and file bodies carry an
  integer `revision`; writes send `expectedRevision` and get `409 revision_conflict` with the
  current revision on mismatch. Most resources don't need this — use it where V1 already learned
  it's needed (notes autosave, editor writes), not everywhere.
- **Deadlines**: mutations that start long work return `202 { operationId }`; progress and
  completion arrive as events. Short mutations respond synchronously.

### Errors

One envelope everywhere:

```json
{ "error": { "code": "revision_conflict", "message": "…", "requestId": "…", "retryable": false, "details": { } } }
```

Codes are a small closed set: `bad_request`, `unauthorized`, `forbidden`, `not_found`,
`revision_conflict`, `idempotency_conflict`, `provider_error`, `rate_limited`, `timeout`,
`internal`. Unknown internal failures return `internal` + requestId and log the rest server-side.
Error bodies never contain secrets, tokens, file contents, or provider response bodies.

## Events (WebSocket)

One WS per node per client: `GET /v2/events` (token-authenticated at upgrade). It carries two
kinds of traffic, multiplexed by frame type: **events** and **streams**.

Events are live notifications, not a durable replication log:

```json
{ "kind": "event", "seq": 4712, "type": "github.pull.updated", "payload": { "pullId": "…" } }
```

- `seq` is a per-connection monotonic counter so the client can detect in-connection loss (it
  shouldn't happen; treat a gap as a reconnect).
- Payloads carry IDs and small facts, never bodies or secrets. The client reacts by invalidating /
  refetching the affected queries and updating badges — exactly V1's WS invalidation model.
- **Reconnect = refetch.** After a WS drop, the client marks that node's cache stale and refetches
  what's on screen (lazily, stale-while-revalidate). There is no cursor into history and no
  snapshot-recovery protocol. Features that need durable ordered history (agent transcripts,
  workflow runs) persist it in their own plugin tables and expose paged reads over HTTP; their
  events just say "session X advanced to sequence N".
- Subscriptions are coarse: the client subscribes to topic groups (e.g. all events for the active
  workspace + global attention topics), not per-resource. Fine-grained filtering is a client-side
  concern.
- **Both ends run a ping/pong watchdog** (WebSocket control frames, not application messages). Each
  side pings on an interval and `terminate()`s — never `close()`, which would wait for a reply from
  the peer it has just concluded is silent — after two unanswered pings. Without it a node that has
  hung, or a laptop that slept without dropping its TCP connections, holds the socket open and reads
  `online` indefinitely; the drop is what makes the reconnect-and-refetch above happen at all. The
  client's half is the one that fixes that (`apps/desktop/src/app/main/nodeBroker.ts`, 15 s); the
  node's rides its existing revocation sweep (`packages/node-core/src/main/wsHub.ts`, 60 s) and stops
  a vanished client's stream subscriptions living on until the process restarts.

## Streams

Interactive byte streams (PTY output/input, process logs, agent live output) run over the same WS
as stream frames:

```json
{ "kind": "stream", "streamId": "…", "op": "open|data|input|credit|close", … }
```

- Binary data frames; 64 KiB max frame; simple credit-based backpressure (client grants bytes,
  server never exceeds outstanding credit). Note: this *framing* is new — V1's terminal WS uses
  kind-tagged JSON frames with no flow control. What's kept from V1 are the attach/replay
  semantics; the credit layer is a vNext build, and it matters on remote links.
- Streams backed by a durable ledger (agent transcripts) accept `fromSeq` on open, and each data
  frame carries its ledger sequence, so a client can page history over HTTP and attach the live
  stream without gap or overlap (duplicates dedupe by sequence).
- Stream loss ≠ process death. Attach, detach, and kill are separate HTTP commands. Terminal
  sessions keep a bounded replay tail on the Node (256 KiB raw + serialized framebuffer) so a
  reattach can restore the screen; earlier history is gone by design.
- **Tunnels** are a third stream flavor: `op: "open"` with `{ tunnel: { taskId, port } }` opens a
  raw TCP byte pipe to a port the task's run-target/preview config declares on the Node host. The
  client end terminates in a local loopback listener created by the connection broker, which is
  what a remote task's preview pane points its `WebContentsView` at. Only declared ports; no
  general SOCKS.

## Blobs

Large immutable content (patches, file bodies, attachments, artifacts) is content-addressed:

- `GET /v2/blobs/:sha256` — fetch (supports ranges).
- `POST /v2/blobs` — upload, body streamed, server verifies digest, responds with the sha.

Small (< 1 MiB) payloads just go inline in JSON; don't ceremonialize them.

## Versioning

- The protocol has one version number, bumped on breaking change; the Node reports
  `{ protocolVersion, appVersion, nodeId, fingerprint }` at `GET /v2/node` (token-authenticated;
  unauthenticated it returns only enough for pairing: fingerprint + protocolVersion).
- Client and Node ship from the same repo and are released together. Version skew is a transient
  condition (user updated one side first), not a supported steady state: on major mismatch the
  client shows "update required" for that node and disables it. No capability negotiation.
- Within a version, unknown fields in responses are ignored by clients (Zod `.passthrough()` where
  forward-compat matters); unknown fields in requests are rejected.
