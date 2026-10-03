# Terminal client process

This page covers how `acorn` finds or starts a Node, where it keeps its files, how it exits, and why
the broker runs in the same process. Read it before you change the launcher or the client's storage.
It's part of [the terminal client](../tui.md).

## The runtime floor

The terminal client runs on the repository's Node range. `node-runtime.json` holds the pin and the
range, and `apps/tui/package.json` declares the same range in `engines`. The painter is this
package's own TypeScript and Yoga is WebAssembly, so drawing needs no native library and no flag.

The supported branches are Node 22 at 22.23.2 or later, Node 24 at 24.18.1 or later, and Node 26 at
26.5.1 or later. The bundled runtime is 24.21.0. Before it looks up a loaded client bundle or creates
its worker, the client checks the shared policy in `packages/protocol/src/runtime/nodeRuntime.ts`. An
unsupported runtime refuses to run loaded plugins with an upgrade message, even if the install
ignored the `engines` warning. The whole suite runs on that Node, with no skips
([test layers](../testing/layers.md#terminal-client)).

## Attach or start

`acorn` with no arguments opens the workspace for the Node whose data root this machine uses. It
attaches to a running Node or starts one. It decides by the exclusive lock a Node takes on its data
root at boot:

1. Resolve the data root (`apps/tui/src/node/paths.ts`): `ACORN_DATA_DIR`, else the desktop app's
   root if the app is installed, else the development checkout's.
2. If the root is locked, a Node is running. Read its endpoint from `node.json` and the certificate
   to pin from `tls/cert.pem`, authenticate with this client's device token, and attach.
3. If the root isn't locked, spawn `standalone.js`, read its one JSON handshake line (`nodeId`,
   `endpoint`, `fingerprint`, `certPem`, `deviceToken`), and keep the child for the client's
   lifetime.

The renderer doesn't wait for step 3. `openNode` returns as soon as the child spawns and hands back
the handshake as a promise, because a Node's boot has a 120-second budget. The Node's ID is already in
`node.json`, minted once per root, so the client can name its query cache partition and draw before
the child binds a port. The footer says `starting the node…` until the handshake lands, and the first
online state refreshes whatever the shell asked for in the meantime
([caching](../caching.md) § Renderer query cache).

A prepared data root can have `node.json` before this client has saved a fleet row, as the test
fixture does. The shell keeps that Node ID while the handshake is in flight, then selects it in the
completed fleet and refreshes active queries.

Two cases still wait, because there's nothing to draw: a first start has no `node.json`, and pairing
asks a question on stdin.

A started child's stdout is read until the handshake and drained after. Its stderr is piped and held,
because the renderer draws on the same terminal. The held lines print after `renderer.destroy()`.

`apps/tui/src/node/open.ts` holds the decision, and `apps/tui/src/node/supervise.ts` owns a started
child: SIGTERM, then SIGKILL after five seconds. It isn't the desktop helper's supervisor, because a
standalone Node prints one line and speaks no service RPC.

A second `acorn` finds the lock, attaches, and leaves the Node running when it quits. The one that
started the Node owns its lifetime, as on the desktop.

Attaching needs a device token, and a Node the desktop started holds the desktop's token. So the first
`acorn` against it asks for a pairing code. For a desktop-supervised Node, open **Settings → Nodes →
Pair another client** in the desktop. For a standalone Node, run `kill -USR1 <pid>` and read the code
from its terminal. The client then pairs over loopback.

The selected cache partition joins the shared query-cache lifecycle after file storage is installed.
The restore finishes before the shell draws, and quitting releases the lease and writes the pending
snapshot. [Caching](../caching.md#renderer-query-cache) owns that lifecycle.

## Remote nodes

`acorn --node https://host:4317` runs the desktop's three pairing steps in a terminal
(`packages/custody/src/broker/nodePairing.ts`): an unverified `GET /v1/node` probe that checks the
socket's fingerprint against the body's, the six identity words printed for you to compare with what
the Node printed at boot, and `POST /v1/pair` with the code over a pinned connection. Both run before
the renderer starts.

`acorn` remembers what it pairs with, so the next time is `acorn --node <name>`. The list is the fleet
store's. A revoked token shows as `revoked` in the footer and stops reconnecting.

## Where the TUI keeps things

The config directory belongs to the client. It holds the fleet store, the device tokens at mode
`0600`, and the persisted query cache (`apps/tui/src/node/cache.ts`, behind `setCacheStorage`, where
the desktop uses IndexedDB). `ACORN_TUI_CONFIG_DIR` overrides it, which keeps the boot test out of
your config. The data root belongs to the Node, and nothing in `apps/tui` writes to it.

`cache/` holds one file per Node, named by the partition key with its colon percent-encoded, at
`0600` in a `0700` directory. A write goes to `<key>.json.tmp` and is renamed over the target, so a
crash leaves the previous snapshot readable. The one read is synchronous, before the renderer exists.
Writes are asynchronous.

When the selected Node comes back, the client refreshes active queries, then refetches failed
inactive ones, because an error boundary may have unmounted their observer. Then failed pane and
region boundaries remount. A persistent error keeps its message and a **Retry** control.

An empty project list opens **Set up acorn** once the Node's list loads. It picks or creates a
workspace, adds a project from an absolute path on that Node, and creates a task. `Ctrl+K` keeps **Set
up acorn** and **New task** reachable. The provider step lists connections, takes credentials with
masked fields, and starts device authorization where a provider offers it.

The device token is plain bytes at `0600`. The desktop encrypts it with the platform keychain through
a `TokenCipher`, and this client passes it through, as the Node does with its own TLS key. On NTFS the
mode is advisory ([future/bundle.md](../future/bundle.md) § The snags).

`acorn.json` in the config directory holds device appearance, shortcuts, rail order, and selected
exclusive providers. The client reads it at startup and watches it. Valid fields go through the same
device preference setters as Settings, and a parse error keeps the last valid values. Plugin entries
appear as install offers in the Plugins palette and never grant trust. Unknown keys survive Settings
writes. The schema is `packages/plugin-types/acorn-device.schema.json`.

## Signals and exit

`Ctrl+C` belongs to the client outside a PTY and to the PTY inside one
([traps and rectangles](./traps.md#the-rectangle-contract)). `SIGTERM` drains a child this `acorn`
started. `SIGWINCH` lays the screen out again, and only the renderer reads the terminal size. `q`
quits, and asks first when this client started the Node.

## Shell and broker in one process

On the desktop the renderer never holds a token. The helper brokers every request over pinned HTTPS
with a device bearer, and sets the bearer on the WebSocket upgrade, which a browser can't. The
terminal client is one Node process, so it sets the header itself. `NodeBroker`, the fleet store, and
the device-token store run in the client's own process (`apps/tui/src/platform.ts`). The token lives
in the broker's module, and an architecture rule refuses an import of custody from anything in
`apps/tui` that draws a cell. For the trust consequences, see [security](../security.md) §§ Trust
boundaries and Transport and auth.

## Shipping it

`pnpm pack:node` builds the standalone tarball, which holds the Node, the headless CLI, and the
terminal client under one `acorn` launcher ([standalone Node distribution](../node-distribution.md)).
Embedding `acorn` in the desktop bundle and platform release artifacts aren't built
([future/bundle.md](../future/bundle.md)).
