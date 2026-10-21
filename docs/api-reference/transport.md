# Transport and pairing

This page covers how a client reaches a Node's `/v1` API: the namespaces, pairing, the middleware
every request passes, and the error envelope. Read it with [Versioning](./versioning.md) before you
add a route or change a wire shape. It's part of the [API reference](../api-reference.md).

## Transport

The Node serves one Hono application under `/v1`. It answers JSON routes and one authenticated
WebSocket, and it serves no HTML, JavaScript, or static assets. `createApp()` in
`packages/node-core/src/server/index.ts` builds it.

| Surface | Path | Auth |
| --- | --- | --- |
| Node probe | `GET /v1/node` | Pre-auth. The unauthenticated answer is limited. |
| Pairing | `POST /v1/pair` | Pre-auth. Spends a one-time code. |
| Pairing by approval | `POST /v1/pair/requests`, `POST /v1/pair/requests/claim` | Pre-auth. The ask is loopback only. |
| Core | `/v1/core/*` | A device, or an internal principal the route permits |
| Plugin | `/v1/p/<plugin>/*` | A device, or an internal principal the route permits |
| Events and streams | `/v1/events` | Authenticated WebSocket upgrade |

An authenticated `GET /v1/node` answer includes `nodeId`. A background Node the CLI started also
includes `serviceInstanceId`, a UUID the CLI uses to prove it owns that process. The unauthenticated
probe never carries either field.

Core route builders and response types are published through `@acorn/protocol/api.ts`, with their
source grouped by owner under `packages/protocol/src/transport/api/`. Plugin routes come from each
plugin's own registration. The route modules own field and validation details.

The desktop broker aborts a request 30 seconds after it gets a socket, and any request 60 seconds
after the call (`packages/custody/src/broker/brokerFetch.ts`). A caller that knows its route is slow
passes `timeoutMs` on the request, and the broker uses that and twice that instead. Workflow
generation asks for 240 seconds, the AI authoring turn for 11 minutes, and most MCP server calls for
45 to 150 seconds. A request with a `timeoutMs` over 30 seconds, or one that names `long: true`, uses
the Node's long pool ([connection broker](../shell/bridge-and-broker.md#connection-broker)). A route
that needs more than half a minute usually wants an event rather than a longer wait. A direct HTTP
caller doesn't pass through the broker.

`pnpm dev:node` starts the API service on its own. It serves no renderer assets.

### Captured client origins

The client transport accepts optional `nodeId` and `signal` on JSON reads and writes, byte reads,
and multipart uploads. An omitted `nodeId` selects the active fleet Node. An explicit `null` keeps
the serving-origin path in a browser with no broker, and a broker rejects it rather than picking a
fleet Node. A multipart caller can capture its Node before it awaits file bytes or a native picker.
The broker keeps the credentials and builds the multipart body from typed parts.

## Pairing

A pairing code is a one-time 128-bit credential with a 10-minute window and a budget of five
attempts (`packages/node-core/src/server/auth/pairingCodes.ts`). The Node shows it as a QR code and
as text, and the owner types it into the new client. It lives in memory only, so a restart loses an
open code and the owner opens the window again. A code that survived a restart would be a credential
on disk for a window the owner believes has closed. Issuing a code replaces any open one.

Every failure answers with the same `401 pairing_failed`: no open window, an expired window, a spent
budget, a wrong code, or a malformed body. A caller can't tell which one it hit, so there is no oracle
for "right code, wrong something". The attempt counter increments before the comparison runs, so
concurrent guesses can't dodge the budget.

The route reads at most 4 KiB of request bytes. It checks `Content-Length` and counts streamed bytes
before it parses JSON. An oversized request gets `413 payload_too_large` and spends no attempt. A
per-Node ceiling admits 20 requests a minute, malformed and oversized ones included, then answers
`429 rate_limited` (`packages/node-core/src/server/routes/pairing.ts`). Custody's first-contact probe
has an eight-second deadline across connection, headers, and body, and a 16 KiB answer ceiling.
Pairing uses the pinned connection with the same eight-second deadline.

`POST /v1/pair` returns the device's bearer token once, in that answer, and the Node keeps only its
hash. The unauthenticated probe carries the TLS certificate fingerprint, and the owner compares it
with the one on the Node's own screen. Sending a fingerprint over the connection it authenticates
proves nothing by itself. The value comes from a person reading both screens.

## Pairing by approval

A client on the Node's own computer can pair without a code. The terminal client, the CLI, and the
browser extension's bridge ask, a paired client shows the owner a dialog, and the asker collects its
token once the owner allows it. The code stays open beside the wait, for a Node no paired client is
watching. The store is `packages/node-core/src/server/auth/pairingRequests.ts`.

1. The client sends `POST /v1/pair/requests` with `deviceName`. The Node answers with a `secret`, a
   three-word `phrase`, and `expiresInMs`, and broadcasts a content-free `pairing:requested` frame.
2. A paired client reads `GET /v1/core/pair/requests` from the Node that sent the frame and shows the
   device name and the phrase. The asker prints the same phrase.
3. The owner answers with `POST /v1/core/pair/requests/:id` and `decision` set to `allow` or `deny`.
   The answer is on the audit trail as `pairing.request.decided`.
4. The client polls `POST /v1/pair/requests/claim` with its `secret` once a second. It gets `202`
   while the owner hasn't answered, and the `POST /v1/pair` result once they allow it. A denial, an
   expiry, a spent request, and a secret the Node doesn't know all answer the same
   `401 pairing_failed`.

These limits apply:

- The ask answers only a loopback peer. Anything else gets `403 pairing_local_only` and pairs with a
  code, because a dialog anyone on the network could raise is one the owner learns to click through.
- The ask has its own ceiling of 6 a minute, apart from the code route's 20, so a loop of asks can't
  block someone typing a code from another computer. The claim has no ceiling, because its secret is
  256 random bits.
- The Node holds one request for two minutes, in memory. An ask that lands while another is still
  waiting for an answer cancels both and gets `409 pairing_busy`, so something racing the owner can
  cancel their request but never take its place on their dialog. The next ask starts clean, and a
  person who restarts `acorn` gets one refusal, then pairs. An ask after the held request was
  answered or expired replaces it. A restart drops it.
- The secret travels only in request bodies, never in a path a log could keep. Any process on the
  computer can ask, agents included. The phrase is how the owner tells their own request from one
  raced in by something else.
- The desktop opens the dialog by itself, and never changes the request it shows. A frame that brings
  a different request, or none, closes the dialog with a toast. **Allow** stays disabled for the
  first second.
 The terminal client draws no dialog, so it can ask but
  can't allow.

`DELETE /v1/core/devices/:id` closes that device's open WebSocket connections at once, because a live
socket holds no bearer to recheck. A device may revoke itself. Every paired device already has full
owner authority, so there is no separate guard against self-revocation.

## Request processing

`createApp()` applies this order:

1. Request-id assignment, on every path.
2. Principal resolution from a device bearer or `x-acorn-internal`.
3. The two pre-auth routes, `GET /v1/node` and `POST /v1/pair`.
4. The `requireUser` gate over everything else under `/v1`.
5. Idempotency replay for device mutations.
6. The device-only, task-scope, and provider-access gates, mounted by path.
7. Core routers, then plugin routers, then the loaded-plugin dispatcher.

Besides the two credentials and `x-request-id`, the request middleware reads one header:
`traceparent`, and only while the Node collects telemetry. A well-formed one makes the request's span
a child of the caller's. Anything else is ignored and the request starts its own trace. The parser
takes the W3C form only, and the raw header never reaches a log line, because it's attacker input
([telemetry model](../telemetry/model.md#traces)).

`Idempotency-Key` is optional for most mutations. Agent session creation, agent-turn enqueue, request
resolution, and the plugin install, update, review, and reload routes require it. A device-keyed
replay stores the request hash and the final answer. The hash covers the method, the path with its
query string, and the body, and reuse with any of them changed returns
`idempotency_conflict`. Internal callers have no device replay namespace. A replay row expires after
24 hours. A crash after a domain write but before the replay save can leave an ambiguous result, so a
caller keeps its key across retries and inspects known resource IDs. Managed agent session and turn
creation also keep their own operation records.

The client mints the key, never the broker. Only the call site knows that a retry is the same logical
mutation, and a broker-minted key would defeat replay.

## Errors

Every failing route returns one envelope, defined in `@acorn/protocol/errors.ts`:

```json
{
  "error": {
    "code": "not_found",
    "message": "No such resource.",
    "requestId": "…",
    "retryable": false,
    "details": {}
  }
}
```

`details` is optional. `ERROR_CODES` holds the ten transport codes: `bad_request`, `unauthorized`,
`forbidden`, `not_found`, `revision_conflict`, `idempotency_conflict`, `provider_error`,
`rate_limited`, `timeout`, and `internal`. They're the floor for a failure with no domain meaning.
Error bodies never carry secrets, tokens, file contents, or a provider's raw answer. An unknown
failure returns `internal` with a `requestId` and logs the rest on the Node.

A route may return its own documented code instead. About three dozen domain codes change client
behavior: `needs-trust` opens the config-trust modal, `provider_needs_auth` rewrites the message, and
so on. The floor is a fallback for a failure a route didn't name, not an allowlist.

`retryable` comes from the HTTP status, so callers keep no per-code table. `408`, `429`, `502`, `503`,
and `504` are retryable. No other 5xx is, because a `500` usually means the request itself is broken.

## Why

The floor is closed but not exclusive because there's no API boundary to defend. The client and the
Node ship from one repository and release together. A closed set would buy interop discipline nobody
needs and delete behavior the domain codes drive.
