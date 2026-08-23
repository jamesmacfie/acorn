# Shell architecture

Status: historical. Proposed 2026-08-22, built in phases 2 and 3, 2026-08-23.
[docs/shell.md](../../shell.md) owns shipped behaviour. The organizing principle: the renderer seam
(`packages/client-core/src/platform/index.ts`) and the service protocol
(`packages/protocol/src/serviceProtocol.ts`) are the two contracts that must not change; everything
between them is replaceable.

## Process model

```
Tauri shell (Rust)
  └─ desktop helper (bundled Node)          ← broker, custody, supervision — the moved TS
       └─ node service (service.js, fd-3 IPC, unchanged)
```

The Rust shell owns the window, the two custom protocols, the menu and lifecycle, native dialogs,
the OS keychain, and helper supervision. The helper owns everything Electron main owned that was
already Electron-free TypeScript. Phase 1 gathered those eleven files behind one composition root;
phase 2 moved them to `packages/desktop-helper`, which both shells now import: `nodeBroker.ts`,
`nodeRequest.ts`, `nodePairing.ts`, `fleetStore.ts`, `deviceTokenStore.ts`, `pluginCache.ts`,
`pluginTrustStore.ts`, `bundledPluginTrust.ts`, `previewTunnel.ts`, `serviceHost.ts`,
`crashBudget.ts`, and the plugin request schemas in `pluginRequests.ts`. The node service is
untouched, and `serviceHost.ts` did not change at all: `ELECTRON_RUN_AS_NODE` is inert under a real
Node, so both shells spawn the service with the same line.

## Why a Node helper, not a Rust broker

The broker stack is roughly 2,000 lines of tested, security-sensitive TypeScript: per-fingerprint
certificate pinning, reconnect backoff, watchdog and sequence-gap semantics, stream routing, and
the tunnel's `timingSafeEqual` auth. That is exactly the code where a rewrite regresses silently,
and the team is TypeScript-native. The helper also keeps the service protocol intact: it is a real
Node process, so `serviceHost.ts` spawns `service.js` with the `'ipc'` stdio entry and
`process.send` exactly as today — the only diff is deleting `ELECTRON_RUN_AS_NODE`. A Rust broker
would force either a Rust reimplementation of the RPC peer or a protocol transport change.

Rejected alternatives:

- **Rewrite the broker in Rust.** Rewrites the subtlest tested code in the app in a language the
  team does not write, and forces the service-protocol change above. Take Rust on where it is
  unavoidable — window, protocols, keychain, supervision — not where working TS exists.
- **Broker in the renderer via `tauri-plugin-http`.** Breaks renderer-never-holds-tokens outright:
  fleet tokens and certificate pins move into the process that renders third-party content, the
  exact downgrade [remote.md](../remote.md) names as the web client's unavoidable cost, adopted
  voluntarily on desktop. Also mechanically short: no per-connection fingerprint verifier from JS,
  no pinned WebSocket.
- **Rust holds custody, TS calls per request.** Puts a bearer token on an internal wire on every
  request. The adopted design is the sensible hybrid: Rust holds the one key, TS holds the logic.

The accepted cost: one more long-lived process (tens of MB), and the renderer gains loopback
network access to exactly one port, pinned in CSP below.

## The renderer ↔ helper contract

The helper binds an ephemeral port on `127.0.0.1`, generates a 32-byte secret, and reports
`{port, secret, ready}` on stdout to Rust — the same handshake-line pattern as the standalone node,
never env or argv. Rust hands `{port, secret}` to the renderer through one capability-scoped Tauri
command, `helper_endpoint()`.

One WebSocket carries the whole former preload surface, and nothing else does: the listener answers
a plain HTTP request with 426 and exists only to be upgraded. The wire messages are the existing Zod
schemas that `nodeBrokerIpc.ts` and `pluginIpc.ts` validate; those two files were the spec for
`apps/desktop/src/shell/helperServer.ts`, a transliteration from `ipcMain` handlers to WebSocket
frames that keeps the "renderer messages are Zod-parsed" posture verbatim. The upgrade requires the
secret and an `Origin` check against the app origin; the secret is the real gate, because any local
process can claim any origin it likes. `nodeFetch` keeps buffering whole responses, which the seam
already documents as a per-implementation limitation.

Every call is request-reply, including the ones the seam types as void, and bodies ride as base64
because the channel is JSON. The design allowed for loopback HTTP beside the socket for exactly those
bodies; it is not there, because one channel needs no CORS header, no preflight on every JSON write,
and no second auth gate, and because `abort(requestId)` is already in the seam. The ceiling is in
`src/shared/wire.ts`: base64 costs a third more bytes and one copy each way, which stops being
negligible somewhere in the tens of megabytes, and the upgrade is an id-tagged binary frame beside
the JSON reply rather than a second transport.

The renderer-side bridge is `apps/desktop/src/shell/bridge.ts`: it assembles the
preload-shaped object over the helper socket plus Tauri commands and events, and the shell injects it
as a webview initialization script, which is what a preload is. Injecting it rather than importing it
from the renderer entry is what keeps `apps/desktop/src/app/client/index.tsx` shell-agnostic.
`packages/client-core/src/platform/index.ts` needed zero changes.
`tools/arch/boundaries.test.ts` gained one rule, the mirror of the Electron one: nothing outside
`apps/desktop` may name a Tauri binding.

One value cannot wait for a round trip. The seam reads `hostPlatform()` synchronously, so the
initialization script sets `__ACORN_PLATFORM__` ahead of the bridge itself.

## Boot order

1. Rust: single-instance lock (`tauri-plugin-single-instance`; the data root's exclusive lock in
   the node remains the real mutual exclusion) → resolve data dir → get-or-create the data key from
   the keychain → spawn the helper, writing `{dataKey, dataDir, resourcesDir, bundledPluginsDir}`
   as one JSON line to its stdin.
2. Helper: load `fleet.json`, register the broker, start the local node via `serviceHost` adopting
   the remembered device token, begin reconnecting remembered nodes, open the loopback listener,
   print the ready line. This preserves today's guarantee that the broker is warm before the
   renderer exists.
3. Rust: register the `app://` handler with the CSP templated on the helper's actual port, then
   create the window.
4. Renderer: `helper_endpoint()` → WS connect → platform seam live → first act is the fleet list,
   answered from the already-warm broker.

Node-service crashes stay inside the helper's existing `crashBudget`. When the budget is spent the
helper writes one tagged line to stdout and Rust shows the recovery dialog, because the shell that
would render it is behind the very gate it is about to show. The gate's two actions are Tauri
commands, `reveal_data_folder` and `force_quit`, for the same reason.

Restarting a crashed helper under a generation-counted observer with bounded backoff, the pattern in
`references/proliferate/apps/desktop/src-tauri/src/sidecar.rs`, is not built. Phase 2 supervises one
helper: a boot that never reaches ready is a native error dialog and a non-zero exit, the same
all-or-nothing boot Electron has. The `$SHELL -l -i -c 'echo $PATH'` fix for Finder-launched apps
belongs with packaging, in phase 4.

Two supervision requirements came out of phase 0 and are load-bearing
([node-runtime.md](./node-runtime.md) has the run). Rust spawns the helper in its own process group
and kills the group, never the single process: killing the helper alone leaves the node holding the
data root's lock, and the replacement helper's node cannot start. And the helper installs its stdin
command handler before it starts the node, queueing whatever arrives early, because a quit can reach
it mid-boot.

## The one CSP change

The renderer CSP's `connect-src` widens from `'self'` to `'self'` plus the helper's exact loopback
WebSocket origin, `ws://127.0.0.1:<port>`, templated into the header at runtime by the Rust scheme
handler. No `http://` on that port, because the helper serves no HTTP. No wildcard port: the handler
is ours and knows the port, so no third loopback service becomes reachable.

It also names `ipc:` and `http://ipc.localhost`, which are Tauri's own IPC channel rather than a
network origin. Leaving them out does not break `invoke`; it silently drops it to a slower
postMessage path, which is what makes the omission easy to ship. The capability file is what says
which commands that channel reaches. This is the honest cost of the helper decision and is a
proposed change against [docs/shell.md](../../shell.md), where `connect-src 'self'` is the
load-bearing directive. Everything else that directive protected still holds: the renderer still
cannot reach a node directly, because nodes require the pinned agent and bearer that only the
helper holds.

Phase 0 checked both halves of this, since a directive that cannot be widened would take the helper
design with it ([webviews-and-frames.md](./webviews-and-frames.md) records the run). Under
`connect-src 'self'` a fetch to the loopback port failed and a `WebSocket` to it threw
`SecurityError: The operation is insecure`. With the port named in the directive, the same
`WebSocket` was allowed to open and the same fetch returned 200. One detail carried into `helperServer.ts`: a loopback `ws://` is reachable from the custom-scheme
origin even though that origin is a secure context. The other, that a loopback fetch also needs an
`Access-Control-Allow-Origin` header, stopped mattering when the wire became WebSocket-only.

## Keys and custody

One 32-byte data key lives in the OS keychain via the `keyring` crate, held by Rust and injected
into the helper over the stdin handshake, where it encrypts device tokens with AES-256-GCM. It arrives at the token store as the `TokenCipher` phase 1
introduced, which is where Electron passes `safeStorage` today. Token blobs stay mode-0600 files on disk, AES-GCM
encrypted by the helper. On a machine with no keychain the key falls back to a 0600 file — the same
fail-quiet stance `deviceTokenStore.ts` has today, and the same blast radius as the node's own
`session.key`, a precedent [docs/node-distribution.md](../../node-distribution.md) already accepts.

`sessionKeyStore.ts` is deleted: the desktop-supervised node uses the generated
`session.key`-in-data-root the standalone node already uses. One custody mechanism fewer.

Migration, built in phase 3 as `packages/desktop-helper/src/main/legacyCustody.ts`: Electron's
`safeStorage` is Chromium os_crypt, and on macOS a keychain item named "acorn Safe Storage" derives an
AES-128-CBC key. Rust reads that item and passes it in the handshake; the helper decrypts each
`device-token-*` blob and re-encrypts it under the data key.

It copies the whole custody root rather than only the tokens, which the design did not say and should
have. The two shells cannot share a root — Electron's is named after the app and Tauri's after the
bundle identifier — so a device token arriving without the `fleet.json` row that names its node is a
secret for a machine nobody remembers. `fleet.json`, `plugin-trust.json` and the content-addressed
plugin cache come across with it. Nothing is deleted from the Electron root: it is still a shipping
app until cutover.

The guard is the whole lifecycle. A `fleet.json` in the new root means the owner has used this build,
and their fleet wins, so the adoption runs at most once with no marker file and no ledger. If the key
no longer opens the blobs, which is what a rebuilt or re-signed Electron app leaves behind, the fleet
still comes across and the tokens do not: the local node mints a fresh device row, paired remote nodes
need re-pairing, and the fleet UI says so honestly.

A caveat to document loudly: keychain item ACLs bind to the code signature, so while acorn ships
ad-hoc signed, every rebuild re-prompts or loses access, and the file fallback is the common path
on macOS until Developer ID signing exists. A dev build therefore does not ask the keychain at all.
Phase 2 found out why the hard way: after a `cargo build`, launching put a modal password prompt in
front of the app, and answering it granted nothing that survived the next rebuild.

Rejected: stronghold (a database and runtime for a problem one keychain entry solves), per-token
keychain items (a prompt per node and ACL churn), tokens inside `fleet.json` (rejected in
[docs/shell.md](../../shell.md) already).

## Window, lifecycle, and platform bits

- **Quit negotiation** keeps the `will-quit`/`quit-response` seam. The Rust side uses a custom Quit
  menu item — never `PredefinedMenuItem::quit()`, which routes through `[NSApp terminate:]` and
  bypasses the event loop, a trap proliferate's `quit_flow.rs` documents — plus
  `RunEvent::ExitRequested` with `prevent_exit()`. Rust emits a will-quit event, the renderer
  collects concerns and invokes `quit_approved`, Rust tells the helper to stop, the helper runs
  today's ordered drain with the 30-second deadline, then Rust exits. `force-quit` skips the
  renderer round-trip, as the recovery gate requires.
- **Cmd+W pane interception**: `before-input-event` has no Tauri equivalent. A "Close Pane" menu
  item with the `CmdOrCtrl+W` accelerator emits an event the bridge maps to the existing close-pane
  seam callback. On Windows and Linux a renderer keydown handler covers it.
- **Dialogs**: `tauri-plugin-dialog` behind a `pick_folder` command feeding the `FolderPicker` seam
  group. `plugins/terminal/src/main/folderPickerIpc.ts` — the module whose lazy Electron require
  exists to keep the main barrel bootable — is replaced by the seam call.
- **External URLs**: one Rust command `open_external(url)` enforces the scheme allowlist that
  `setWindowOpenHandler` plus `shell.openExternal` enforce today; the opener plugin capability is
  granted only to that command, never to the renderer directly.
- **Navigation**: `on_navigation` pins the window to the app origin plus `app-plugin:`, which is the
  main-frame policy and the subframe guard in one callback, since it fires for both. No OAuth
  exception is needed: GitHub connects by device flow against the node, unchanged.
- **Capabilities are scoped by webview label, never by window.** A capability that names a window
  grants every webview inside it, and since phase 3 the main window hosts the preview pane and plugin
  webview surfaces. Those get no capability at all, so `invoke` reaches nothing from them. A Rust test
  reads `capabilities/default.json` back and fails if `windows` returns.

## The resulting Rust surface

| Module | Owns |
| --- | --- |
| `lib.rs` | Builder; plugins (single-instance, dialog, opener, os); state; command registry. |
| `helper.rs` | Helper spawn, stdin handshake, ready line, health, generation-counted restart. |
| `keychain.rs` | Data key get-or-create, `keyring` plus the 0600-file fallback. |
| `app_scheme.rs` | Shell protocol: traversal guard, SPA fallback, per-response CSP. |
| `plugin_scheme.rs` | Per-hash static serving from the helper-written cache, frame CSP, no-store. |
| `keychain.rs` | Also reads the legacy `safeStorage` item, for the one-time custody adoption below. |
| `menu.rs` | The application menu, quit negotiation, Cmd+W and Cmd+Q accelerators. |
| `commands.rs` | `helper_endpoint`, `pick_folder`, `reveal_data_folder`, `force_quit`, `quit_approved`, and the shell state they read. |
| `webviews.rs` | Child-webview lifecycle, bounds, nav guards, URL policy, tunnel-cookie seeding. Preview panes and plugin surfaces both, keyed by prefix. |
| `updater_owned.rs` | Post-signing: staged, verified updates. |

Quit negotiation lives in `menu.rs` beside the accelerator that triggers it rather than in its own
`quit_flow.rs`, because they are one mechanism: the menu item is custom precisely so the negotiation
can run. `open_external` is not there either. Nothing in the renderer asks for it; the navigation
guard on the window is what handles a link off the app origin, and a command the renderer can call is
a wider surface than a policy it cannot.

Everything else stays TypeScript: the helper (`packages/desktop-helper`, whose `main/index.ts` is the
composition root, plus `helperServer.ts` and the `helperMain.ts` that adds the stdin handshake and the
loopback listener), the renderer bridge, and the node.
