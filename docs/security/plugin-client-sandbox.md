# The client sandbox

This page covers rung 0 of the containment ladder: the three containers a loaded plugin's client half
runs in, the bounded requests that cross them, and what stays refused. Read it before you add a bridge
verb or a way for plugins to cooperate. It's part of [plugin security](./node-plugin-security.md).

## Three containers

A bundle that draws pixels runs in an iframe on its own hash-addressed origin, under
`plugin_scheme.rs`'s policy. A bundle that draws a tree runs in a Web Worker with no DOM, under
`PLUGIN_WORKER_CSP` ([the plugin worker](../shell/origins.md#the-plugin-worker)). Both have
`connect-src 'none'`, so the transferred `MessagePort` is the only way out, and both reach the host
through one broker that decides every call from the manifest's scopes.

The terminal has no iframe and no CSP, so a tree bundle there runs in a `node:worker_threads` thread
([the terminal sandbox](../tui/plugins.md#the-sandbox)). `apps/tui/src/plugins/workerFactory.ts`
starts it with `execArgv: ['--permission', '--allow-fs-read=<bootstrap>', '--allow-fs-read=<bundle>']`,
and the two transferred ports are the only way out. The worker starts with an empty environment.

- **A worker thread's grants are its own.** `execArgv` applies the permission model to the thread, so
  the worker is denied a read the parent is allowed. Measured on Node 24 and 26. The terminal process
  itself runs with no permission flags.
- **The worker has no network.** Its bootstrap, `apps/tui/src/plugins/pluginWorker.js`, runs before
  any plugin code. It installs a `module.registerHooks` resolver and wraps `process.getBuiltinModule`
  so a bundle can load only the builtins in the shared family policy, with no socket or process
  families. It deletes `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, and `navigator`.
- **The grants are real paths.** Node compares resolved paths, so a grant through a symlink matches
  nothing. Both grants are `realpathSync`'d.

Everything above the sandbox is shared with the desktop: the worker host, the handshake, the
heartbeat, the whole-batch check and prop sanitiser (`packages/client-core/src/host/tree/treeState.ts`),
and the broker. The terminal adds no security decision of its own beyond the three points above.

## The tree path produces no markup

A tree worker produces names of the host's own components and props checked against the kit's role
enums, so `class`, `style`, `innerHTML`, a raw URL, and a function have nowhere to go. A prop that
fails validation is dropped and the node still renders. A batch that fails is dropped whole and
recorded. A node name this build doesn't know is left out. A misbehaving worker can do nothing to the
UI around it, and the host terminates it and removes its trees.

## Requests that cross the sandbox

**Two messages cross the tree channel toward the host**, and both are bounded requests rather than
an RPC door ([asking the owner](../plugins/remote-points.md#asking-the-owner)). `owner.invoke` calls
one action the owning extension point declared and the owner's `Slot` bound a handler for.
`overlay.open` shows the one overlay this contribution's manifest named. The host scopes a request
by the slot it arrived on, so plugin code supplies no plugin, point, owner, overlay, or slot id.
Payload and reply are each capped at 64 KiB, eight may be outstanding per slot, an owner has ten
seconds to answer, and a failure is a code and a sentence with no host stack
(`@acorn/protocol/tree/messages.ts`). `overlay.open` also needs focus inside that tree and is
throttled to one a second, so a modal stays a person's act.

**Binary bridge calls change no permission.** `api.bytes` runs the same `allowApi` decision as `api`,
before the body is touched, so a plugin's own `/v1/p/<id>/` namespace is reachable and another
plugin's is refused either way. Both directions are capped at 12 MiB (`MAX_PLUGIN_BYTES`), and `type`
and `filename` are advisory.

**Cooperative destinations are manifest allowlists.** A loaded frame can't name another plugin's pane
or route. A surface may declare up to eight local destination IDs, each mapped to one host target
kind, and `ui.openDestination` accepts only a declared ID with resource IDs of at most 300 characters.
The same declaration may name one notification kind. `ctx.events.notice` keeps a loaded plugin's
target and kind only when both match it, and otherwise falls back to the plugin's own source and the
non-toast `plugin` kind. Each destination is an enforced trust line, and its surface, ID, target kind,
and notice kind form the update-diff key.

**An id in props is not a grant.** A contributor's tree gets the owner's identities, such as a task,
a file path, a session, or an artifact id, and nothing they name. To read the bytes behind one, its
Node half declares and calls the owner's read capability. `editor.files` rechecks the worktree and
symlink rules on every call, and `agents.transcriptMedia` answers only for media that belongs to the
named session and task. Both are read-only. `editor.files` answers `missing` for every refusal and
`too_large` over its cap, and `agents.transcriptMedia` answers `null`. A menu row's body carries
the same identities and a revision the owner checks before the row runs.

**Owner actions can require a person.** An owner handler learns `byPerson`, true only when a person
pressed or typed inside that contributor's tree in the last second. Preview's `reload` and the
terminal's `interrupt` refuse without it, so a timer or a mount can't act for a person. Sends, gate
answers, trust, and destructive operations have no contributed action at all.

**A picture is read by the host, never by an image element.** An `Artwork` node's `owner` is the
mount's own Node and plugin, whatever the tree sent. Its path must resolve inside the plugin's
`/v1/p/<id>/` namespace with no other origin, credentials, or fragment. The host reads the bytes
through the broker under the plugin's own route gates, checks that they are a static PNG, JPEG, or
WebP picture within the workspace image ceilings, and hands the image element a local object URL.
No renderer or worker network policy widens for it, and a provider download is the plugin's Node
half's, under its declared network permission
([artwork bytes](../plugins/rail-presentation.md#artwork-bytes)).

**Going to a task rides the task read scope.** `ui.openTask` needs `core.tasks:read`, the scope that
already lets a surface list tasks. Like `openUrl`, the surface must have focus, and the two share one
navigation per second.

## Refused for good

Each of these will be asked for again in reasonable-sounding words:

- **An iframe inside an iframe.** `frame-src 'none'` in `apps/desktop/src-tauri/src/plugin_scheme.rs`
  refuses it. An iframe embedded by another plugin's iframe lets the outer one overlay, resize, and
  clickjack the inner one undetected, hides the messages between them from the host, and makes the
  outer plugin's trust prompt a lie. A rectangle contributed into another plugin's point is a sibling
  the host places, never a child of a plugin's document.
- **Free `postMessage` between plugin origins.** Every cross-plugin byte passes the host and is checked
  against a declared shape. Two origins talking directly can't be gated, capped, logged, or described
  in a trust prompt.
- **Nested cooperative slots.** A contributor's subtree grafted into an owner's slot doesn't open slots
  of its own. The chrome `Slot` node works only with an opaque reference minted for the selected rail
  or topbar provider, and the host clears it before mounting the child.
- **Reopening `frame-src`**, for any reason. The Rust test in `plugin_scheme.rs` that pins the policy
  stays green.
