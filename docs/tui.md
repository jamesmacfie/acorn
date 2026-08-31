# The terminal client

`acorn` is the terminal client: client-core booted under Node, drawing the same pane tree the desktop
draws, in cells. It is the second host of the closed kit and the only test that the kit is intent
rather than layout.

`apps/tui/` is the whole of it, about 9,000 lines, and nearly all of that is one component per kit
node and one per layout. The panes, the query layer, the keymap, the palette model, the focus intents
and the tree protocol are `packages/client-core`'s, unchanged. No plugin writes terminal UI, declares
a `tui` surface, or learns which host it is on.

Three docs have "terminal" in the name. This one is acorn running in a terminal.
[terminal.md](./terminal.md) is the terminal drawer inside the desktop app, a raw PTY with nothing
between you and it. [managed-agents.md](./managed-agents.md) is the other way to run the same
providers, driven over a protocol with a ledger.

The design record is in git: `docs/future/terminal/`, nine phases between 2026-08-30 and 2026-08-31,
deleted once it shipped. Find it with `git log --follow -- docs/future/terminal/README.md`.

## What it is, in one screen

```text
Topbar:   one line. Workspace, task count, the open branch, the node's state as a dot
Rail:     a column of tasks, browse sources under a rule; two cells of marks below 100 columns
Main:     one pane, with a strip of pane labels above it
Overlays: the palette, the cheat sheet and a quit confirmation, drawn where the pane is
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

Run it from a checkout with `pnpm --filter @acorn/tui dev`. `pnpm --filter @acorn/tui capture` prints
one frame at a fixed size against the fixture in `apps/tui/src/fixture.ts`, on a machine with no TTY,
and `capture -- notes` picks a pane by name.

## The runtime floor

OpenTUI reaches its Zig render core over `node:ffi`, which is a Node 26.4 builtin behind
`--experimental-ffi`. So `acorn` needs **Node 26.4 or later, started with `--experimental-ffi`**, and
`apps/tui/src/main.tsx` checks the version itself rather than letting the loader fail with a stack
trace from inside a chunk. It is not an `engines` floor on the package: the repo builds and lints this
one on whatever Node it already has, and only running it needs 26.4.

Two consequences. The `tui` test suite skips every case that draws where there is no FFI, which is
what keeps an older Node reporting a skip rather than failing a suite for a reason unrelated to the
change under test ([testing.md](./testing.md) § Test layers). And bundling a Node runtime stops being
the last step of shipping a tarball and becomes a precondition of one carrying `acorn` at all, because
26.4 with an experimental flag is not something to expect on a server
([future/bundle.md](./future/bundle.md)).

## The process model

### Attach or start

`acorn` with no arguments opens the workspace for the node whose data root this machine uses. It
attaches to one that is running and starts one that is not, and the fact it reads to decide is the
exclusive lock the node takes on its data root at boot.

1. Resolve the data root (`apps/tui/src/node/paths.ts`): `ACORN_DATA_DIR`, else the desktop app's root
   if the app is installed here, else the dev checkout's. On a laptop with the app installed, the node
   worth opening is the one the app started.
2. The root is locked, so a node is running. Read its endpoint from `node.json` and the certificate to
   pin from `tls/cert.pem`, authenticate with the device token this TUI holds, and attach.
3. The root is not locked, so start one: spawn `standalone.js`, read the single JSON handshake line
   (`nodeId`, `endpoint`, `fingerprint`, `certPem`, `deviceToken`), and keep the child for the life of
   the TUI.

`apps/tui/src/node/open.ts` holds that decision, and `supervise.ts` is the forty lines that own a
started child: SIGTERM, then SIGKILL after five seconds. It is not the desktop helper's supervisor.
`ServiceHost` speaks the fd-3 service RPC to `service.js`, and a standalone node prints one line on
stdout and speaks no RPC, so the only part worth sharing was the drain.

A second `acorn` in a second terminal finds the lock and attaches, and leaves the node running when it
quits. The one that started it owns its lifetime, which is the desktop's rule too.

Attaching needs a device token, and a node the desktop started holds a token that belongs to the
desktop. So the first `acorn` against one prints that node's pid and the `kill -USR1 <pid>` that
reopens its pairing window, and then runs the ordinary pairing exchange against loopback. A loopback
mint route would remove the step and does not exist.

### Remote nodes

`acorn --node https://host:4317` runs the desktop's three steps in a terminal
(`packages/custody/src/broker/nodePairing.ts`): an unverified probe of `GET /v2/node` that cross-checks
the socket's fingerprint against the body's, the six words printed for the reader to compare against
what the node printed at its own boot, and `POST /v2/pair` over a pinned agent with the code. Both run
before the renderer starts, because pairing asks a question on stdin and has nothing to draw.

`acorn` remembers what it pairs with, so the second time is `acorn --node <name>`. The list is the
fleet store's; there is no second one. A revoked token reads as `revoked` on the footer and stops
reconnecting.

### Where the TUI keeps things

Two directories with different owners. The config directory is the TUI's, holding the fleet store, the
device tokens at mode 0600, and the query cache the client persists (`apps/tui/src/node/cache.ts`
behind `setCacheStorage`, where the desktop leaves IndexedDB). `ACORN_TUI_CONFIG_DIR` overrides it,
which is how the boot test never touches the config of the person running it. The data root is the
node's, and nothing in `apps/tui` writes to it.

The device token is plain bytes at 0600. The desktop encrypts under the platform keychain through a
`TokenCipher`; there is no keychain here, so the TUI supplies a pass-through, which is what the node
beside it already does with its own TLS private key and session key. On NTFS the mode is advisory,
which [future/bundle.md](./future/bundle.md) § The snags carries with the other file-mode claims
Windows does not honour.

### Signals and exit

`Ctrl+C` belongs to the TUI outside a PTY and to the PTY inside one, per the Rectangle contract below.
`SIGTERM` drains a child this `acorn` started. `SIGWINCH` re-lays out, and nothing in a layout reads
the terminal width, so a resize is the renderer's alone. `q` at the rail quits, and asks first when
this TUI started the node.

### Shell and broker in one process

On the desktop the renderer never holds a token: the helper brokers every request over pinned HTTPS
with a device bearer, and the bearer rides the WebSocket upgrade header, which a browser cannot set.
That split is why the helper is a separate process.

A terminal is one process running under Node, so it sets the header itself. `NodeBroker`, the fleet
store and the device-token store are imported directly and run in the TUI's own process
(`apps/tui/src/platform.ts`). "The renderer never sees the token" stops being a structural fact and
becomes a module boundary: the token lives in the broker's module, and an arch rule refuses an import
of custody from anything in `apps/tui` that draws a cell. For the trust consequences, see
[security.md](./security.md) §§ Trust boundaries and Transport and auth.

### Booting client-core under Node

The client reads its host through one seam, `packages/client-core/src/infra/platform/`, which reads
`window.acorn`, and nothing outside that folder may name the global. The seam's own check is
`typeof window`, so a Node host qualifies by defining one — as an object holding `acorn` and nothing
else, rather than as an alias of `globalThis`. A `window` that answers every question is worse than
none, because libraries probe it for `addEventListener` and `localStorage` and would find the
process's own globals under a browser's name.

`main.tsx` installs the seam and then imports the rest dynamically, because a module that reads
`window.acorn` at its top level would read it before the install ran.

| Group | What the TUI installs |
| --- | --- |
| `transport` | `NodeBroker`, in-process. Responses stay buffered `Uint8Array`. |
| `fleet` | The fleet store: `list`, `probe`, `pair`, `rename`, `forget`, `reconnect`, `restartLocal`. `nodeAdopt` and the tunnels are not installed. |
| `pairing` | Probe only. The probe is remembered in the seam rather than handed back, so confirming a fingerprint is a step rather than a parameter a caller could skip. |
| `plugins` | File-backed custody. See The sandbox below. |
| `recovery` | `openDataFolder` prints the path; `quit` exits. |
| `desktop`, `desktopExtras`, `folderPicker`, `preview`, `webviews` | Absent by design. The affordances they gate disappear, which the seam models as a product state. |

## The host switch

Four aliases in `apps/tui/vite.config.ts`, mirrored in the package's `tsconfig.json` paths. That is
the whole of what makes a compiled pane draw in cells:

- `@acorn/plugin-api/ui` resolves to `apps/tui/src/kit/ui.ts`, this package's kit. A pane imports the
  kit through that facade and nothing else.
- `@acorn/plugin-api/ui/host` resolves to `apps/tui/src/kit/host.tsx`: the palette chrome, the drawer,
  the reference-panel box and the two cooperative-extension nodes, whose DOM copies are portals and
  `<ul>`s.
- `@solidjs/router` is removed rather than replaced. It reads `window.history.state` at module scope,
  so a pane that imports it cannot be loaded in this process, and there is no URL behind it to answer
  with.
- `solid-js` points at the client build, because Solid's `node` export condition is its server
  renderer and has no reactivity.

Beside the aliases, two build facts. `vite-plugin-solid`'s `generate: 'universal'` sends JSX to
OpenTUI's reconciler instead of to the DOM. And `__ACORN_HOST__` is `'tui'`, which is what `Only` and
`Fallback` read and the only thing in the kit that asks which host it is on
([ui-design.md](./ui-design.md) § The closed kit).

Anything touching Solid's reactive graph is bundled rather than left to Node, so there is exactly one
copy of it. A second copy is a second graph and a second set of contexts, and it fails as "No renderer
found" from inside a component that is plainly under the provider.

## Rendering

[ui-design.md](./ui-design.md) owns the kit: what every node draws at 80 columns by 24 rows, what a
`reduced` node loses, and the four support levels. [panes.md](./panes.md) § Layout model owns the eight
layouts and the terminal projection of each. Neither is restated here. What follows is what only this
host decides.

The component table is `apps/tui/src/kit/components.tsx`, keyed by `KitNodeName` exactly as the DOM
host's is, and `tools/arch/kitTable.test.ts` holds three lists to one: the 80×24 appendix, the support
matrix, and both hosts' tables. A node cannot be added with a sentence and no component, or a component
and no sentence. Five prop types are the DOM kit's, imported as types rather than rewritten:
`ButtonProps`, `InputProps`, `SelectProps`, `PickerProps` and `MentionTextareaProps`. Four of the
hand-written copies had quietly lost a prop by the time anything compiled both sets together.

Colour comes from `apps/tui/src/appearance.ts`, which collapses a theme's forty-odd tokens to the
terminal's 16 slots plus `dim` and `bold`. `roleCell()` is `roleVar()`'s sibling and returns the
OpenTUI style fragment for a role value, with `ignored` returning nothing. A theme picked in the app
does not reach this host: a theme in acorn is an id whose tokens live in a `:root[data-theme=…]` block
in a stylesheet, and publishing those as data is the appearance layer's change rather than the
terminal's. The default was always the terminal's own palette.

The seven layout components are `apps/tui/src/layouts/`, reaching the pane registry through
`client-core/src/host/layouts/table.ts`, which is host-supplied for the same reason the component
table is.

One guard sits over the renderer, in `apps/tui/src/renderGuard.ts`, installed beside it in `main.tsx`
and in the test harness. OpenTUI reads a node's size straight from yoga, and a node that joins the tree
after a frame's layout pass has no measured size: the width comes back `NaN` and the frame hands it to
the Zig side, which takes a `u32` and throws "Argument 3 must be a uint32" from inside the render loop.
That ends the process. It lasts one frame and hits any node with a border or a hit box, so no single
node can own the fix — `list-detail` mounts its divider when the list region arrives, and a `Card`
mounts on every turn of the agents transcript, which is how switching to a workspace whose task opens
that pane killed `acorn`. The guard clamps an unmeasured size to one cell, and goes the day OpenTUI
clamps its own.

### Rectangles

`Rectangle` is the kit's one admission that a pane needs pixels, and it has four kinds. On this host:

- **`pty` is native.** `attachPty(handle, io)` on `@acorn/plugin-api/ui` takes the channel — open at a
  size, bytes in, bytes out — and the host draws the emulator: an xterm on the DOM, OpenTUI's in
  cells. The caller's source is the same file either way, which is what let Docker's exec panel and
  the editor's `$EDITOR` window cross at about fifteen lines each. The terminal plugin's own drawer
  surface keeps its xterm, because its options are a theme, a font size, a WebGL renderer and a
  Shift+Enter rule, none of which means anything in cells ([terminal.md](./terminal.md) § Client).
- **`editor` draws its box and says the file opens there.** The `$EDITOR` handoff needed nothing
  built: the editor pane already has a terminal mode where one device preference swaps CodeMirror for
  a throwaway PTY running the reader's own editor on the worktree, and that PTY lives on the node, so
  in cells it simply draws ([editor.md](./editor.md) § Editing in your own editor). A read-only text
  view with a find bar inside the box is not built.
- **`webview` and `frame` draw their `<Fallback>` child**, or a line naming what is missing.

`Rectangle` itself is `absent` in the support matrix, because this host recognises the kind and draws
natively rather than handing an element back. The `rectangle` extension kind — a sibling region an
iframe fills — is absent entirely.

### Unknown nodes and failed trees

Three behaviours, the same on both hosts. A node type this build cannot draw renders as a labelled
placeholder. So does a failed slot. And there is one error boundary per tree. On this host all three
draw as an `Alert` in `warn` tone. A new node name from a newer plugin is a placeholder and a roster
row, never a crash.

### What the TUI never does

- Read the terminal width inside a node or a layout. Breakpoints are the renderer's, and a layout asks
  "am I narrow" of its own region.
- Draw a hover state, or handle a pointer. There is no mouse path at all.
- Accept `class`, `style`, or a DOM attribute. The type-level test refuses them and the tree protocol
  drops them on the wire.
- Invent a node. A pane that needs something the kit lacks asks the kit, and the kit answers for both
  hosts or refuses for both.
- Shrink to make room. Yoga answers a height deficit by taking it out of every child that will give,
  and a one-line row given half a line lands on the line above it. Every block node and every row
  refuses to shrink, and the region around them clips. A pane taller than the screen is the normal
  case at 24 rows, and `scrollbox` is refused with the reason in `apps/tui/src/chrome/PaneRow.tsx`.
  Nothing holds this rule but the pane suite noticing a string went missing.

## Keys and focus

[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) § Focus and typing owns the
intents, the four layer tiers, and the two rules a host with no pointer adds. What follows is the
mechanism.

### The adapter

`apps/tui/src/keys/install.ts` builds `createDefaultOpenTuiKeymap(renderer)` from
`@opentui/keymap/opentui`, where the DOM host builds `createDefaultHtmlKeymap(root)` from the same
package. `keymapHost.ts` holds the engine at the widest type pair the engine allows and hands each
host's pair back at the one call that reads it, rather than being generic over a pair every caller
threads through: every caller in the kit means the DOM's, and forty components would have gained two
type parameters to say nothing new. One host-supplied predicate crosses instead, "is somebody typing",
which is the only question a binding asks about the focused thing.

Chords are spelled with `ctrl` here. The engine reports the platform's primary modifier, which on
macOS is `super`, and a terminal emulator keeps Cmd for itself and never delivers it, so `commit` was
a chord nobody could press. `setKeymap` takes a `primary` and this host passes `ctrl`.

### Focus regions

`apps/tui/src/keys/regions.ts` keeps the DOM host's contract and replaces every mechanism in it. A
region is registered by its layout with its id and its order, from the layout's own knowledge of its
regions rather than from `compareDocumentPosition`. A region's first stop is the first renderable in
its subtree whose focus role is `stop`, `item`, `collection` or `trap`, walked over OpenTUI's retained
tree. Focus is OpenTUI's focus, and the renderer owns it. There is no pointer half.

The region cycle is the whole screen rather than the focused pane: rail, pane strip, the pane's own
regions, and back. The desktop draws several panes side by side and Tab into the next one would
surprise; there is no next one here. The chrome orders itself around the pane by declaring orders
outside the range a layout uses. `nextPane` switches which pane is drawn.

### Collections

The intent half of `collection.ts` is shared. The element half has a DOM file and
`apps/tui/src/keys/collection.ts`, where "focus the active item" sets the renderer's focus and "scroll
into view" moves the collection's `offset` until the row is inside the visible rows. `Grid` keeps its
documented exception: a virtualised row has no renderable, so the arrows move `selected` and the view
follows.

### Traps

`apps/tui/src/keys/trap.ts` contains keys by owning a layer rather than by walking focusable elements.
A `Modal` or `Menu` pushes a layer that answers `next`, `prev` and `dismiss` and swallows the rest.
That layer sits below the collection tier, not at the trap's own. Putting it at the trap's tier is the
mistake the quit confirmation found: priority decides, not locality, so the swallow reached Enter
first and a list inside a `Modal` was dead. Putting it lower costs nothing, because a collection
behind the overlay does not fire anyway once the overlay has taken the focus.

### The Rectangle contract

A rectangle is one tab stop from outside. Enter hands the keys to what is inside, Escape takes them
back. A `pty` rectangle owns its keys by intercepting rather than by holding a layer, because a layer
answers keys it can name and a rectangle answers all of them: `PtyRectangle` registers an intercept
above every layer and consumes what it takes. Keys reach the emulator through `encodeKey`, not through
the emulator's own handler, because the emulator only takes keys when the renderer has focused it and
here the box holds the focus so Enter and Escape belong to the rectangle.

Escape alone leaves. A second Escape within 400 milliseconds goes back in and sends one. There is no
pending window on the first press, because holding it to see whether a second arrives would put a
delay on every exit, and this is already the one key rule the desktop does not have.

### The footer

The footer lists the intents the focused thing accepts with their primary keys, read off the keymap's
active layers. Nothing is declared twice. The engine has no signal for "the active layers changed", so
`activeHints()` reads the two signals that move them: where the keys are, and whether an overlay has
taken them. Without that the footer is whatever was true at the render that happened to build it.

While a PTY is entered the footer says `esc leave · esc esc send escape`. `?` opens the cheat sheet as
a modal, and the footer itself is not a focus stop: it is a label with nothing to drive, and a stop
that does nothing is a hole a reader falls into.

### What must never happen

- A second keymap, or key handling in a component. Every key goes through `@opentui/keymap`'s layers.
- A node that handles `ArrowDown`. Nodes handle `next`.
- Focus state a node owns. The host owns it on both hosts.

## Chrome

`apps/tui/src/chrome/` draws the shell around the panes, which on the desktop is bespoke DOM rather
than kit. [ui-design.md](./ui-design.md) § Shell hierarchy has the two hierarchies side by side.

### The screen

Left to right and top to bottom: one topbar line, a rail column of task rows with browse sources under
a rule, the active pane in the rest with a strip of pane labels above it, one footer line. Below 100
columns the rail collapses to a two-cell strip of marks, the same collapse the desktop's
`leftCollapsed` preference does.

The chrome spends three cells, so at 80 columns the pane is 77 — under `list-detail`'s own 80-cell
threshold, which means one group at a time with `expand` switching between them. Every pane in the
roster inherits that 77.

### What is drawn bespoke

The rail's task list goes through the same `rail.taskList` exclusive slot the desktop's does, so a
plugin that offers to replace it replaces it on both hosts. `ExclusiveSlotHost` is host-supplied like
the component table, because the DOM's copy reaches for `Dynamic` from `solid-js/web` and pulling that
in would put a second Solid renderer in the graph to render one child. The arbitration rule in
`exclusiveSlots.ts` is shared unchanged. The topbar and the pane strip are bespoke until the
client-plugins programme gives each a contract.

The palette is a `Modal` over the same `kit/lib/paletteModel.ts` the desktop's runs on, and it does not
use the kit's collection: a collection's keys are bare keys, a bare key does not fire while something
is being typed into, and in a palette something always is. So it keeps one cursor signal and binds the
arrows above the trap.

An overlay hides the pane rather than replacing it. Opening the palette must not tear down the pane
behind it and throw away its queries and its model, so the pane box is `visible={false}` while an
overlay is on top, the same thing `TabPanel` does for a hidden tab. `takeFocus` in the region store is
this host's answer to the DOM palette's `prevFocus`.

Notifications are the same `toast()` store the desktop's `ToastHost` draws, so `bridge.ui.toast` and
every plugin that calls it lands on a line above the footer. They never take focus.

### Navigation

`Tab` and `Shift+Tab` cycle regions, beside `F6`, which is what the DOM host spells the same intent
because the browser owns Tab. In the rail, `j` and `k` move and `Enter` opens the task. `w` switches
workspace through an overlay, because that is the shape that takes the keys off whatever had them; it
does not restore what you were looking at, since the desktop remembers a view per workspace and this
host clears the source and lets the first task open. The command chord opens the palette from anywhere
except an entered PTY.

A pane opens with the keys already somewhere, because there is no click to put them there. And a
region opens on its list where it has one rather than on the first field above it, because the first
thing focused is the thing the bare keys drive and landing in a filter box means `j` types a `j`.

## Loaded plugins

A terminal has no iframe, so the sandbox a tree-emitting plugin runs in is different here and nothing
else is. [security.md](./security.md) § Rung 0 owns the containment claim and the flags; this section
owns the shape.

### The sandbox

A `node:worker_threads` worker started with `execArgv: ['--permission', '--allow-fs-read=<bootstrap>',
'--allow-fs-read=<bundle>']`, receiving the same two ports the DOM's Web Worker does: the bridge port
carrying the SDK verbs and the three host pushes, and the tree port carrying `tree:mount`,
`tree:batch` and the rest. `workerHost.ts`'s `_setWorkerFactory` is the seam, and
`apps/tui/src/plugins/workerFactory.ts` is what it substitutes. Everything else in that file — slot
bookkeeping, the 30-second grace, the heartbeat, the fail-fanout — is shared.

**A worker thread's grants are its own.** `--permission` looks process-wide, which would have forced a
child process per plugin with the two ports over an IPC channel. Measured on Node 24 and 26, `execArgv`
applies the permission model to the thread: the worker is denied a read the parent is allowed. So there
is no child process, and the TUI process itself runs with no permission flags at all.

**Node's permission model does not cover the network**, which is the one thing the DOM worker's CSP
gave away free. `apps/tui/src/plugins/pluginWorker.js` runs before a stranger's module scope, installs
a `module.registerHooks` resolver refusing fourteen builtins, and deletes five globals. `module` is on
that list so a bundle cannot register a hook of its own and undo this one, and `worker_threads` so it
cannot start a thread that inherited none of it.

The batch rules are shared rather than copied. `client-core/host/tree/treeState.ts` holds the store,
the pre-flight check, `apply()`, the prop sanitiser and the coalescer with no JSX in them, and each
host writes a shell over it. Two copies of those rules would have been two copies of a security
decision. The coalescer's tick is the renderer's here and `requestAnimationFrame` there.

### Custody

There is no helper process to hash bytes, so the TUI implements `PluginCustody` over files
(`apps/tui/src/plugins/custody.ts`): a content-addressed cache directory under the config root, one
file per bundle named by hash, and an acknowledgement file beside it keyed by `(pluginId, hash)`.
Bytes are hashed on arrival and a mismatch is refused and never re-keyed, which is the desktop's rule.
The schemas are `@acorn/protocol`'s; no custody type is defined in this package. Device provenance is
natural here and `{ path }` is an allowed source form, though nothing offers it yet: a person at a
terminal installing a plugin is installing it here.

No module outside `packages/client-core/src/host/plugins/host.ts` calls `pluginCustody()`, and this
host does not add a second caller.

### The trust prompt

`apps/tui/src/plugins/TrustPrompt.tsx` draws the prompt as a kit tree in a `Modal`: the same three
tiers, the same permission-key diff, the same accept, refuse and show-me actions, all of it read off
`trustModel.ts` lines, which are data. A plugin cannot draw over it, because a plugin draws inside a
slot and the modal owns the key layer. Nothing in the prompt is terminal-specific.

### The third column

[security.md](./security.md) carries the terminal in five places: § Trust boundaries as a fifth entry
where the first two collapse into one process, § Transport and auth for the upgrade header, § Third-party
plugin bundles for the two file-backed stores, § The containment ladder rung 0 for the worker thread
and rung 2 for what it settled, and the summary table for the token and consent files.

The terminal sits between desktop and web on that ladder. It holds the token in the same process as
the UI, which the desktop does not, and it holds it in a file with real modes, which the web cannot.

## What a plugin loses here

Nothing, from the plugin author's side: a plugin writes no terminal UI, declares no `tui` surface, and
learns nothing about the host. What a *reader* loses is one row per plugin in
[first-party-plugins.md](./first-party-plugins.md) § What each of these loses in a terminal, and it is
short. The whole workspace crosses except three rectangles, and the rectangle that defines an agent
workspace, the PTY, is the one a terminal does best.

Two things nothing draws yet rather than draws worse. There is no settings surface, so the four
plugins that register a settings page contribute nothing through it, and `workflows` contributes
nothing at all. And the rail's drawer sources are the rail's browse sources, not the terminal plugin's
profiles.

## Tests

[testing.md](./testing.md) § Test layers owns the tiers. In short: one case per kit node against a cell
buffer, one per layout drawn from its projection, a twin of client-core's `keys.test.tsx` against the
terminal adapter, a pane file that opens every first-party pane at exactly 80 by 24 and asks whether
the thing the pane is for is on the first screen, a chrome file that drives the whole shell, and four
files that need no renderer and never skip: the palette's collapse to 16 slots, the clipboard
sequence, the plugin sandbox, and the boot test.

The boot test (`apps/tui/src/node/boot.test.ts`) is what `apps/desktop/test/boot.test.ts` is for the
shell. Against a fresh data root and a fresh config directory it starts a real standalone node, uses
the real fleet store and token files and the real broker over pinned TLS, and then asks the three
questions only this host has: a second `acorn` attaches rather than starting a second node, a token
the node refuses reads as `revoked` and stops retrying, and quitting drains the child and releases the
root's lock.

## Shipping it

Not shipped. `acorn` runs from a checkout. Putting it in the node tarball and the desktop bundle is
step 7 of [future/bundle.md](./future/bundle.md) § Ordering, which owns the pipeline, the two native
modules, the runtime pin and the signing gate. What that step still owes is written there.

## Doors left open

- **A loopback token mint.** Attaching to a node the desktop started means a pairing code today.
- **"Open a pairing window" as a TUI command.** A TUI attached to the local node is an out-of-band
  channel of its own, and it is the answer to `SIGUSR1` not existing on Windows.
- **Tunnels through the fleet group.** The seam models them; nothing draws them.
- **Mouse.** If it comes, it clicks to focus and scrolls a collection, and nothing else. Drag, hover
  and context menus stay keyboard-driven.
- **Sixel or Kitty graphics** for image attachments, if a terminal that supports them turns out to be
  common among readers.
- **A container image carrying `acorn`**, so `docker exec -it <container> acorn` attaches from inside.
- **The node half out of process.** The worker factory, the flags and the two ports are the design
  rung 2 inherits; what it still owes is `ctx` as authorised calls and the plugin-scoped token behind
  them ([security.md](./security.md) § Rung 2).
- **A device-held install.** `{ path }` is a form the custody accepts and nothing offers, which is the
  client-plugins programme's phase 0 on this host.
- **A read-only text view inside an `editor` rectangle**, with a find bar. The box and `$EDITOR` cover
  the case today.
- **A test for the no-shrink rule.** One `flexShrink` left at its default on a pane's path brings the
  interleaving back, and what catches it is a pane suite noticing a string is missing rather than a
  rule saying why.

## Related

- [ui-design.md](./ui-design.md) — the closed kit, every node at 80 by 24, and the role tokens both
  hosts read.
- [panes.md](./panes.md) — the layout model and each layout's terminal projection.
- [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) — the intents, the layers,
  and focus.
- [security.md](./security.md) — the trust boundaries and the containment ladder.
- [node-distribution.md](./node-distribution.md) — reaching a node with `acorn`, from the node's side.
- [first-party-plugins.md](./first-party-plugins.md) — what each plugin loses here.
- [future/bundle.md](./future/bundle.md) — packaging `acorn` and the node together.
- [future/remote.md](./future/remote.md) — the browser surfaces, which share this host's reasoning
  about auth and custody and none of its constraints.
