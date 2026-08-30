# The process model: what `acorn` does when you run it

## One command

`acorn` with no arguments opens the workspace for the node whose data root this machine uses. It
attaches if that node is running and starts it if not. `acorn --node <endpoint>` opens the workspace
for a node elsewhere, pairing first if this device has never met it. Everything else is a flag on one
of those two.

## Attach or start

The node takes an exclusive lock on its data root at boot (`openDataRoot`,
`apps/node/src/entries/standalone.ts`). That lock is the fact `acorn` reads:

1. Resolve the data root: `ACORN_DATA_DIR`, else the desktop app's data root if the app is installed
   here, else the dev root. The rule is the node's own, and `acorn` calls the same function rather than
   restating it.
2. If the root is locked, a node is running. Read its endpoint and fingerprint from the data root's
   recorded state, authenticate with the device token this TUI holds for it, and attach. If the TUI has
   no token yet for a node that is already running, it asks the running node for one the way the
   desktop helper does when it adopts a node it did not start. If no such route exists, the TUI says
   so and offers to pair with the local node using the banner the node printed at boot.
3. If the root is not locked, start the node: spawn `standalone.js` under the bundled Node runtime,
   read the one JSON handshake line (`nodeId`, `endpoint`, `fingerprint`, `certPem`, `deviceToken`),
   keep the child for the life of the TUI, and shut it down with the same bounded drain the desktop
   helper uses when the TUI exits. `ACORN_DEVICE_TOKEN` is set from the TUI's stored token so
   `resolveDeviceToken` reuses it rather than minting a new device row per launch.

A second `acorn` in a second terminal finds the lock and attaches. The node lives as long as the
first TUI that started it, which is the desktop's behaviour too: the app that started the node owns
its lifetime. A TUI that attached to a node it did not start leaves it running on exit.

The supervise-a-child code is the desktop helper's (`packages/desktop-helper/src/main/`), and the
helper has no shell binding by design (`packages/desktop-helper/src/index.ts`). The TUI imports
it as a library. It does not speak the helper's wire protocol (`apps/desktop/src/shell/wire.ts`),
because there is no second process to speak it to.

## Shell and broker in one process

On the desktop the renderer never holds a token. The helper brokers every request over pinned HTTPS
with a device bearer, and the bearer rides the WebSocket upgrade header, which a browser cannot set
(`packages/desktop-helper/src/broker/nodeBroker.ts`). That split is why the helper is a separate
process.

A terminal is one process, and it runs under Node, so it can set the upgrade header itself. The
broker (`NodeBroker`), the fleet store, and the device token store are imported directly and run in
the TUI's own process. "The renderer never sees the token" stops being a structural fact and becomes a
module boundary: the token lives in the broker's module and the kit components never receive it. That
is the same discipline `packages/client-core/src/host/plugins/host.ts` already keeps for `pluginCustody()`, and
[06-isolation.md](./06-isolation.md) says what it means for the trust model.

What this buys: the TUI can pin the node's certificate by fingerprint and authenticate the WebSocket
natively. It is easier than the web client, which needs a second auth carrier, and equal to the
desktop.

## Booting client-core under Node

The client shell reads the host through one seam, `packages/client-core/src/infra/platform/`, which reads a
global (`window.acorn`) that the desktop's initialization script sets. Nothing outside that folder may
read the global (`tools/arch/boundaries.test.ts`, the platform-seam rule). A Node process sets
`globalThis.acorn` before importing client-core, and the seam's own check is `typeof window`, which
passes. No change to the seam or the rule.

The groups the TUI provides, and with what:

| Group | Provided by | Notes |
| --- | --- | --- |
| `transport` | `NodeBroker` in-process | `fetch`, `abort`, `send`, `onFrame`, `onStatus`. Responses stay buffered `Uint8Array`, because that is `ApiResponse`'s shape; the TUI is free to stream later, the type is per-implementation. |
| `fleet` | `FleetStore` in-process | `list`, `probe`, `pair`, `adopt`, `forget`, `reconnect`. `restartLocal` restarts the child the TUI supervises, or refuses if it attached. Tunnels are out of scope for phase 3. |
| `pairing` | yes | probe-only capability. |
| `plugins` | file-backed custody | [06-isolation.md](./06-isolation.md). Null until phase 5, which hides loaded plugins rather than half-loading them. |
| `recovery` | yes | `openDataFolder` prints the path; `quit` exits. |
| `desktop`, `desktopExtras`, `folderPicker`, `preview`, `webviews` | null | Absent by design. The affordances they gate disappear, which the seam already supports as a product state. A folder picker is a text field in a terminal and phase 4 draws one where a pane needs it. |

Two browser assumptions sit on the boot path and both are one file each: the per-node query caches
persist through `idb-keyval` (`packages/client-core/src/infra/node/fleet.ts`), and appearance boot writes
`document.documentElement.dataset` (`packages/client-core/src/infra/persistence/appStartup.ts`). Phase 0
puts a file persister behind the first and a host check in front of the second. Everything else on
the path is guarded (`localStorage`, `window`) or lazy behind a pane (Monaco, xterm, the highlighter
worker).

## Remote nodes

`acorn --node https://host:4317` runs the desktop's three steps in the terminal
(`packages/desktop-helper/src/broker/nodePairing.ts`): an unverified probe of `GET /v2/node` that
cross-checks the socket's fingerprint against the body's; the six words printed for the person to
compare against what the node printed at its own boot; `POST /v2/pair` over a pinned agent with the
code. The TUI stores the resulting device token beside its config, keyed by node id, and pins the
fingerprint. A revoked token (`401`/`403` on the upgrade) stops reconnecting and says so in the
footer, the same `revoked` state the broker already models.

`acorn` remembers nodes it has paired, so the second time is `acorn --node <name>`. The list is the
fleet store's; there is no second one.

## Where the TUI keeps things

`$XDG_CONFIG_HOME/acorn/` (or the platform's equivalent), holding the fleet store, device tokens,
the plugin cache and acknowledgement file from phase 5, and the device config file that
`docs/future/client-plugins/phase-4-device-config.md` designs for exactly this host. Nothing in the
node's data root belongs to the TUI, and nothing in the TUI's directory is read by the node.

## Signals and exit

`Ctrl+C` at the shell prompt is the TUI's, not the PTY's; inside a focused PTY rectangle keys belong to
the PTY until Escape, per the Rectangle contract (`packages/client-core/src/kit/components/content/Rectangle.tsx`).
`SIGTERM` to the TUI drains the child it started. `SIGWINCH` re-lays out; nothing in a layout reads the
terminal width, so the resize is the renderer's alone.

The pairing window on the node reopens with `SIGUSR1` today, which does not exist on Windows
(`docs/future/bundle.md § The snags`). A TUI attached to the local node is an out-of-band channel of
its own and can offer "open a pairing window" as a command. Noted, not designed; phase 3 leaves it in
doors left open.
