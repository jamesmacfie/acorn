# The relay

Date: September 29, 2026, moved from the cloud programme and revised October 22, 2026. Status:
proposed. The relay is how a client reaches a Node that has no public address. It forwards bytes it
can't read.

## Who uses it

- **An owner's local Node**, from [phase 1](./phases/01-relay.md) of this programme. The Node sits
  behind a home router, so it dials out to the relay and waits there.
- **Every hosted Node** in [cloud](../cloud/README.md): team Nodes, workers, and restored Nodes. None
  of them listens on a public address.

One path serves both, for four reasons:

- One path to test. A local Node, a team Node, and a worker all connect the same way.
- No inbound ports on any machine. A machine nobody can reach from the internet has less to attack
  than one behind a firewall rule.
- Cloud workers come and go every few minutes. Public addresses and DNS for each would churn, and
  some providers charge for a public address per machine.
- A home Node is behind NAT anyway, so the relay has to exist.

## How a native client connects

The desktop helper, the terminal client, the `acorn` command line, and the browser extension's bridge
all reach a Node through `NodeBroker` in `packages/custody/src/broker/nodeBroker.ts`. This is how they
connect through the relay:

```text
client custody                     relay                         Node
     │  1. ticket for nodeId N        │                            │
     │ ─────────────────────────────► │                            │
     │                                │ ◄── 0. outbound, relay     │
     │                                │     credential, "I am N"   │
     │  2. open stream to N           │                            │
     │ ─────────────────────────────► │ ── 3. new stream ────────► │
     │  4. TLS 1.3 handshake, pinned, end to end through the relay │
     │ ◄═══════════════════════════════════════════════════════════►
     │  5. HTTP and WebSocket frames, exactly as today            │
```

0. At boot, a Node with relay settings opens one long-lived connection to its relay, carrying many
   streams, and proves who it is with its relay credential. The relay records "Node N is here".
1. The client gets a relay ticket for Node N. With an account, the account service issues it
   ([accounts](./accounts.md#relay-credentials-and-tickets)). In self-hosted mode, the client
   presents the relay's static credential.
2. Custody dials the relay over ordinary public TLS, presents the ticket, and asks for a stream to
   Node N.
3. The relay checks the ticket names N, then opens a stream to N over N's connection.
4. The client runs TLS 1.3 inside that stream against N's own certificate and checks the pinned
   fingerprint, exactly as it does for a direct connection. The relay sees only ciphertext.
5. Everything above TLS is unchanged: HTTP routes, the event WebSocket, and plugin bundle downloads.

Candidate framing: a WebSocket to the relay, with a small stream multiplexer on top. Both ends already
run WebSocket code, it passes through HTTP proxies, and a browser can open one, which the phone needs.
HTTP/2 and QUIC are the alternatives. The choice is an open question in phase 1.

## How the phone connects

A phone browser can't run TLS inside a WebSocket, and can't pin a self-signed certificate. So the
phone uses the same relay with a different inner protocol. It opens a stream marked as a browser
stream, and runs its own encrypted handshake against the Node's channel key, which it learned when it
paired. The relay still sees only ciphertext. The Node hands browser streams to its channel endpoint
instead of its HTTPS server. [Phone](./phone.md#the-encrypted-channel) owns that design.

The phone reaches the relay at a public name with an ordinary certificate. It needs no certificate of
its own for the Node.

## What changes in the Node

- An outbound tunnel client, off unless relay settings are present. Each incoming native stream goes
  to the existing HTTPS server with `server.emit('connection', socket)`, so TLS, the `Host` check,
  auth, and the WebSocket upgrade all run unchanged. Browser streams go to the channel endpoint.
- The `Host` allowlist in `packages/node-core/src/server/transport/listener.ts` gains one made-up name
  for relayed traffic, such as `<nodeId>.relay.acorn`, and the client sends that as `Host`. The
  reported endpoint stays loopback, because child processes check against the loopback name
  ([remote Node setup](../../node-distribution.md#reaching-a-node-from-another-machine)).
- A relayed stream is never a loopback peer. Routes that trust a loopback caller, such as pairing
  asks, reach changes, and stop, see a remote caller and answer as they do for one.
- Reconnect with backoff when the relay drops, and report relay state in `GET /v1/node` as an
  optional field.

## What changes in the client

- The fleet record gains an optional relay route: the relay URL and route ID. `endpoint` stays for
  display and for direct connections.
- The broker gets a socket factory. Node's `https.Agent` accepts a custom `createConnection`. For a
  relayed Node, the factory dials the relay, opens a stream, and hands that socket to the pinned TLS
  agent. For a direct Node, nothing changes.
- Relay tickets are short-lived and held in memory.

The fleet file schema is strict, and one unexpected key empties the fleet. Extend the schema rather
than spreading an object into it.

## Self-hosted mode

A relay started with a static credential needs no account service. A Node and its clients share that
credential, set by hand in configuration. It's the setup phase 1 tests with, and the way someone who
never signs in runs remote access on their own server. Self-hosted mode has one owner per relay, so it
needs no tickets naming accounts.

## What the relay knows

Node IDs, account IDs from tickets, connection times, durations, and byte counts in each direction. It
meters bytes. It doesn't know routes, methods, bodies, or which task a stream is for.

## Turning remote access on for a local Node

An owner who signs in turns on **Remote access** for their local Node in Settings. The local Node asks
the account service for a relay credential through a device-authenticated route, connects outbound,
and shows the relay, since when, and a **Turn off** action. Turning it off revokes the credential and
drops the connection. The relay ticket gets you to the Node; the device token still decides whether
you get in.

## Scale and placement

Start with one relay per region, so relayed traffic stays close. A relay instance holds its routing
table in memory. With several instances in a region, a client that lands on the wrong instance either
gets redirected or the instances share a routing table. Start with one instance per region and a warm
standby, then measure.

## Failure behavior

- Relay down: clients see the Node as `offline` with a relay reason, and cached reads stay visible, as
  they do for any offline Node. Agents on the Node keep running.
- Node reconnects: open streams drop, and the client's existing WebSocket reconnect and refetch path
  takes over.
- A changed fingerprint behind the relay is refused like any other identity mismatch.

## Verify before building

Check how the broker builds its TLS agent today and whether a custom socket keeps the pinning
override. Check the WebSocket upgrade path in `packages/node-core/src/server/transport/wsHub.ts`
against a socket that arrived through `emit`. Measure added latency for terminal input through the
relay in each region.
