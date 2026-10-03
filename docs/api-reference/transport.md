# Transport, pairing, and versioning

This page covers how a client reaches a Node's `/v1` API: the namespaces, pairing, protocol
versioning, the middleware every request passes, and the error envelope. Read it before you add a
route or change a wire shape. It's part of the [API reference](../api-reference.md).

## Transport

The Node serves one Hono application under `/v1`. It answers JSON routes and one authenticated
WebSocket, and it serves no HTML, JavaScript, or static assets. `createApp()` in
`packages/node-core/src/server/index.ts` builds it.

| Surface | Path | Auth |
| --- | --- | --- |
| Node probe | `GET /v1/node` | Pre-auth. The unauthenticated answer is limited. |
| Pairing | `POST /v1/pair` | Pre-auth. Spends a one-time code. |
| Core | `/v1/core/*` | A device, or an internal principal the route permits |
| Plugin | `/v1/p/<plugin>/*` | A device, or an internal principal the route permits |
| Events and streams | `/v1/events` | Authenticated WebSocket upgrade |
| Preview tunnel | `/v1/tunnel` | Authenticated WebSocket upgrade |

An authenticated `GET /v1/node` answer includes `nodeId`. A background Node the CLI started also
includes `serviceInstanceId`, a UUID the CLI uses to prove it owns that process. The unauthenticated
probe never carries either field.

Core route builders and response types are published through `@acorn/protocol/api.ts`, with their
source grouped by owner under `packages/protocol/src/transport/api/`. Plugin routes come from each
plugin's own registration. The route modules own field and validation details.

The desktop broker aborts a request after 30 seconds (`packages/custody/src/broker/brokerFetch.ts`).
A caller that knows its route is slow passes `timeoutMs` on the request and the broker uses that
instead. Three callers do: workflow generation asks for 240 seconds, the AI authoring turn for 11
minutes, and the MCP server test for 45 seconds. A route that needs more than half a minute usually
wants an event rather than a longer wait. A direct HTTP caller doesn't pass through the broker.

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

`DELETE /v1/core/devices/:id` closes that device's open WebSocket connections at once, because a live
socket holds no bearer to recheck. A device may revoke itself. Every paired device already has full
owner authority, so there is no separate guard against self-revocation.

## Versioning

`NODE_PROTOCOL_VERSION` is 1 (`packages/protocol/src/device/node.ts`), and every owned HTTP and
WebSocket path uses `/v1`. Every probe and pair result also carries `baseline: "acorn-1"`. A client
refuses a missing or different baseline before pairing or opening a socket, even when the protocol
number is 1.

The protocol number is the major. There's no minor and no feature handshake. Each side refuses a
major it doesn't speak. The pairing probe refuses before pairing, and the broker probes `GET /v1/node`
again on every connect, which produces the `incompatible` connection state and the
`protocol_mismatch` error code. A check at pairing alone isn't enough, because a paired Node upgrades
by restarting, and the reconnect is where a new major shows up.

The same probe may carry `eventTransport: { viewers: 1 }`, which advertises logical event viewers. A
host that enables viewer multiplexing adds `x-acorn-viewers: 1` to its `/v1/events` upgrade only
after it sees that advertisement. An absent or malformed advertisement, an unknown viewer version, or
a failed probe keeps the legacy event transport. The advertisement doesn't change the major.
[WebSocket](./websocket.md#logical-event-viewers) covers the frames.

**Within a major, changes are additive.** New routes, new optional response fields, and new WebSocket
channels are safe. Renaming a field, removing one, or changing what one means is the next major.
Reads are tolerant: `readJson` doesn't validate, so unknown fields pass and a missing field arrives as
`undefined`. That's a licence to add, never to remove, because a removal surfaces as a crash deep in a
component rather than at the boundary. Mutations keep their Zod validation.

**The handshake is the most tolerant surface.** `nodeInfoSchema` and `pairResultSchema` ignore unknown
fields in every major. This is the answer by which a client learns it can't speak to a Node, so every
client must be able to read every version of it. A client that can't parse it reports "this is not an
acorn node" about something that plainly is.

A standalone Node can upgrade on its own schedule, so test compatibility at the probe and reconnect
boundaries. There's no OpenAPI document or generated client. [Node distribution](../node-distribution.md)
covers the standalone artifact.

The plugin bridge follows the same rule. Frame SDK verbs ship inside plugin bundles while the broker
ships in the shell, so within a `PLUGIN_API_MAJOR` bridge verbs are additive only. See
[the plugins doc](../plugins.md).

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
replay stores the request hash and the final answer, and reuse with a different body returns
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
