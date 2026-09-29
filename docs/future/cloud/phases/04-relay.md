# Phase 4: the relay

Status: proposed, 2026-09-29.

## Goal

Make every hosted Node reachable only through the relay, with the client still pinning the Node's
certificate end to end. Then use the same relay to let an owner reach their own local Node from
anywhere.

## What you can deploy at the end

- A relay in each staging region. Team Nodes with no public listener, reachable from desktop and TUI.
- **Remote access** for a signed-in owner's own local Node: turn it on in Settings, then pair and
  use that Node from another machine on another network.

Owner remote access is useful to people who never join a team. It can go to allowlisted users as
soon as it passes this phase.

## Starting point

- Team Nodes from [phase 3](./03-team-node.md), listening publicly.
- The pinned TLS agent in `packages/custody/src/broker/nodeBroker.ts`.
- The Host allowlist in `packages/node-core/src/server/transport/listener.ts`.
- The WebSocket hub in `packages/node-core/src/server/transport/wsHub.ts` and the port tunnel in
  `packages/node-core/src/server/transport/tunnel.ts`.
- The design in [relay](../relay.md).

## In scope

- The relay protocol and server in `apps/relay` (new).
- The Node's outbound tunnel client.
- The client's relay socket factory and the fleet record's relay route.
- Relay credentials at enrollment v2 and relay tickets with grants.
- Removing the public listener from hosted Nodes.
- Owner remote access for local Nodes.
- Byte metering per Node and account.

## Out of scope

Billing for relay bytes, which is phase 10. Browser access through the relay, which is out of the
first release.

## Steps and checkpoints

### 1. Write the protocol

Write the relay protocol before code: framing, stream open and close, authentication for each side,
keepalive, backoff, limits, and versioning. Publish it in the relay's own folder so someone else
could build a compatible relay.

### 2. The relay, the tunnel client, and the socket factory

Build the three pieces together, since none can be tested alone.

**Checkpoint 1: one Node through a local relay.** In the local stack, run the relay and a Node
container with no published port. The Node connects out. Pair the desktop through the relay. The
identity words should match the Node's banner.

**Checkpoint 2: the relay sees only ciphertext.** Capture traffic on the relay's Node-side
connection during an agent turn. It should contain TLS records only, with no readable HTTP.

**Checkpoint 3: pinning still bites.** Replace the Node behind the relay with a different Node that
claims the same Node ID. The client should refuse it with an identity mismatch.

**Checkpoint 4: everything above TLS works.** Through the relay, open a terminal and type, stream an
agent turn, open a plugin pane that downloads its bundle, and open a preview through `/v1/tunnel`.
All should work, and terminal typing should feel no slower than a direct connection to the same
region.

### 3. Credentials and tickets

The account service issues a relay credential in the enrollment v2 reply and a relay ticket with
every grant. The relay checks both.

### 4. Hosted Nodes go private

Remove the public listener from team Nodes. From now on, hosted Nodes accept connections only through
the relay.

**Checkpoint 5: staging team Node, relay only.** On staging, confirm the team Node has no public port.
Use it from desktop and TUI.

**Checkpoint 6: restarts.** During an agent turn, restart the relay. Then restart the team Node. The
agent should finish either way, and both clients should reconnect and show the whole transcript with
no gap and no duplicate approval.

### 5. Owner remote access

Add a Settings control on a local Node, available when the cloud plugin is signed in. Turning it on
requests a relay credential through a device-authenticated route and connects the Node outbound. The
control shows the relay, since when, and a **Turn off** action that revokes the credential and drops
the connection.

**Checkpoint 7: reach home from elsewhere.** On laptop A, turn on remote access. On laptop B, on a
different network and signed in to the same account, pair laptop A's Node through the relay with its
pairing code. Run an agent on it. Turn remote access off on laptop A. Laptop B should lose the Node
at once.

**Checkpoint 8: nobody else gets in.** Sign in on laptop C with a different account and try to
connect to laptop A's Node through the relay. The relay should refuse the ticket.

### 6. Metering

The relay reports bytes per direction per Node and account to the account service every minute. The
web app shows totals for the owner. No charge yet.

## Acceptance

- No hosted Node has a public port.
- The relay cannot read traffic, and a substituted Node is refused.
- Client and Node reconnect cleanly after relay or Node restarts.
- Owner remote access works across networks and is refused to other accounts.
- A local Node with no account and remote access off behaves exactly as before, with no outbound
  connection.

## Docs to update when it ships

- A new owning document, `docs/relay.md` (new), for the protocol and the Node and client behavior.
- [remote access](../../remote.md): the relay section points to the owning document.
- [node distribution](../../../node-distribution.md): remote access for a local Node.
- [security](../../../security.md): what the relay can and cannot see.

## Open questions

1. WebSocket with a small multiplexer, HTTP/2, or QUIC for framing?
2. TypeScript or Go for the relay server? Start in TypeScript and measure.
3. With several relay instances in a region, how does a client find the instance its Node is on?
4. What latency is acceptable for terminal input through the relay, per region?
5. How do you stop the relay being used as a free general-purpose tunnel? Limits per account, per
   Node, and per stream.
6. Is owner remote access free, part of a personal plan, or paid?
7. How does a self-hoster run their own relay, and how does a Node point at it without an acorn
   account?
8. How is the relay protocol versioned, and how do old Nodes and new relays interoperate?
9. Does pairing through the relay need any change to the pairing routes? It should not, because
   `/v1/pair` runs over the same pinned TLS.

## Evidence

Record latency and throughput measurements here, with dates.

## Verify before building

Check that the broker can take a custom socket without losing its pinning override. Check that the
WebSocket upgrade and the Host check work for a socket that entered the HTTPS server through
`emit('connection')`.
