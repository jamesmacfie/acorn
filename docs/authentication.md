# Authentication

acorn has no accounts, login screen, session cookie, or session state. A Node has one owner. A
client becomes a trusted client for that Node by pairing and then presents a device bearer on every
request.

The implementation is in `packages/node-core/src/server/auth/`, the pairing routes, and the desktop
broker in `apps/desktop/src/shell/` with its Rust half in `apps/desktop/src-tauri/src/`.

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
| `device` | `Authorization: Bearer acorn_dt_…` | Paired owner client; full owner authority |
| `internal` | `x-acorn-internal: <token>` | Node-spawned process or Node service call, constrained by token scope |

`userId` is an opaque node-owner id used to scope identity-owned records. It is minted and bound at
first boot (`ensureBoundIdentity`). Installs that bound a GitHub login under the earlier scheme keep
that login as the opaque id. Providers never bind identity: a GitHub login is metadata on its
integration row. Internal authentication fails closed on an unbound identity, which after first boot
only a bare test environment can produce.

The bearer and internal paths are mutually exclusive during resolution. A malformed or rejected
device bearer never falls through to internal authentication.

## Node transport

Nodes use HTTPS with TLS 1.3 on `127.0.0.1` and an ephemeral port. Each Node mints a long-lived
self-signed certificate in `<data-root>/tls/`. The desktop stores the certificate fingerprint and
compares every connection against it; a changed fingerprint stops the connection and requires an
explicit repair of the Node entry.

The Node also validates the `Host` header against the exact bound loopback port. The renderer never
performs TLS or bearer handling: it calls the broker through the injected bridge, and the desktop
helper owns the endpoint, pinned agent, and device token.

## Device tokens

Tokens have the form `acorn_dt_<uuid>_<base64url-secret>`. The raw value is returned only in the
pairing response. The Node stores a SHA-256 hash in `devices`; the desktop helper stores the raw
token in a blob scoped to the Node, encrypted under the data key the shell holds in the OS keychain. Authentication failures return the same null result for
missing, malformed, unknown, revoked, or incorrect tokens.

Revoking a device through `DELETE /v2/core/devices/:id` invalidates future HTTP calls and closes its
live sockets. A 60-second activity sweep is the backstop for long-lived streams. A client can revoke
itself; the desktop separately forgets a Node entry when the user chooses unpair.

## Pairing

Pairing uses one-time in-memory codes:

1. An owner opens a window with `POST /v2/core/pair/start`. The Node returns a code valid for ten
   minutes, with five attempts and a per-node rate ceiling.
2. The new client probes `GET /v2/node` and compares the presented certificate fingerprint with the
   fingerprint shown by the owner.
3. The client submits the code and device name to `POST /v2/pair` over the pinned connection.
4. The Node creates a device row and returns the device token once.

Pairing failures use one `401 pairing_failed` response with no distinguishing details. The bundled
local Node is a special case: the helper spawned it, so the service handshake can return a device token
without a user-entered code. The token is still stored and authenticated as a normal device token.

Device administration is device-only:

| Route | Purpose |
| --- | --- |
| `POST /v2/core/pair/start` | Open or replace the pairing window |
| `DELETE /v2/core/pair` | Close the pairing window |
| `GET /v2/core/devices` | List paired devices without token material |
| `DELETE /v2/core/devices/:id` | Revoke a device |

## Internal tokens

The Node persists an internal signing key in `internal-token`. It mints stateless HMAC tokens with
these scopes:

- `service`: Node-owned loopback orchestration; never injected into a child process.
- `task`: a PTY, agent, workflow step, or MCP process bound to one `taskId`, optionally a
  `sessionId`, and optionally a server-owned effective tool ceiling.

Task tokens are checked at task route mounts, stream upgrades, and task-owned operations. They cannot
pair devices, administer devices or plugins, read the HTTP client's encrypted request material, or
use the renderer-facing agent-tool projection. The session claim authorizes session-required tools
such as managed-agent orchestration. The Node reads it from the verified token, never from
`x-acorn-session-id`.

A workflow or delegated managed session persists its effective tool ceiling, and the runtime includes
that value when it mints the token. The agent-tool route enforces only the signed ceiling;
`ACORN_TOOL_CEILING` and `x-acorn-tool-ceiling` remain compatibility metadata and cannot widen
authority. The tokens do not expire; rotating the signing key is the revocation mechanism needed for
tmux sessions that survive a Node restart.

The GitHub credential is an integration secret, not part of `Principal`. GitHub routes read it
through `plugins/github/src/server/githubToken.ts`, so an internal caller that can reach a GitHub
route can spend the owner's GitHub credential. Know where that boundary sits: task scope limits task
access, and it is not a universal provider-credential firewall.

## GitHub connection

GitHub uses the OAuth device authorization grant. The Node requests a device code, the owner enters
the user code at GitHub, and the Node polls until the token is issued. The token is validated and
stored as an encrypted `integrations` row.

| Route | Purpose |
| --- | --- |
| `POST /v2/p/github/auth/device/start` | Request a GitHub device code |
| `POST /v2/p/github/auth/device/poll` | Poll once and connect on success |

The flow needs `GITHUB_CLIENT_ID`, does not use a client secret, and has no callback URL. The token
never appears in a response or renderer state.

## WebSocket authentication

`/v2/events` checks the exact Node `Host` and either the device bearer or internal token before the
upgrade completes. It has no cookie or browser-origin authentication. The socket carries a sequence
numbered live event stream plus feature streams; clients reconnect and refetch after a gap. Both
client and Node use ping/pong watchdogs, and revocation closes device sockets.

## Encryption key

`SESSION_ENC_KEY` is the 32-byte AES-256-GCM/JWE key for integration credentials and HTTP-client
fields. It must be exactly 64 hexadecimal characters. The Node generates and stores it beside its own
data root; development may provide it through the environment. A database without usable key
material fails closed.
