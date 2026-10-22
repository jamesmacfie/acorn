# Mobile gateway

The mobile gateway lets a browser on a phone read and write one Node's API and hold its event socket.
The browser never sees a device token or a certificate. Read this page before you change the gateway
or build a client against it.

## What it does

The gateway is a Node.js process on the Node's computer, in `apps/mobile/src/gateway`. It does for a
phone what the desktop helper does for the renderer: it holds a `NodeBroker`, with the device token,
the pinned certificate, and the Node's event socket. The phone signs in once with a one-time code and
gets a session cookie. The Node's auth and routes don't change.

| File | What it owns |
| --- | --- |
| `apps/mobile/src/gateway/main.ts` | Picks and pairs the Node, starts the broker and the server, prints the sign-in code, and runs `sessions` and `revoke`. It's also the CLI's `mobile-gateway` bundle entry |
| `apps/mobile/src/gateway/gateway.ts` | The HTTP server: the checks, sign-in, `/node` forwarding, the `/events` socket, and the web app's files |
| `apps/mobile/src/gateway/sessions.ts` | Phone sessions on disk |
| `apps/mobile/src/gateway/denylist.ts` | The Node routes a phone can't reach |

### Pair with a Node

The gateway keeps its own custody directory, `mobile` under the client config directory, so the Node
lists it as a device of its own, named "Acorn mobile on HOST". It serves one Node: the one running on
this computer, or a remembered one named with `--node`. With no token for that Node, it pairs the way
the CLI does: it asks the Node to show an approval dialog in the desktop, and accepts a typed pairing
code at the same time. Revoking the gateway's device on the Node cuts off every phone behind it.

### Sign a phone in

On start, the gateway prints its address, a QR code for the address, and a one-time sign-in code. The
code follows the Node's pairing rules, from the same `pairingCodes` store: 128 bits, 10 minutes, five
attempts, in memory only. `kill -USR1 PID` prints a new code and ends the old one.

`POST /session` with `{ "code": "..." }` spends the code. A right code answers `204` with a cookie
named `acorn_session`, flagged `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`, with a 30-day
`Max-Age`. `GET /session` sends the cookie again with a fresh 30 days, and the phone asks it each time
it starts, so the browser keeps the cookie while the phone is in use. Every failure answers the same `401 sign_in_failed`: a wrong code, a spent or expired one,
a malformed body, or a body over 4 KiB. A malformed or oversized body spends no attempt.

### Keep sessions

Each session is a file under the gateway's directory, named by the SHA-256 hash of the session ID. It
holds a label taken from the user agent and the time it started. The file's modification time is when
the phone last used it. Nothing on disk is a credential a browser could present.

A session ends after 30 days without use. Each `/node` request and the socket upgrade mark the session
used, and so does a socket message, at most once a minute per phone. The gateway deletes a session's
file the first time it finds the session idle past the limit: on a request, in its socket check, or
in `gateway sessions`, which lists only sessions that still work. The phone then gets the same
`401 signed_out`, or socket close `4401`, as a revoked one.

`gateway sessions` lists the sessions with a 12-character ID each, and `gateway revoke ID` deletes
one. The running gateway checks its open sockets against the files every 500 milliseconds and closes
a revoked phone's socket with code `4401`. That code tells the phone it's signed out rather than
offline. The phone's next `/node` request gets `401 signed_out`.

### Check every request

The gateway listens on `127.0.0.1` only. It serves one address, given with `--origin`, and defaults
to `http://127.0.0.1:PORT`. Behind `tailscale serve`, that address is the tailnet name, such as
`https://HOST.TAILNET.ts.net`, with a certificate a phone trusts ([use it on a
phone](../mobile/phone-setup.md)). These checks run before anything else:

- `Host` must be the served address's host, on every request and on the socket upgrade. This stops a
  page on another name that resolves to the gateway from reading its answers.
- `Origin` must be the served address on every request other than `GET` and `HEAD`, and on the
  upgrade. A request without one is refused.
- Every `/node` request and the upgrade need a live session cookie.

A refused host or origin answers `403`, a missing session answers `401`, and a refused upgrade closes
the connection.

### Forward requests

The gateway answers these paths:

| Path | What it does |
| --- | --- |
| `POST /session` | Spends a sign-in code and sets the cookie |
| `GET /session` | Names the Node, as `{ nodeId, label }`, to a phone with a live session, and answers `401 signed_out` to one without |
| `/node/*` | Forwards the rest of the path and the query to the Node through `broker.fetch`, and answers with the Node's status, headers, and body |
| `GET /events` | The event socket |
| Any other `GET` | A file from the built web app in `apps/mobile/dist`, or its `index.html` for a path without an extension, with `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` |

A forwarded request keeps its headers except the ones that describe the phone's connection to the
gateway: the cookie, `Authorization`, `Host`, `Origin`, `Referer`, the `Sec-` and `X-Forwarded-`
families, and the hop-by-hop headers. The broker sets the Node's own `Authorization`. The answer drops
`Set-Cookie` and the hop-by-hop headers.

The gateway sandboxes every forwarded answer, so a Node answer never renders as a page with the
phone's session. It replaces any `Content-Security-Policy` and `X-Content-Type-Options` the Node sent
with `Content-Security-Policy: sandbox; default-src 'none'` and `X-Content-Type-Options: nosniff`. A
loaded plugin's HTML opened at a `/node` address runs no script, makes no requests, and has an opaque
origin, so it can't use the cookie. The app reads these answers with `fetch`, which the policy doesn't
touch, and an image still draws. The gateway's own error answers carry the same two headers.

The request's `x-request-id`, or a fresh one, becomes the broker's request ID, prefixed with the
session so phones can't collide. When the phone closes a request before the answer, the gateway calls
`broker.abort` with that ID. A request body is capped at 16 MiB, the desktop helper's limit, and the
broker bounds the answers. A Node that can't be reached answers `502 node_unreachable`, or `504` when
the broker's deadline passes.

### Refuse what a phone has no screen for

The gateway's device has owner power, so `DENIED_ROUTES` refuses these families with
`403 gateway_refused` and a message that sends the person to Acorn on their computer:

- Pairing and devices: `/v1/pair`, `/v1/core/pair`, and `/v1/core/devices`, every method.
- Plugin settings: every `POST`, `PUT`, `PATCH`, and `DELETE` under `/v1/core/plugins`. That covers
  installs, removals, reloads, development mode, grants, skills, the roster switch, answers to an
  agent's install request, and plugin CLI commands. One rule refuses a plugin write route added later
  too. `GET` stays open, so the phone can read the roster. The phone runs no loaded plugins, and no
  screen on it answers an install request.
- Backup and restore: `/v1/core/backup`.
- Security settings: `/v1/core/security` and `PUT /v1/core/node/reach`.
- Stopping the Node: `POST /v1/core/node/stop`.

The Node answers pairing asks, reach changes, and stop requests only from a loopback peer, because it
trusts that caller to be someone at its computer. The gateway is a loopback peer, so it must refuse
those routes, or every phone would pass that check. The match runs on the decoded path with repeated
and trailing slashes removed and in lower case, so `%64evices` and `/V1//core/devices/` are refused
too. `denylist.test.ts` pins the list.

### Relay events

`GET /events` upgrades to a WebSocket that carries one phone's events. Each phone gets an event viewer
of its own on the Node connection, opened when the socket opens and closed when it closes. Messages
are JSON text, except terminal output:

| Direction | Message |
| --- | --- |
| Phone to gateway | `{ frame, intent?, cleanup? }`, passed to `broker.send` |
| Gateway to phone | `{ frame }` for a Node frame addressed to this phone or to every phone |
| Gateway to phone | `{ status }` with the Node's `NodeStatus`, sent once on connect and on every change |
| Gateway to phone | `{ error }` with a `NodeTransportError` for this phone's viewer |
| Gateway to phone | A binary message with terminal output, as the broker received it |

A message over 8 MiB, the Node's event message ceiling, closes the socket. So does one that isn't
JSON. A JSON message of any other shape is dropped. The gateway pings each socket every 15 seconds and drops one that doesn't
answer, so a phone that left the network doesn't hold a viewer slot.

### Log safely

The gateway logs each request's ID, method, path without its query, status, and time. It never logs
a cookie, a code, a token, or a body.

## Run it

`acorn mobile` runs the gateway from a packaged build. It takes `--node`, `--port`, and `--origin`, and
`--app-dir` for a web app that isn't the one beside the CLI. `acorn mobile sessions` and
`acorn mobile revoke ID` list and end sessions ([the command](../cli/mobile.md)).

In a checkout, run `pnpm dev:mobile:gateway` beside `pnpm dev` or `pnpm dev:node`. It attaches to the Node for the
checkout's data root, `apps/node/.acorn/`, unless `ACORN_DATA_DIR` names another. Pass `--port` to
move it from 4320 and `--origin` to serve another address, such as
`pnpm dev:mobile:gateway -- --origin https://HOST.TAILNET.ts.net`. Then sign in with `curl`:

```sh
curl -i -X POST http://127.0.0.1:4320/session \
  -H 'Origin: http://127.0.0.1:4320' -H 'Content-Type: application/json' \
  -d '{"code":"CODE"}'
curl -H 'Cookie: acorn_session=SESSION' http://127.0.0.1:4320/node/v1/core/tasks
```

Run `pnpm --filter @acorn/mobile gateway sessions` to list sessions and
`pnpm --filter @acorn/mobile gateway revoke ID` to end one.

To work on the web app the gateway serves, run `pnpm dev:mobile` instead. It starts the gateway behind
a dev server ([mobile web app](../mobile.md#run-it)).

## Limits

- The Node sees one device for every phone behind a gateway, and its audit log names the gateway.
  The gateway's own log is the only record of which phone did what.
- A stolen session cookie gives owner access, minus the denylist, until someone revokes it or until
  nobody has used it for 30 days. A session in use doesn't expire. Keep the gateway on a private
  network.
- The gateway serves one Node. A phone that uses two Nodes needs two gateways.
- Loaded plugins don't run on a phone, because the browser has no plugin custody.

## Why

A browser can't set a header on a WebSocket upgrade, and a phone's browser refuses the Node's pinned,
self-signed certificate. Teaching the Node to hold browser sessions, check origins, and present a
trusted certificate changes its security model. The gateway lets the phone work start without that
change, and keeps the token in a process the browser can't read, the way the browser extension's
native host does ([what runs where](../browser-extension.md#what-runs-where)). The plan for moving
sessions onto the Node is in [mobile work after the first release](../future/mobile/later.md).
