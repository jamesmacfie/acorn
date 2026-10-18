# Phase 1: give a browser a way to reach a Node

Date: October 17, 2026. Status: proposed.

## Goal

A browser on another device can read and write a Node's API and hold its event socket, without
seeing a device token or a certificate. A small gateway process on the Node's computer holds both.
The browser signs in to the gateway once with a one-time code and gets a session cookie. The Node's
auth and routes don't change.

## Starting point

- The desktop's helper does this job for the desktop renderer. `apps/desktop/src/helper/helperServer.ts`
  takes the renderer's requests over a local socket and hands them to a `NodeBroker`, which holds the
  token, the pinned certificate, and the event socket.
- The terminal client runs the same broker in its own process (`apps/tui/src/platform.ts`), and the
  extension's native host does too (`apps/cli/src/browser/nativeHost.ts`).
- `packages/custody/src/broker/nodeBroker.ts` owns the connection. `packages/custody/src/local/public.ts`
  owns a fleet file and token store in a directory you choose.
- A client on the Node's own computer can pair without a code
  ([pairing by approval](../../api-reference/transport.md#pairing-by-approval)). `askToPair` in
  `packages/custody/src/broker/nodePairing.ts` asks.
- Node pairing codes are 128 bits, last 10 minutes, allow five attempts, and live in memory only
  ([pairing](../../api-reference/transport.md#pairing)). The gateway copies those rules for phones.

## The design

The gateway lives in `apps/mobile/src/gateway`, beside the web app it serves, the way the desktop's
helper lives beside its renderer. It runs under Node.

### Pair the gateway with the Node

The gateway keeps its own custody directory, so the Node lists it as its own device, named "Acorn
mobile on HOST". It pairs by approval on first start, and falls back to a typed code, as the CLI's
`pairInteractively` does. It serves one Node: the local one, or a remembered one named with `--node`.

### Sign a phone in

On start, the gateway prints its address, a one-time code, and a QR code that opens the address. The
app's first screen asks for the code. A right code answers with a session cookie: `HttpOnly`,
`Secure`, `SameSite=Strict`, and `Path=/`. Every failure answers with the same `401`, as Node
pairing does.

The gateway stores sessions in its own directory: a hash of each session ID, a label from the user
agent, and when it was created and last used. `gateway sessions` lists them, and
`gateway revoke <id>` ends one and closes its socket. Revoking the gateway's device on the Node
cuts off every phone behind it.

### Forward requests

The gateway answers these paths:

| Path | What it does |
| --- | --- |
| `GET /` and the bundle's files | Serves the built web app with a `script-src 'self'` policy |
| `POST /session` | Spends a one-time code and sets the cookie |
| `/node/*` | Forwards the rest of the path to the Node through `broker.fetch`, and answers with the Node's status, headers, and body |
| `GET /events` | A WebSocket that carries client frames to `broker.send`, and the broker's frames, terminal bytes, and status back |

Every `/node` request and the `/events` upgrade need a live session. The gateway checks `Origin`
against its own address on every request with a body and on the upgrade, and checks `Host` against
the name it serves. When a phone drops a request before the answer, the gateway calls `broker.abort`
with the request's `x-request-id`.

The gateway copies the helper's limits: 16 MiB for a request, and the broker's own bounds on answers
and socket messages ([transport and auth](../../security/transport-and-auth.md#transport)).

### Refuse what a phone has no screen for

The gateway's device can do anything the owner can. A short denylist in one module refuses the route
families the first release has no screen for: pairing and devices, plugin installs and removals,
backup and restore, and security settings. A refusal answers `403` with a message that names the
desktop as the place to do it. A test pins the list, so adding a family is a reviewed change.

### Log safely

The gateway logs each request's ID, method, path, status, and time. It never logs a cookie, a code, a
token, or a body.

## Steps

1. Create the `apps/mobile` package with a `gateway` folder and a Vitest config. Register it with the
   workspace and the architecture checks in `tools/arch/boundaries.test.ts`, which list which apps may
   hold custody.
2. Write the session store, the one-time code, and the cookie.
3. Write `/node` forwarding over a `NodeBroker`, with the origin, host, and denylist checks.
4. Write `/events` relaying.
5. Add `pnpm dev:mobile:gateway`, which attaches to the Node `pnpm dev` or `pnpm dev:node` runs.

## Acceptance

- Unit tests cover the code's budget and expiry, the cookie's flags, a refused origin, a refused host,
  every denylisted family, a forwarded read and write against a fake broker, an abort, and frames in
  both directions.
- With a running Node, `curl` with the session cookie reads `/node/v1/core/tasks`, and without the
  cookie gets `401`.
- Revoking a session closes its socket within one second.

## Risks

- The Node sees one device for every phone. Its audit log names the gateway, not the phone. The
  gateway's own log is the only record of which phone did what.
- A stolen session cookie is owner access minus the denylist until someone revokes it. Keep the
  gateway on a private network until [Node-side sessions](./later.md#move-browser-sessions-to-the-node)
  exist.
