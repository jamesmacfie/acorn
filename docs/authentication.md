# Authentication

This page covers how a caller proves who it is to a Node: principals, device tokens, pairing, internal
tokens, and the GitHub connection. Read it before you add a credential or change what one may reach.

acorn has no accounts, login screen, session cookie, or session state. A Node has one owner. A client
becomes trusted by pairing, then presents a device bearer on every request. The code is in
`packages/node-core/src/server/auth/`, the pairing routes, and the desktop broker in
`apps/desktop/src/shell/` with its Rust half in `apps/desktop/src-tauri/src/`.
[Transport and auth](./security/transport-and-auth.md) owns the route gates.

## Principals

```ts
type Principal = {
  kind: 'device' | 'internal'
  userId: string
  deviceId?: string
  scope?: 'service' | 'task'
  taskId?: string
  sessionId?: string
  toolCeiling?: ToolCeiling
}
```

| Principal | Credential | Authority |
| --- | --- | --- |
| `device` | `Authorization: Bearer acorn_dt_…` | A paired owner client, with full owner authority |
| `internal` | `x-acorn-internal: <token>` | A Node-spawned process or a Node service call, limited by token scope |

`userId` is an opaque node-owner id that scopes identity-owned records
(`packages/node-core/src/server/middleware/auth.ts`). It's minted and bound at first boot by
`ensureBoundIdentity`. An install that bound a GitHub login under an earlier scheme keeps that login as
the id. Providers never bind identity: a GitHub login is metadata on its integration row. Internal
authentication fails closed on an unbound identity, which after first boot only a bare test
environment can produce.

The bearer and internal paths are exclusive. A malformed or rejected device bearer never falls through
to internal authentication.

## Node transport

A Node serves HTTPS with TLS 1.3 on `127.0.0.1` and an ephemeral port. It mints a long-lived self-signed
certificate in `<data-root>/tls/`. The desktop stores the certificate fingerprint and compares every
connection against it. A changed fingerprint stops the connection and needs an explicit repair of the
Node entry.

The Node checks the `Host` header against the bound loopback port and any advertised host
([reaching a node from another machine](./node-distribution.md#reaching-a-node-from-another-machine)).
The renderer never handles TLS or bearers. It calls the broker through the injected bridge, and the
desktop helper owns the endpoint, the pinned agent, and the device token.

## Device tokens

A token has the form `acorn_dt_<uuid>_<base64url-secret>`
(`packages/node-core/src/server/auth/deviceTokens.ts`). The raw value appears only in the pairing answer.
The Node stores a SHA-256 hash in `devices`. The desktop helper stores the raw token in a blob scoped to
the Node, encrypted under the data key the shell keeps in the OS keychain. A missing, malformed, unknown,
revoked, or wrong token gets the same null result.

Revoking a device with `DELETE /v1/core/devices/:id` stops its future HTTP calls and closes its live
sockets. A 60-second activity sweep backs that up for long-lived streams. A client may revoke itself, and
the desktop separately forgets a Node entry when the user unpairs.

## Pairing

Pairing uses one-time in-memory codes:

1. The owner opens a window with `POST /v1/core/pair/start`. The Node returns a code valid for ten
   minutes, with five attempts and a per-Node rate ceiling.
2. The new client probes `GET /v1/node` and compares the certificate fingerprint with the one the owner
   sees.
3. The client sends the code and a device name to `POST /v1/pair` over the pinned connection.
4. The Node creates a device row and returns the device token once.

In the desktop, **Settings → Nodes → Pair another client** calls the start route for that Node and shows
the code beside its pinned identity words, and **Close pairing** closes the window early. A standalone
Node prints its code in its terminal and opens a window again on `SIGUSR1`.

Ordinary failures get one `401 pairing_failed` with no detail. The 4 KiB body ceiling returns
`413 payload_too_large`, and the 20-a-minute ceiling returns `429 rate_limited`. Neither spends the code
window or issues a token. [Pairing](./api-reference/transport.md#pairing) owns the byte and deadline
limits.

The bundled local Node is the exception: the helper spawned it, so the service handshake returns a device
token without a typed code. It's still stored and checked as a normal device token.

Device administration is device-only:

| Route | Purpose |
| --- | --- |
| `POST /v1/core/pair/start` | Open or replace the pairing window |
| `DELETE /v1/core/pair` | Close the pairing window |
| `GET /v1/core/devices` | List paired devices without token material |
| `DELETE /v1/core/devices/:id` | Revoke a device |

## Internal tokens

The Node keeps an internal signing key in `internal-token` and mints stateless HMAC tokens with these
scopes:

- `service`: the Node's own loopback orchestration, never put in a child process.
- `task`: a PTY, agent, workflow step, or MCP process bound to one `taskId`, optionally a `sessionId`,
  and optionally a server-owned tool ceiling.

Task tokens are checked at task route mounts, stream upgrades, and task-owned operations. They can't pair
devices, administer devices or plugins, read the HTTP client's encrypted request material, or use the
renderer-facing agent-tool route or managed-agent execution and approval controls. Managed-agent HTTP
execution controls refuse service tokens too, because trusted workflow and delegation execution use
guarded capabilities. A task token can read and cancel its task's managed sessions, but not the
Node-wide agents run source. The session claim authorizes session-required tools such as orchestration,
and the Node reads it from the verified token, never from `x-acorn-session-id`.

HTTP root workflow starts need a device principal for repository, user, and database definitions, and
refuse task and service tokens before parsing the body. A task token keeps its own workflow file
listings, run reads, cancel, and kill. Trusted schedules and child workflows start through admission
capabilities that keep their approved authority and lineage.

Plugin routes outside task-shaped mounts enforce their own resource scope. Database CLI, palette, and
context routes compare a supplied task ID with the verified principal before core or database work.
Memory list and search resolve the signed task's project before reading project memory. GitHub project
import needs a device, even for service callers, because it administers core projects and checkout paths
([database plugin](./database.md), [notes and memory](./notes-and-memory.md),
[GitHub integration](./github-integration.md)).

A workflow or delegated managed session persists its tool ceiling, and the runtime includes it when it
mints the token. The agent-tool route enforces only the signed ceiling. `ACORN_TOOL_CEILING` and
`x-acorn-tool-ceiling` are compatibility metadata and can't widen authority. Tokens don't expire.
Rotating the signing key is the revocation, which tmux sessions that outlive a Node restart need.

The GitHub credential is an integration secret, not part of `Principal`. GitHub routes read it through
`plugins/github/src/server/githubToken.ts`, so an internal caller that can reach a GitHub route can spend
the owner's GitHub credential. Task scope limits task access. It isn't a universal provider-credential
firewall.

## GitHub connection

GitHub uses the OAuth device authorization grant. The Node asks for a device code, the owner enters the
user code at GitHub, and the Node polls until the token is issued. The token is checked and stored as an
encrypted `integrations` row, and never appears in an answer or renderer state.

| Route | Purpose |
| --- | --- |
| `POST /v1/p/github/auth/device/start` | Ask GitHub for a device code. Device-only |
| `POST /v1/p/github/auth/device/poll` | Poll once, and connect on success. Device-only |

The flow uses acorn's public client ID unless `GITHUB_CLIENT_ID` overrides it, with no client secret or
callback URL ([connecting](./github-integration.md#connecting)).

## WebSocket authentication

`/v1/events` checks the exact Node `Host` and a device bearer or internal token before the upgrade
completes, with no cookie or browser-origin authentication. The socket carries a sequence-numbered live
event stream and feature streams, and clients reconnect and fetch again after a gap. Client and Node both
run ping and pong watchdogs, and revocation closes device sockets ([WebSocket](./api-reference/websocket.md)).

## Encryption key

`SESSION_ENC_KEY` is the 32-byte AES-256-GCM key for integration credentials and HTTP client fields, and
must be exactly 64 hexadecimal characters (`packages/node-core/src/server/secretBox.ts`). The Node
generates it into `session.key` in its data root when the environment doesn't supply it. A database
without usable key material fails closed.
