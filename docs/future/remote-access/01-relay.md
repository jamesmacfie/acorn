# Phase 1: the relay

Date: October 22, 2026. Status: proposed. Taken from cloud's former relay phase, without the hosted
Node parts.

## Goal

Build a relay that forwards encrypted bytes between a client and a Node with no public address, with
the client still pinning the Node's certificate end to end. Run it in self-hosted mode, with a static
credential and no account service.

## What you can deploy at the end

`apps/relay`, runnable by anyone on a server they control. A Node configured with the relay's address
and credential dials out to it. The desktop, terminal client, `acorn` command line, and browser
extension reach that Node through the relay from another network, and pair with a code as they do
today.

## Starting point

- Every native client connects through `NodeBroker` in `packages/custody/src/broker/nodeBroker.ts`,
  which builds an `https.Agent` with a pinning override. Callers: the desktop helper
  (`apps/desktop/src/helper/rendererConnection.ts`), the terminal client (`apps/tui/src/platform.ts`),
  the CLI (`apps/cli/src/node.ts`), the extension bridge (`apps/cli/src/browser/bridge.ts`), and the
  phone gateway (`apps/mobile/src/gateway/main.ts`).
- The `Host` allowlist in `packages/node-core/src/server/transport/listener.ts`.
- The WebSocket hub in `packages/node-core/src/server/transport/wsHub.ts`.
- The loopback check in `packages/node-core/src/server/transport/loopbackPeer.ts`.
- The design in [relay](./relay.md).

## In scope

- The relay protocol, written first.
- The relay server in `apps/relay` (new), in self-hosted mode.
- The Node's outbound tunnel client and its settings.
- The broker's socket factory and the fleet record's relay route.
- A way to add a relayed Node in each client: an address field that accepts a relay route.

## Out of scope

Accounts, tickets, and the **Remote access** switch, which are phase 2. Browser streams, which are
phase 4. Metering, which is phase 5.

## Steps and checkpoints

### 1. Write the protocol

Write the relay protocol before any code: framing, opening and closing a stream, how each side proves
who it is, keepalive, backoff, limits, versioning, and the stream kind field that phase 4 uses for
browser streams. Publish it in `apps/relay` so someone else could build a compatible relay.

### 2. The relay, the tunnel client, and the socket factory

Build the three together, since none can be tested alone.

**Checkpoint 1: one Node through a local relay.** Run the relay and a Node from a checkout with no
advertised host. The Node connects out. Pair the desktop through the relay with a code. The identity
words should match the Node's banner.

**Checkpoint 2: the relay sees only ciphertext.** Capture traffic on the relay's Node-side connection
during an agent turn. It should contain TLS records only, with no readable HTTP.

**Checkpoint 3: pinning still bites.** Replace the Node behind the relay with a different Node that
claims the same Node ID. The client should refuse it with an identity mismatch.

**Checkpoint 4: everything above TLS works.** Through the relay, open a terminal and type, stream an
agent turn, and open a plugin pane that downloads its bundle. All should work, and typing should feel
no slower than a direct connection to the same region.

**Checkpoint 5: loopback trust doesn't leak.** Through the relay, call `POST /v1/pair/requests`,
`PUT /v1/core/node/reach`, and `POST /v1/core/node/stop`. Each should refuse the caller as remote.

### 3. Every native client

Add the relay route to the terminal client, the CLI's `--node`, and the extension's **Connect to
another Node** screen. The broker change covers their connections, so this step is about entering and
storing the route.

**Checkpoint 6: four clients, one relayed Node.** From a second machine on another network, pair and
use the Node from the desktop, the terminal client, `acorn --node`, and the extension.

### 4. Restarts

**Checkpoint 7: restarts.** During an agent turn, restart the relay. Then restart the Node. The agent
should finish either way, and the clients should reconnect and show the whole transcript with no gap
and no duplicate approval.

**Checkpoint 8: no settings, no connection.** Start a Node with no relay settings. It should make no
outbound connection.

## Acceptance

- The relay can't read traffic, and a substituted Node is refused.
- Loopback-only routes refuse relayed callers.
- All four native clients work through the relay and reconnect after relay or Node restarts.
- A Node with no relay settings behaves exactly as before.

## Docs to update when it ships

- A new owning document, `docs/relay.md` (new), for the protocol, the Node and client behavior, and
  self-hosted mode.
- [Reaching a Node](../../node-distribution/reaching.md): a relay as a third way in.
- [Security](../../security.md): what the relay can and can't see.

## Open questions

1. WebSocket with a small multiplexer, HTTP/2, or QUIC for framing? A browser must be able to open it
   in phase 4.
2. TypeScript or Go for the relay server? Start in TypeScript and measure.
3. What latency is acceptable for terminal input through the relay?
4. How is the relay protocol versioned, and how do old Nodes and new relays work together?
5. Where does a Node keep its relay settings: `node.json`, an environment variable, or both, with the
   same precedence as `advertiseHost`?

## Evidence

Record latency and throughput measurements here, with dates.

## Verify before building

Check that the broker can take a custom socket without losing its pinning override. Check that the
WebSocket upgrade and the `Host` check work for a socket that entered the HTTPS server through
`emit('connection')`.
