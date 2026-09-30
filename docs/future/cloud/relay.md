# The relay

Status: proposed, 2026-09-29. The relay is how a client reaches a Node that has no public address.
Every hosted Node sits behind it, and an owner can put their own local Node behind it for remote
access. It forwards bytes it cannot read.

## Why every hosted Node uses it

A hosted Node could take a public IP and a firewall rule instead. The relay is recommended for every
hosted Node, for four reasons:

- One path to test. Team Nodes, workers, restored Nodes, and an owner's local Node all connect the
  same way.
- No inbound ports on any hosted machine. A worker that is never reachable from the internet has a
  smaller attack surface than one with a firewall rule.
- Workers come and go every few minutes. Public addresses and DNS for each would churn, and some
  providers price public IPs per machine.
- The owner's local Node is behind NAT anyway, so the relay has to exist for
  [remote access](../remote.md#the-relay-service-acorndev-or-similar).

[Phase 1](./phases/01-node-image.md) uses a public address as a stepping stone. From
[phase 4](./phases/04-relay.md) on, hosted Nodes stop listening publicly.

## How a connection works

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

0. At boot, a relay-enabled Node opens one long-lived, multiplexed connection to its regional relay
   and authenticates with its relay credential. The relay records "Node N is here".
1. The client gets a relay ticket. For a hosted Node, the account service issues it with the grant.
   For an owner's local Node, the owner's account issues it.
2. Custody dials the relay over public TLS, presents the ticket, and asks for a stream to Node N.
3. The relay checks the ticket names N, then opens a stream to N over N's connection.
4. The client runs TLS 1.3 inside that stream against N's own certificate and checks the pinned
   fingerprint, exactly as it does for a direct connection. The relay sees only ciphertext.
5. Everything above TLS is unchanged: HTTP routes, the WebSocket, the `/v1/tunnel` port tunnel, and
   plugin bundle downloads.

Candidate framing: WebSocket to the relay, with a small stream multiplexer on top, since both ends
already run WebSocket code and it passes through HTTP proxies. HTTP/2 or QUIC are alternatives. The
choice is an open question in phase 4.

## What changes in the Node

- An outbound tunnel client, off unless relay configuration is present. Each incoming stream is
  handed to the existing HTTPS server with `server.emit('connection', socket)`, so TLS, the Host
  check, auth, and the WebSocket upgrade all run unchanged.
- The Host allowlist in `packages/node-core/src/server/transport/listener.ts` gains one synthetic
  name for relayed traffic, such as `<nodeId>.relay.acorn`, and the client sends that as `Host`. The
  reported endpoint stays loopback, because child processes validate against the loopback SAN
  ([remote Node setup](../../node-distribution.md#reaching-a-node-from-another-machine)).
- Reconnect with backoff when the relay drops, and report relay state in `GET /v1/node` as an
  optional field.

## What changes in the client

- The fleet record gains an optional relay route: relay URL and route ID. `endpoint` stays for
  display and for direct connections.
- The broker in `packages/custody/src/broker/nodeBroker.ts` gets a socket factory. For a relayed
  Node, it dials the relay, opens a stream, and hands that socket to the pinned TLS agent. For a
  direct Node, nothing changes.
- Relay tickets are short-lived and held in memory like grants.

Adding optional fields to the fleet record needs care: the fleet file schema is strict, and one
unexpected key empties the fleet. Extend the schema rather than spreading an object into it.

## What the relay knows

Node IDs, account or team IDs from tickets, connection times, durations, and byte counts per
direction. It meters bytes for billing. It does not know routes, methods, bodies, or which task a
stream is for.

## Owner remote access to a local Node

An owner who signs in can turn on relay access for their own local Node in Settings. The local Node
receives a relay credential through a device-authenticated route, connects outbound, and shows a
visible detach action. Only the owner's own devices, which pair in the usual way, can use it. The
relay ticket names the owner's account and the Node ID. No team member gains access, and the local
Node keeps its device-token model. The relay ticket gets you to the Node; the device token still
decides whether you get in.

## Scale and placement

One relay deployment per team region, so relayed traffic stays in region. A relay instance holds its
routing table in memory. With several instances in a region, a client landing on the wrong instance
either gets redirected or the instances share a routing table. Start with one instance per region
and a warm standby, then measure.

## Failure behavior

- Relay down: clients see the Node as `offline` with a relay reason, and cached reads stay visible,
  as they do for any offline Node. Agents on the Node keep running.
- Node reconnects: open streams drop, and the client's existing WebSocket reconnect and refetch
  path takes over.
- A changed fingerprint behind the relay is refused like any other identity mismatch.

## Verify before building

Check how the broker builds its TLS agent today and whether a custom socket can be supplied without
losing the pinning override. Check the WebSocket upgrade path in
`packages/node-core/src/server/transport/wsHub.ts` against a socket that arrived through `emit`.
Measure added latency for terminal input through the relay in each region.
