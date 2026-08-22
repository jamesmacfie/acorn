# Shell architecture

Status: proposal, 2026-08-22; phase 1's regroup landed 2026-08-23. The organizing principle: the renderer seam
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
already Electron-free TypeScript. Phase 1 gathered those eleven files into
`apps/desktop/src/app/main/helper/` behind `helper/index.ts`, with an arch rule holding Electron out,
so the move is a directory relocation: `nodeBroker.ts`, `nodeRequest.ts`, `nodePairing.ts`,
`fleetStore.ts`, `deviceTokenStore.ts`, `pluginCache.ts`, `pluginTrustStore.ts`,
`bundledPluginTrust.ts`, `previewTunnel.ts`, `serviceHost.ts`, and `crashBudget.ts`. The node service
is untouched.

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

One WebSocket carries the whole former preload surface. The wire messages are the existing Zod
schemas that `nodeBrokerIpc.ts` and `pluginIpc.ts` validate today; those two files become the spec
for a new `helperServer.ts`, a transliteration from `ipcMain` handlers to WS frames that keeps the
"renderer messages are Zod-parsed" posture verbatim. The upgrade requires the secret and an
`Origin` check against the app origin; the secret is the real gate. `nodeFetch` keeps buffering
whole responses, which the seam already documents as a per-implementation limitation.

The renderer-side bridge is a thin boot script in the Tauri app package that assembles the
preload-shaped object over the helper WS plus Tauri commands and events, and assigns the host
global before the shell mounts. `packages/client-core/src/platform/index.ts` and
`tools/arch/boundaries.test.ts` need zero changes.

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

Helper crashes restart under a generation-counted observer with bounded backoff, the pattern in
`references/proliferate/apps/desktop/src-tauri/src/sidecar.rs` (including its
`$SHELL -l -i -c 'echo $PATH'` fix for Finder-launched apps). Node-service crashes stay inside the
helper's existing `crashBudget` and surface as today's recovery UI. The recovery gate keeps its two
native actions as Tauri commands, `open-data-folder` and `force-quit`, because the shell handler is
unmounted behind the gate.

Two supervision requirements came out of phase 0 and are load-bearing
([node-runtime.md](./node-runtime.md) has the run). Rust spawns the helper in its own process group
and kills the group, never the single process: killing the helper alone leaves the node holding the
data root's lock, and the replacement helper's node cannot start. And the helper installs its stdin
command handler before it starts the node, queueing whatever arrives early, because a quit can reach
it mid-boot.

## The one CSP change

The renderer CSP's `connect-src` widens from `'self'` to `'self'` plus the helper's exact loopback
origin (`ws://127.0.0.1:<port>` and `http://127.0.0.1:<port>`), templated into the header at
runtime by the Rust scheme handler. No wildcard port: the handler is ours and knows the port, so no
third loopback service becomes reachable. This is the honest cost of the helper decision and is a
proposed change against [docs/electron.md](../../electron.md), where `connect-src 'self'` is the
load-bearing directive. Everything else that directive protected still holds: the renderer still
cannot reach a node directly, because nodes require the pinned agent and bearer that only the
helper holds.

Phase 0 checked both halves of this, since a directive that cannot be widened would take the helper
design with it ([webviews-and-frames.md](./webviews-and-frames.md) records the run). Under
`connect-src 'self'` a fetch to the loopback port failed and a `WebSocket` to it threw
`SecurityError: The operation is insecure`. With the port named in the directive, the same
`WebSocket` was allowed to open and the same fetch returned 200. Two details for `helperServer.ts`:
a loopback `ws://` is reachable from the custom-scheme origin even though that origin is a secure
context, and the fetch only worked once the loopback server sent
`Access-Control-Allow-Origin` — a widened `connect-src` is necessary but not sufficient, because the
app origin and the helper origin are different origins.

## Keys and custody

One 32-byte data key lives in the OS keychain via the `keyring` crate, held by Rust and injected
into the helper over the stdin handshake. It arrives at the token store as the `TokenCipher` phase 1
introduced, which is where Electron passes `safeStorage` today. Token blobs stay mode-0600 files on disk, AES-GCM
encrypted by the helper. On a machine with no keychain the key falls back to a 0600 file — the same
fail-quiet stance `deviceTokenStore.ts` has today, and the same blast radius as the node's own
`session.key`, a precedent [docs/node-distribution.md](../../node-distribution.md) already accepts.

`sessionKeyStore.ts` is deleted: the desktop-supervised node uses the generated
`session.key`-in-data-root the standalone node already uses. One custody mechanism fewer.

Migration: Electron's `safeStorage` is Chromium os_crypt — on macOS a keychain item named "acorn
Safe Storage" derives an AES-128-CBC key. The helper performs a one-time migration that reads the
legacy item, decrypts the `device-token-*` blobs, re-encrypts under the new key, and deletes the
legacy items. If the item is unreadable, forget the tokens: the local node mints a fresh device row
(supported today), paired remote nodes need re-pairing, and the fleet UI says so honestly.

A caveat to document loudly: keychain item ACLs bind to the code signature, so while acorn ships
ad-hoc signed, every rebuild re-prompts or loses access, and the file fallback is the common path
on macOS until Developer ID signing exists.

Rejected: stronghold (a database and runtime for a problem one keychain entry solves), per-token
keychain items (a prompt per node and ACL churn), tokens inside `fleet.json` (rejected in
[docs/electron.md](../../electron.md) already).

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
- **Navigation**: `on_navigation` pins the main frame to the app origin. No OAuth exception is
  needed — GitHub connects by device flow against the node, unchanged. The subframe guard is a
  spike item in [webviews-and-frames.md](./webviews-and-frames.md).

## The resulting Rust surface

| Module | Owns |
| --- | --- |
| `lib.rs` | Builder; plugins (single-instance, dialog, opener, os); state; command registry. |
| `helper.rs` | Helper spawn, stdin handshake, ready line, health, generation-counted restart. |
| `keychain.rs` | Data key get-or-create, `keyring` plus the 0600-file fallback. |
| `app_scheme.rs` | Shell protocol: traversal guard, SPA fallback, per-response CSP. |
| `plugin_scheme.rs` | Per-hash static serving from the helper-written cache, frame CSP, no-store. |
| `quit_flow.rs`, `menu.rs` | Quit negotiation, Cmd+W and Cmd+Q accelerators. |
| `commands/` | `helper_endpoint`, `pick_folder`, `open_external`, `reveal_data_folder`, `force_quit`, `quit_approved`. |
| `preview_webviews.rs` | Phase 3: child-webview lifecycle, bounds, nav guards, cookie seeding. |
| `updater_owned.rs` | Post-signing: staged, verified updates. |

Everything else stays TypeScript: the helper (the moved `main/helper/`
folder, whose `index.ts` is already the composition root, plus `helperServer.ts` and a `helperMain.ts`
that adds the stdin handshake and the loopback listener), the renderer bridge, and the node.
