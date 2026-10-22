# Phase 1: the relay

Date: October 22, 2026. Status: built October 22, 2026, on branch `phase-1-relay`. Taken from cloud's
former relay phase, without the hosted Node parts.

## Completion note

October 22, 2026.

### What landed

- **Step 0.** `packages/custody/src/broker/relayTransport.test.ts` proves both risky assumptions with
  an in-memory stream pair standing in for a relay. The broker dials through it with a custom
  `createConnection`, requests and the event WebSocket work, the pin still runs, and a Node with
  another certificate is refused. The Node's HTTPS server takes a socket by `emit('connection')`,
  accepts the relay `Host`, upgrades the event socket, and treats the caller as remote.
- **The protocol**, in `apps/relay/PROTOCOL.md`, and its shared names in `@acorn/protocol/relay.ts`.
- **The relay**, `apps/relay` (`pnpm --filter @acorn/relay start`), in self-hosted mode with one
  static credential, `ws://` or `wss://` with a certificate and key.
- **The Node's tunnel**, `relayTunnel.ts` and `relaySettings.ts` in node-core's transport folder. The
  listener loads it on demand only when relay settings exist, and accepts `<node ID>.relay.acorn`
  only then. The standalone banner prints the relay address with `CREDENTIAL` in its place.
- **The client side.** `RelayAgent` and `openRelayStream` in `@acorn/custody`, used by the broker and
  by pairing. `parseNodeAddress` takes `wss://<credential>@relay/<node ID>` in every address field.
  The fleet record gains `relay: { url, route }`, and the credential stays in custody
  (`FleetNode.relayCredential`). `toBrokerNode`, `pairedNode`, and `publicProbe` replace the object
  literals five clients repeated, so the credential reaches every broker and never a renderer.
- **Clients.** Desktop and terminal client Settings → Nodes (shared client-core screen), `acorn
  --node`, the terminal client's `--node`, and the extension's **Connect to another Node** accept a
  relay address and show the relay address for a relayed Node.
- **Docs.** `docs/relay.md` (new), and updates to `docs/node-distribution/reaching.md`,
  `docs/security.md`, `docs/data-layer/data-root.md`, `docs/cli.md`, and `docs/README.md`. The public
  site's pages that cite these stay true, because the `https://` path is unchanged. The public guide
  to running a relay is phase 5's.

### Decisions and deviations

- **One WebSocket per stream, no multiplexer.** The relay asks the Node over its control connection
  to open a connection for each stream, and holds the client's upgrade until the Node's end arrives.
  TCP gives each stream flow control, so no window logic exists, and a refused stream is an HTTP
  status. The cost is one more connection per stream, which a kept-alive broker opens rarely.
- **Route = Node ID** in self-hosted mode. A newer registration takes a route and closes the older
  with code 4000, and that Node stops dialing, so two Nodes on one route don't fight.
- **The client credential travels in the address** and is kept in the fleet file beside the pin, not
  in the encrypted token store. It reaches the relay, not the Node. Phase 2 replaces it with tickets.
- **Fixed two things outside the relay that its checkpoints exposed:**
  - The broker reported a substituted Node (another self-signed certificate, which fails the chain
    check before the fingerprint check) as plain `offline`. It now reports `identity_mismatch` for
    chain failures against the pin, for direct connections too (`isPinMismatch` in `nodeBroker.ts`).
  - After a Node went offline and came back, the agent transcript's reconnect read was refused as
    `node_offline`, because `wsClient` announced the reconnect before the fleet store heard `online`.
    Text streamed during the outage stayed missing until a reload. `wsClient` now announces a
    microtask later. This hit any dropped connection, relayed or not.
- **Not in `GET /v1/node`.** Relay state isn't reported there: that response's own rule asks for a real
  consumer, and phase 1 has none. Phase 2's **Remote access** setting is the consumer.
- **No relay-specific error code.** A refused or missing relay stream reads as `offline` with
  `unreachable`. Probe and pairing errors name the cause in words.
- The terminal client's Settings → Nodes page is desktop-only by design, so the terminal client pairs
  a relayed Node with `acorn --node <relay address>`.
- `@acorn/protocol`'s entrypoint budget in `tools/arch/boundaries.test.ts` went from 95 to 96, with
  its reason.

### Size budgets

- Node service static graph: 1,937,025 bytes on the base commit, 1,938,514 with this phase, so +1,489
  bytes, under the 1,939,000 ceiling. The tunnel (1,646 bytes) is a lazy chunk. Ceiling unchanged.
- Terminal client startup graph: +3,364 bytes (785,816 to 789,180). It's over its 770,000 ceiling on
  the base commit already, which also makes `pnpm pack:node` fail. Ceiling unchanged.

### For later phases

- **Phase 2.** Tickets and Node credentials ride the same `Authorization: Bearer` header. The relay's
  check is `authorized()` in `apps/relay/src/relay.ts`. `BrokerNode.relayCredential` is a string; a
  ticket that refreshes wants a getter there and in `pinnedPost`. Add relay state to `GET /v1/node`
  and a relay-specific status reason when the **Remote access** setting needs them.
- **Phase 4.** The `browser` stream kind is reserved. A Node refuses kinds it doesn't serve with a
  `refuse` message, so old Nodes answer a phone with 502 at once. A browser can't set
  `Authorization`, so phase 4 adds a second credential carrier, additively.
- **Phase 5.** The relay counts nothing yet. Limits are constants in `relay.ts`.
- **Found red on the base commit, not fixed here:** `pnpm pack:node` (terminal client startup budget,
  and an undeclared `ci-info` import from the agent-built app card's chunk); the plain tarball leaves
  node-pty's `spawn-helper` without its execute bit, which only the `--platform` archive sets; and
  `@acorn/arch-tests` fails on links to `docs/future/perf`, `dynamic-ui`, and `marketing` pages that
  main removed.
- A Node restart interrupts a running turn, with or without a relay. Checkpoint 7 expects the agent to
  finish either way, which holds for a relay restart only.

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

Answers, October 22, 2026:

1. **WebSocket, one per stream, with no multiplexer.** A browser can open one, it passes HTTP proxies,
   and both ends already run `ws`. HTTP/2 isn't open to browser code, and QUIC isn't everywhere yet.
2. **TypeScript.** Locally the relay costs about 0.15 ms a frame and 18 percent of download
   throughput (evidence below). Revisit Go only if a regional measurement in phase 5 says so.
3. **Deferred to phase 5,** which measures in each region. Locally the relay adds 0.15 ms to a
   keystroke's round trip, so the network path to the relay sets the number. A working target: the
   relay adds less than 1 ms beyond that path.
4. **By path.** `/v1/` changes only by addition: unknown message types and fields are ignored, and a
   Node refuses a stream kind it doesn't serve. A breaking change uses `/v2/`, and a relay serves
   every version still in use (`apps/relay/PROTOCOL.md` § Versioning).
5. **Both.** `ACORN_RELAY_URL` and `ACORN_RELAY_CREDENTIAL` win over `relay` in `node.json`, as a
   pair, the same precedence as `advertiseHost`. Agents don't see the variables, because a child's
   environment is an allowlist.

## Evidence

All on October 22, 2026, on one Mac (Apple silicon, macOS), Node.js 26.8.1.

### How the checkpoints ran

There's no second machine, so each "second machine" ran here with its own client config and data
folder, and reached the Node only through a locally run relay. The relay listened on
`ws://127.0.0.1:18443` (`pnpm --filter @acorn/relay start`). The Node dialed it through a recording TCP
proxy on port 18444, which is where the ciphertext check reads. The Node was a **packed** Node:
`pnpm pack:node` is red on the base commit (see the completion note), so a temporary copy of the
packer skipped the terminal client's two failing checks, and the tarball was unpacked into `/tmp` with
`npm ci --omit=dev`. It had no advertised host. Clients: a `pnpm dev:agent` desktop session, the packed
`acorn` CLI and terminal client with `ACORN_TUI_CONFIG_DIR` and `ACORN_DATA_DIR` in `/tmp`, and a
`pnpm dev:extension` Chrome session. Automated equivalents: `apps/relay/src/endToEnd.test.ts`,
`apps/relay/src/relay.test.ts`, and the step 0 test.

| Checkpoint | Result | How |
| --- | --- | --- |
| 1. One Node through a local relay | Pass | Desktop **Add a node** took the relay address, showed "eagle bolt gemstone flask atlas echo", the banner's words, and paired with the banner's code. The Node shows **Live** with its relay address. |
| 2. The relay sees only ciphertext | Pass | 4.2 MB recorded on the Node's relay leg across terminal use, two plugin downloads, and five agent turns. No device token, request path, response body, or `HTTP/1.1 200`. The only plaintext is the relay protocol's own `ws://` upgrades, which carry the relay credential, as `docs/relay.md` warns. |
| 3. Pinning still bites | Pass | With the Node stopped, a second packed Node whose `node.json` claimed the same Node ID took the route. `acorn --node` exited 3 with `identity_mismatch`, and the desktop showed **Identity changed**. |
| 4. Everything above TLS works | Pass | Through the relay: a terminal echoed `relayed-42`, a Codex turn streamed, and the **API** pane rendered. A plugin client bundle downloaded through the relay in the measurement below. |
| 5. Loopback trust doesn't leak | Pass | Through the relay with the CLI's device token, the three routes answered 403 `pairing_local_only`, `reach_local_only`, and `stop_local_only`. |
| 6. Four clients, one relayed Node | Pass, one machine | Desktop, terminal client (`acorn --node ws://…`), CLI (`acorn --node … workspace list`), and extension each paired with a code through the relay and read the Node's project and task. Not run from another network. |
| 7. Restarts | Pass after a fix, with one exception | Relay restarted mid-turn: the agent finished, and before the `wsClient` fix the desktop kept a gap of the text streamed during the outage until a reload (seen twice). After the fix, two runs showed all 200 lines with none repeated. Node restarted (SIGTERM, then started again): clients came back on their own. A Node restarted mid-turn marks the turn interrupted, and the desktop showed the same 66 lines the Node stored. No approval was pending in these turns, so duplicate approvals weren't exercised. |
| 8. No settings, no connection | Pass | The packed Node started with no relay settings held one socket, its loopback listener, over 35 seconds (`lsof`), and logged nothing from the relay. `listener.test.ts` checks a Node with no settings never loads the tunnel and refuses the relay `Host`. |

No step in this phase is titled **Hosted service: staging**, and no checkpoint needs staging, a domain,
or a product name, so none was skipped for that reason.

### Measurements

Same machine, loopback, the TypeScript relay, with the recording proxy on the Node's leg. Direct is the
same Node on `https://127.0.0.1`. 300 sequential round trips on a warm pooled connection, 30 new
connections, and 20 downloads of the largest plugin client bundle (148 KiB).

| Measure | Direct | Through the relay |
| --- | --- | --- |
| Small request (`GET /v1/node`), median and p95 | 0.19 ms, 0.31 ms | 0.37 ms, 0.54 ms |
| WebSocket ping on the event socket, a keystroke's transport cost | 0.06 ms, 0.07 ms | 0.21 ms, 0.26 ms |
| New connection, including TLS | 1.56 ms, 1.99 ms | 3.11 ms, 3.50 ms |
| Bundle download | 38.9 MiB/s | 32.0 MiB/s |

Regional numbers wait for a hosted relay in phase 5.

## Verify before building

Check that the broker can take a custom socket without losing its pinning override. Check that the
WebSocket upgrade and the `Host` check work for a socket that entered the HTTPS server through
`emit('connection')`.
