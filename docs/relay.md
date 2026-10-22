# The relay

A relay joins a client to a Node that has no public address. The Node dials out to the relay, and a
client reaches the Node through it from any network. The relay forwards bytes it can't read, because
the client runs TLS to the Node inside the relayed stream and pins the Node's certificate as it does on
a direct connection. Read this page to run a relay, point a Node at one, or change the code on either
side.

## What it does

A relayed connection has three parts:

- **The relay**, in `apps/relay`. `apps/relay/src/relay.ts` joins streams, and
  [the relay protocol](../apps/relay/PROTOCOL.md) is the wire format, written so someone else can build
  a compatible relay.
- **The Node's tunnel**, in `packages/node-core/src/server/transport/relayTunnel.ts`. It holds one
  control connection to the relay and opens a connection for each stream the relay offers.
- **The client's socket factory**, `RelayAgent` in `packages/custody/src/broker/relaySocket.ts`. Every
  connection the broker or pairing makes to a relayed Node is one relay stream.

`@acorn/protocol/relay.ts` holds what the three share: the paths, the control messages, and the limits.

A stream opens like this:

1. The client asks the relay for a stream to the Node's route, with `?kind=tls`.
2. The relay offers the stream to the Node on its control connection, and the Node opens its end.
3. The relay completes both WebSocket upgrades and joins them.
4. The client runs TLS 1.3 to the Node inside the stream and checks the pinned fingerprint.

Everything above TLS is unchanged: HTTP routes, the event WebSocket, and plugin bundle downloads.

A phone's browser opens its stream with `?kind=browser` and offers its ticket as a subprotocol, because it
can't set `Authorization`. It runs an encrypted handshake against the Node's channel key instead of TLS
([the phone channel](./relay/phone-channel.md)). A Node that serves no `browser` streams refuses one with a
`refuse` message, so an older Node answers a phone with `502` at once.

## The Node

A Node with relay settings dials its relay as soon as its listener binds. The settings are a relay
URL and the relay's credential, from either of these places:

- `ACORN_RELAY_URL` and `ACORN_RELAY_CREDENTIAL` in the environment. They win over `node.json`, as
  `ACORN_ADVERTISE_HOST` does, and you set both or neither.
- `"relay": { "url": "wss://relay.example.com", "credential": "..." }` in the data root's `node.json`,
  written by hand while the Node is stopped.

`relaySettings` in `packages/node-core/src/server/transport/relaySettings.ts` reads them once per
listener. A Node with neither loads none of the tunnel's code and makes no outbound connection.
Agents don't see the variables, because a child's environment is an allowlist.

The Node registers under its Node ID, which is its route. Each stream it accepts enters its HTTPS
server with `server.emit('connection')`, so TLS, the `Host` guard, device auth, and the WebSocket
upgrade run on it as on any connection. A relayed client sends `Host: <node ID>.relay.acorn`. The Node
accepts that name only while it has relay settings. The name is made up, so no DNS answers for it.

A relayed socket has no peer address. Routes that trust a loopback caller, such as pairing by
approval, `PUT /v1/core/node/reach`, and `POST /v1/core/node/stop`, refuse it as remote, and an
internal child token isn't accepted through it.

The tunnel reconnects after 1, 2, 4, 8, 16, and then every 30 seconds, with jitter, and it logs a
repeated failure once. When another connection takes its route, the relay closes the tunnel with code
4000. The Node logs an error and stops dialing until it restarts, so two Nodes holding one route don't
take it from each other forever. Code 4001 means the account service revoked the Node's credential, and
the Node stops dialing the same way.

A standalone Node prints its relay address under **Through relay** in its banner, with `CREDENTIAL`
in place of the credential, because the banner often lands in a service log.

## The client

The address field in **Settings → Nodes**, the extension's **Connect to another Node** screen, and
`--node` in `acorn` and the terminal client take a relay address in place of an `https://` endpoint:

```text
wss://<credential>@relay.example.com/<node ID>
```

`parseNodeAddress` in `packages/custody/src/broker/relaySocket.ts` takes the credential off the address.
Type the full address once. Afterward, name the Node by its label or ID, because other users of a
computer can read a command's arguments.
Pairing then runs as it does for a direct Node: probe, compare the identity words with the Node's
banner, and type the pairing code. Pairing by approval needs a loopback caller, so a relayed Node
always pairs with a code.

The fleet record keeps the relay route, `relay: { url, route }`, beside an endpoint of
`https://<node ID>.relay.acorn`, and shows the relay address wherever it shows an address. The
credential stays in custody with the certificate, in the fleet file, and never reaches a renderer or
the extension. It lets a holder reach the relay, not the Node, which still asks for the device token.

The broker builds a `RelayAgent` for a node with a relay route. Its pooling, keep-alive, heartbeat,
and reconnect are the ones a direct node gets. A relay that refuses the stream, or a Node that isn't
connected to it, reads as `offline` with `unreachable`.

## Accounts

A relay can check an account service's signed tickets and Node credentials instead of one static
credential, and a person turns on **Remote access** for a Node from **Settings → Account**.
[Relays and accounts](./relay/accounts.md) covers who may connect, tickets, and remote access.

## Run your own relay

Self-hosted mode has one owner per relay. The relay, your Nodes, and your clients share one static
credential that you choose:

```sh
export ACORN_RELAY_CREDENTIAL=$(openssl rand -hex 32)
pnpm --filter @acorn/relay start
```

| Variable | What it sets | Default |
| --- | --- | --- |
| `ACORN_RELAY_CREDENTIAL` | The credential, at least 16 characters. Required unless `ACORN_RELAY_ACCOUNT_URL` is set. | None |
| `ACORN_RELAY_ACCOUNT_URL` | An account service to check tickets and credentials against, in place of a static credential. | None |
| `ACORN_RELAY_PORT` | The port. | `8443` |
| `ACORN_RELAY_HOST` | The address to bind. | `0.0.0.0` |
| `ACORN_RELAY_TLS_CERT` and `ACORN_RELAY_TLS_KEY` | PEM files, to serve `wss://` directly. | Unset, which serves `ws://`. |

On a public network, serve `wss://`, either with a certificate and key or behind a proxy that
terminates TLS. Plain `ws://` still carries only the Nodes' TLS, but it sends the credential in the
clear.

## What the relay can and can't see

The relay knows routes, stream IDs and kinds, connection times, and byte counts. It doesn't hold a
key to any Node's TLS, so it can't read routes, bodies, tokens, or terminal output. A relay breach
gives away who connected when, not what they did.

In self-hosted mode, a holder of the credential can register any route. That can take a route from your Node, which is a
denial of service, but not an impersonation: the client pins the Node's certificate, and a different
Node fails the pin as `identity_mismatch`. A first pairing is as safe as the owner's comparison of the
identity words.

## Limits and known gaps

- A relay instance holds its routes in memory. A restart drops every stream, and Nodes and clients
  reconnect on their own schedules.
- `GET /v1/node` doesn't report relay state, and a relay failure reads as an ordinary `unreachable`.
- The relay doesn't meter bytes or rate-limit connections.
- The `browser` stream kind is reserved for a phone's encrypted channel. A Node refuses it.

## Why

- **One WebSocket per stream, not a multiplexer.** Each stream rides its own TCP connection on both
  legs, so flow control and backpressure come from TCP, and one busy terminal can't stall another
  stream. A stream costs one more connection from the Node, which a kept-alive broker opens rarely.
- **WebSocket framing.** Both ends already run `ws`, it passes through HTTP proxies, and a browser can
  open one, which the phone needs.
- **The client's upgrade waits for the Node.** An open WebSocket is a stream that reaches the Node, so
  the client starts TLS at once, and every failure arrives as an HTTP status rather than a close code.
