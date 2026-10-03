# Terminal loaded plugins

This page covers how the terminal client installs, sandboxes, and trusts loaded plugins. Read it
before you change plugin custody or the worker sandbox on this host. It's part of
[the terminal client](../tui.md). [The client sandbox](../security/plugin-client-sandbox.md) owns the
containment claim and the flags, and this page owns the shape.

## Loaded plugins

The terminal's file-backed custody implements device install and remove through the same client-core
platform contract as the desktop. It uses the shared archive and manifest validation, and keeps trust
decisions and device preferences in its own config directory. The **Plugins on this device** palette
group installs from a GitHub release, an npm package, or an HTTPS URL, and updates, enables, disables,
changes development trust, and removes installed bundles. The source forms use the desktop's resolver
and trust prompt. There's no local-folder picker.

### The sandbox

A tree-emitting plugin runs in a `node:worker_threads` worker started with
`execArgv: ['--permission', '--allow-fs-read=<bootstrap>', '--allow-fs-read=<bundle>']`. It gets the
tree port for `tree:mount`, `tree:batch`, and the rest, plus a scoped bridge port for each mounted
tree's SDK calls. Selection and surface actions target one mount, and appearance updates reach every
mount. `_setWorkerFactory` in `workerHost.ts` is the seam, and `apps/tui/src/plugins/workerFactory.ts`
is what this host substitutes. Slot bookkeeping, the 30-second grace period, the heartbeat, and
failure fan-out are shared.

A worker thread's grants are its own. Measured on Node 24 and 26, `execArgv` applies the permission
model to the thread: the worker is denied a read the parent may do. So there's no child process per
plugin, and the client process itself runs without permission flags.

Client workers get an empty environment. `env: {}` is set at worker creation, before the bundle runs,
so client code can't read the workstation's exported variables, including any a plugin declares for
its Node half.

The Node 22 and 24 permission model doesn't cover the network. The factory applies the shared builtin
policy in `packages/protocol/src/plugin/nodeBuiltins.ts` with sockets and exec disabled, and passes the
permitted builtin names to the bootstrap. Before the bundle runs, `apps/tui/src/plugins/pluginWorker.js`
enforces that set through `module.registerHooks` for imports and `require`, wraps
`process.getBuiltinModule` with the same check, and deletes five network globals. Subpaths get their
family's policy, and unknown, internal, network, and privileged families are refused. `module` and
`worker_threads` are unavailable, so a bundle can't register its own hook or start another worker.
File access still needs the two exact read grants. Node 26 adds its own network permission check on
top.

The batch rules are shared. `packages/client-core/src/host/tree/treeState.ts` holds the store, the
pre-flight check, `apply()`, the prop sanitizer, and the coalescer, with no JSX, and each host writes
a shell over it. The coalescer ticks on the renderer here and on `requestAnimationFrame` on the
desktop.

### Client worker lifetime

The worker factory gives each sandbox its own stdout and stderr pipes and drains them without keeping
output or drawing it. Worker construction, the transferred hello ports, and native termination belong
to the factory. A per-hash retirement barrier delays a replacement until retired threads exit.
Cancelling a deferred construction closes its untransferred ports and spawns nothing.

The bootstrap keeps one initial hello across its asynchronous module import, and releases it when the
bridge or tree adopts the ports. It closes unclaimed ports when the import fails or after the
10-second handshake deadline. The shared host keeps only the latest pre-ready props per slot and
reports a failed start after its 20-second construction deadline. For capability negotiation and the
512-slot bundle budget, see
[mounted bridge ownership](../plugins/remote-trees.md#mounted-bridge-ownership-and-sdk-compatibility).

### Reserved regions

A pane that reserved `pane.footer` or `pane.aside` is wrapped by the frame registry.
`packages/client-core/src/host/chrome/extendedPane.ts` is the seam, and
`apps/tui/src/plugins/ExtendedPane.tsx` is this host's version, installed in `App.tsx` beside
`setLayouts`, `setRemoteTree`, and `setSourcePanel`. It draws the reserved regions under the owner's
tree in reading order, because a terminal pane is one rectangle with no second column for an aside.

### Custody

There's no helper process to hash bytes, so the client implements `PluginCustody` over files
(`apps/tui/src/plugins/custody.ts`): a content-addressed cache directory under the config root, one
file per bundle named by hash, and an acknowledgement file beside it keyed by `(pluginId, hash)`.
Bytes are hashed on arrival, and a mismatch is refused and never re-keyed, as on the desktop. The
schemas are `@acorn/protocol`'s. `{ path }` is an allowed source form, though nothing offers it.

The shared distribution snapshot selects only the active runtime of the current Node, after custody
accepts its exact bytes. Installed updates stay separate offers. A stale or unreachable Node keeps its
last plugin list for explanation and withholds its loaded UI. Custody can forget one recorded decision
for reconsideration, and ending development mode withdraws its auto-accepted hashes through the shared
reconciliation.

Only `packages/client-core/src/host/plugins/host.ts` calls `pluginCustody()`, and this host adds no
second caller.

### The trust prompt

`apps/tui/src/plugins/TrustPrompt.tsx` draws the prompt as a kit tree in a `Modal`: the same three
tiers, the same permission-key diff, and the same accept, refuse, and show-me actions, read from
`trustModel.ts`. A plugin can't draw over it, because a plugin draws inside a slot and the dialog owns
the key layer.

### The third column

[Security](../security.md) covers the terminal client in its trust boundaries, transport and auth,
plugin bundles, and containment ladder pages. The terminal sits between desktop and web. It holds the
token in the same process as the UI, which the desktop doesn't, and in a file with real modes, which
the web can't.
