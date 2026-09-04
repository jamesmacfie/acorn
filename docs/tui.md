# The terminal client

`acorn` is the terminal client: client-core booted under Node, drawing the same pane tree the desktop
draws, in cells. It is the second host of the closed kit and the only test that the kit is intent
rather than layout.

`apps/tui/` is the whole of it, about 9,000 lines, and nearly all of that is one component per kit
node and one per layout. The panes, the query layer, the keymap, the palette session, the focus intents
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
Topbar:   one line. Workspace > project, task count, the open branch, the node's state as a dot
Left:     three framed panels — Menu, the sources; Browse, what is under the chosen one; Tasks
Main:     one pane, or the chosen source's detail, with a strip of pane labels above it
Overlays: the palette, the cheat sheet, the two pickers and a quit confirmation, where the pane is
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

The renderer does not wait for step 3. `openNode` returns as soon as the child is spawned and hands
back the handshake as a promise, because a node's boot is the longest thing on this command's critical
path — 120 seconds of budget, and a full `tsx` boot in a checkout. What lets the shell draw in front of
it is that the node's id is already on disk: `node.json` names it, it is minted once per root and never
rewritten, so `acorn` can name the query cache's partition and render it before the child has bound a
port. The footer says `starting the node…` until the handshake lands, and the first non-offline state
invalidates whatever the shell asked for while nothing was listening
([caching.md](./caching.md) § Renderer query cache).

Two cases still wait, and both for the same reason — there is nothing to draw. A first-ever start has
no `node.json` and no cache under it. And pairing asks a question on stdin, so it stays in front of the
renderer whatever else moves behind it.

A started child's stdout is read until the handshake and drained after; its stderr is piped and held,
never inherited. stderr is the file the renderer draws on, so one line of the node's logging arriving
mid-session reads as the shell going to garbage. The held lines print after `renderer.destroy()`,
beside the boot account and whatever the process itself logged.

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

`cache/` holds one file per node, named by the partition key with its colon percent-encoded, at 0600
in a 0700 directory. It is written now: `main.tsx` drives `persistQueryClient` over the same persister
`clientFor` built, where before it installed the store and never persisted anything, so the directory
stayed empty and every start was cold. A write goes to `<key>.json.tmp` and is renamed over the target,
so a reader never sees half a snapshot and a crash mid-write leaves the previous one readable. Reads
are synchronous because there is one, before the renderer exists; writes are not, because they land
while the renderer owns the terminal.

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

**One query client per node, and this host keeps that contract.** `App.tsx` takes the client as a prop
and gets `clientFor(nodeId).client` — the same client `watchTaskChanges` and its siblings invalidate,
and the same one the persister above writes. It used to mint a second `QueryClient` of its own, so the
shell read a cache nothing persisted and nothing invalidated: a task created by an agent or in another
window moved nothing on screen until a restart. Nothing on any host may add a second client
([caching.md](./caching.md) § Renderer query cache).

**The roster loads after the first frame.** `apps/tui/src/roster.ts` holds the twelve client plugins and
`main.tsx` imports it on the renderer's first `frame` event. Registering late is safe because every
contribution registry is a Solid signal, so the chrome draws and the rail, the pane strip and the
palette fill from the same reactivity that already handles a loaded plugin arriving from a node seconds
later. What must not move behind the frame is the four host seams in `App.tsx` — the layout table above
all, which a pane needs before it can draw at all.

| Group | What the TUI installs |
| --- | --- |
| `transport` | `NodeBroker`, in-process. Responses stay buffered `Uint8Array`. |
| `fleet` | The fleet store: `list`, `probe`, `pair`, `rename`, `forget`, `reconnect`, `restartLocal`. `nodeAdopt` and the tunnels are not installed. |
| `pairing` | Probe only. The probe is remembered in the seam rather than handed back, so confirming a fingerprint is a step rather than a parameter a caller could skip. |
| `plugins` | File-backed custody. See The sandbox below. |
| `recovery` | `openDataFolder` prints the path; `quit` exits. |
| `desktop`, `desktopExtras`, `folderPicker`, `preview`, `webviews` | Absent by design. The affordances they gate disappear, which the seam models as a product state. |

## The host switch

Seven aliases in `apps/tui/vite.config.ts`, mirrored in the package's `tsconfig.json` paths. Both, or
tsc and the bundle disagree and nothing says so. That is the whole of what makes a compiled pane draw
in cells:

- `@acorn/plugin-api/ui` resolves to `apps/tui/src/kit/ui.ts`, this package's kit. A pane imports the
  kit through that facade and nothing else.
- `@acorn/plugin-api/ui/host` resolves to `apps/tui/src/kit/host.tsx`: the palette chrome, the drawer,
  the reference-panel box and the two cooperative-extension nodes, whose DOM copies are portals and
  `<ul>`s.
- `@acorn/plugin-api/ui/editor` resolves to `apps/tui/src/kit/editor.ts`, a stub. The facade's real
  half is CodeMirror's theme and a grammar per language, and neither means anything here: the `editor`
  rectangle draws the file read-only and hands the reader's own `$EDITOR` a PTY (§ Editing in your own
  editor in [editor.md](./editor.md)). Left unaliased, `EditorPane.tsx` reached the real module and
  this bundle carried seventeen CodeMirror grammars and a colour theme nothing here can draw. The stub
  exports the facade's names with the facade's types — `languageForPath` resolving to no extension,
  the theme accessors returning nothing to apply, no-op view-state helpers — so the pane compiles and
  runs unchanged. CodeMirror itself still arrives, because the pane imports `basicSetup`, `EditorState`
  and `EditorView` directly rather than through the facade; nothing on this host calls the code that
  uses them, so it is bytes in a lazy chunk rather than work.
- `@solidjs/router` is replaced by a path in a signal. The package itself still has to go: it reads
  `window.history.state` at module scope, so a pane that imports it cannot be loaded in this process.
  See The router below for what stands in its place.
- `solid-js` points at the client build, because Solid's `node` export condition is its server
  renderer and has no reactivity.
- `@opentui/solid` resolves to `src/kit/reconciler.ts`, which is the package re-exported with two
  things replaced: `insert`, and `createElement`. The transform emits its calls by module name, so
  this is the only place that sits in front of every one of them. See Loose text under a box for the
  first and Destroy on disposal for the second, and why both are here rather than in each component.
- `lucide-static/icon-nodes.json` resolves to an empty table. It is 706 KB of SVG path data and there
  is no SVG here: `Icon` on this host is a lookup from a Lucide name to one character, and the DOM
  component that reads the table is in the graph because client-core's components have to resolve,
  not because any of them draw.

  That last one is a crash, not a saving, and it is worth knowing why. **The bundle externalises every
  bare import of a package outside the workspace**, so an import left alone is one Node resolves at
  run time — and Node's loader refuses a JSON module with no `with { type: 'json' }` on it. Writing
  the attribute does not help, because the TypeScript transform drops it before the bundler sees it.
  So a JSON import anywhere in the graph is `ERR_IMPORT_ATTRIBUTE_MISSING` thrown from inside a lazily
  loaded chunk, which is to say the first time a reader opens the one surface that pulls it. This one
  went off when somebody opened Linear. If another arrives, alias it or inline it; there is no third
  answer, and `apps/tui/dist` can be grepped for `from "….json"` to find one.

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
matrix, and both hosts' tables. An entry may be a component or a loader for one
(`client-core/host/tree/kitEntry.ts`), and on this host every entry is the component: the table is not
in the eager graph at all, because `src/plugins/RemoteTree.tsx` is lazy, and the heavy nodes share
`src/kit/showing.tsx` with the cheap ones, so a loader would cost a frame of blank and save no bytes.
The DOM host's table does hold loaders, because its copy is fetched on every cold window
([plugins.md](./plugins.md) § The tree contract). `TreeHost` draws each root under a `Suspense` with a
`null` fallback either way, which is safe here only because § Destroy on disposal ties a node's
destruction to its creating owner rather than to being detached. A node cannot be added with a sentence and no component, or a component
and no sentence. Five prop types are the DOM kit's, imported as types rather than rewritten:
`ButtonProps`, `InputProps`, `SelectProps`, `PickerProps` and `MentionTextareaProps`. Four of the
hand-written copies had quietly lost a prop by the time anything compiled both sets together.

A control is a stop, and on this host that has to be built rather than inherited. A `<button>` on the
DOM is focusable, draws a ring, and raises a click on Enter; a cell renderable does none of the three.
`apps/tui/src/keys/stops.ts` supplies all three in one call: `pressable(box, options)` sets the
`focusable` flag the store reads unless the control is disabled, binds `activate` to the handler in
`focus` target mode so Enter on a button inside a row belongs to the button, and adds the press half
of the click the pointer model allows, the store's hit test being the focus half. Its companion `stop(options)` returns the `ref` a component hands its
box and a `focused()` accessor, because a `ref` callback cannot return a signal. The layer sits at
priority 42, above a collection's 40: both layers match when focus is on a control inside a row, and
at equal priority `@opentui/keymap` falls back to registration order, which is the reconciler's
business and not something to depend on. The number between them is the typing shadow
(§ The five key groups).

What a focused control draws is `litControl` in `apps/tui/src/kit/roles.ts`: `strong` in the `accent`
tone, and nothing else about its characters changes. That is the caret's equivalent for something that
presses, and the reason `apps/tui/src/kit/render.tsx` reads the frame back as coloured runs as well as
characters. A focused `[Save]` has the same six characters as an unfocused one, so a test that only
reads characters cannot see focus at all.

Colour comes from `apps/tui/src/appearance.ts`, which collapses a theme's forty-odd tokens to the
terminal's 16 slots plus `dim` and `bold`. `roleCell()` is `roleVar()`'s sibling and returns the
OpenTUI style fragment for a role value, with `ignored` returning nothing. A theme picked in the app
does not reach this host: a theme in acorn is an id whose tokens live in a `:root[data-theme=…]` block
in a stylesheet, and publishing those as data is the appearance layer's change rather than the
terminal's. The default was always the terminal's own palette.

The seven layout components are `apps/tui/src/layouts/`, reaching the pane registry through
`client-core/src/host/layouts/table.ts`, which is host-supplied for the same reason the component
table is.

One guard sat over the renderer, in `apps/tui/src/renderGuard.ts` — deleted by the terminal rewrite,
and in the git history — installed beside it in `main.tsx` and in the test harness. OpenTUI reads a node's size straight from yoga, and a node that joins the tree
after a frame's layout pass has no measured size: the width comes back `NaN` and the frame hands it to
the Zig side, which takes a `u32` and throws "Argument 3 must be a uint32" from inside the render loop.
That ends the process. It lasts one frame and hits any node with a border or a hit box, so no single
node can own the fix — `list-detail` mounts its divider when the list region arrives, and a `Card`
mounts on every turn of the agents transcript, which is how switching to a workspace whose task opens
that pane killed `acorn`. The guard clamps an unmeasured size to one cell, and goes the day OpenTUI
clamps its own.

The clamp lands before a resize handler runs, not after, because `updateFromLayout` calls that handler
while the raw yoga numbers are still stored on the node. `ScrollBox` reads its own height there to size
its bar, and one `NaN` reading is permanent: its scroll position clamps itself through `Math.max(0, x)`,
which keeps returning `NaN`, so the content node's translate never recovers and the whole subtree draws
at the wrong screen position. A scrollbox beside a region that measures its own box, which is what
`Sections` does at 120 cells, drew its column's content off screen for good.

Nothing may write to stderr while the renderer owns the terminal, because stderr is the file it draws
on and a stray line leaves the shell reading as garbage until the next full repaint. OpenTUI's own
console is deactivated for the overlay it pops, and `main.tsx` holds Node's process warnings in a set
and prints them after `renderer.destroy()` hands the terminal back. One warning this host provokes is
worth naming rather than holding: every live `scrollbox` subscribes to the renderer's `selection`
event, and a pull request draws well past Node's default ten listeners, so `RENDERER_LISTENER_CAP`
raises that ceiling. `ScrollBox.destroySelf` unsubscribes, so the count is a count and not a leak, and
the cap is raised rather than removed so a real runaway still trips it.

### Rectangles

`Rectangle` is the kit's one admission that a pane needs pixels, and it has four kinds. On this host:

- **`pty` is native.** `attachPty(handle, io)` on `@acorn/plugin-api/ui` takes the channel — open at a
  size, bytes in, bytes out — and the host draws the emulator: an xterm on the DOM, OpenTUI's in
  cells. The caller's source is the same file either way, which is what let Docker's exec panel and
  the editor's `$EDITOR` window cross at about fifteen lines each. The terminal plugin's own drawer
  surface keeps its xterm, because its options are a theme, a font size, a WebGL renderer and a
  Shift+Enter rule, none of which means anything in cells ([terminal.md](./terminal.md) § Client).
  The bytes reach the rectangle as bytes: `term:out` is the one channel on the node's socket that is a
  binary frame rather than JSON, and the broker in this process hands it straight to the client
  ([terminal.md](./terminal.md) § The screen, and who pays for it). A `pty` rectangle also takes
  `hidden`, which draws the box and takes it off the screen so a tab strip over several of them keeps
  every emulator and every channel alive; `entered` asks the screen rather than a flag, so a hidden
  rectangle stops taking the keys with nothing else being told.
- **`editor` draws its box and says the file opens there.** The `$EDITOR` handoff needed nothing
  built: the editor pane already has a terminal mode where one device preference swaps CodeMirror for
  a throwaway PTY running the reader's own editor on the worktree, and that PTY lives on the node, so
  in cells it simply draws ([editor.md](./editor.md) § Editing in your own editor). A read-only text
  view with a find bar inside the box is not built.
- **`webview` and `frame` draw their `<Fallback>` child**, or a line naming what is missing.

`Rectangle` itself is `absent` in the support matrix, because this host recognises the kind and draws
natively rather than handing an element back. The `rectangle` extension kind — a sibling region an
iframe fills — is absent entirely.

### Loose text under a box

A run of text must have a `text` parent here, and on the DOM a bare string anywhere is a text node
nobody thinks about. It is the one structural difference between the hosts, and it belongs to the host
rather than to the caller: `<Stack>{count()}</Stack>` is correct kit, and a plugin has no way to know
which of its two readers will refuse it.

**`apps/tui/src/kit/reconciler.ts` answered it once**, for everything — deleted by the terminal
rewrite, and in the git history. It was `@opentui/solid` re-exported with `insert` replaced, aliased into the Solid transform's `moduleName` so every JSX call
in the process passes through it, and it wraps a bare string or number in a `text` when the parent is
a box. An empty string becomes nothing, which is what the DOM draws for one.

It was not always one place. `cells.tsx` answers the same question three times — `flatten` for a node
that draws a line, `hasNode` to ask which it is, `slot` for a child that lands in a box — and each of
the seventy-six kit nodes had to reach for the right one. That is a convention, not a guarantee, and
four crashes in one week came through the gaps in it, wearing four different values: a count beside an
icon, a pending `lazy()` resolving to `""`, a remote tree's text node, a plugin's own row. None of the
three helpers covered the chrome, the layouts, the tree host, or a plugin's tree, none of which are
kit.

The failure mode is what made it worth fixing at the boundary rather than per node. The refusal comes
out of `insertNode` deep inside a signal write, and an exception there aborts the whole update pass —
so every other reader of that signal is left un-notified, the screen stops following, and nothing says
why. One bad child read as "the router does not work" for an afternoon.

Two notes on the seam. `insert` and not `insertNode`, because OpenTUI builds its renderer from a
node-ops object and exports neither it nor `createRenderer`, so the function that throws cannot be
replaced — but everything reaches it through `insert`, which is exported. And the wrap follows nested
accessors, because a value can arrive from deeper than the first read: a `lazy()` is a memo inside the
memo `insert` was handed.

The three helpers stay. They are how a node says what a run of text *means* — its role and its tone —
and the reconciler only says where it may live. A `Suspense` round a `lazy()` stays too, for the same
reason: it decides what shows while a chunk loads, which is a question the reconciler does not answer.

**What this does not forgive.** A component type this host has no renderable for. `<main>` from a DOM
component is still "Unknown component type", and it should be: that is a surface on the wrong host,
not a shape the DOM absorbs.

### Destroy on disposal

The reconciler's second replacement, and the worse of the two bugs it ends. OpenTUI destroys a
renderable one `process.nextTick` after it leaves the tree, and that tick always runs before any
promise settles. Solid's `Suspense` removes its children when it suspends and hands the *same
instances* back when it resolves — its children memo is created once, which is the whole reason
suspending is cheap on the DOM. Put the two together and any boundary that has shown content and then
suspends again is gone for good: children removed, destroyed a tick later, refused on the way back in
("was already destroyed, skipping add"), and the panel is blank until the process exits. Reading an
uncached query's `data` is a suspension — even a disabled query suspends for one microtask, and one
microtask loses to the tick — so the shapes that hit it were the ordinary ones: the caret landing on a
pull whose detail had not loaded, a browse window sliding onto rows whose queries had not run.

**The fix is that removal no longer decides destruction; disposal does.** `createElement` ties every
node it makes to the reactive owner that made it. Detached with a live owner means a `Suspense` may
hand the node back, so it is kept. Owner disposed — a `For` row dropped, a `Show` flipped, a route
change — destroys on the next tick if the node is still detached. Attached teardown (the renderer
destroying its tree child-first) still destroys promptly. This is what the DOM gives Solid for free —
removal detaches, garbage collection destroys — restated in a runtime with explicit destruction. A
node created outside any owner keeps OpenTUI's prompt destroy.

The test that pins it is `apps/tui/src/browseSlow.test.tsx`, and its fixture knob matters as much as
the assertion: a transport that answers in a microtask can never hold a `Suspense` open across the
destroying tick, so the zero-latency fixture passed every browse test while the app drew blank
panels. `ACORN_FIXTURE_DELAY_MS` is how a test reaches the shape the app lives in. The same change
retired the liveness guards that grew around the symptom — a destroyed edit buffer read from a live
effect cannot happen any more, because an owner's effects are disposed before its nodes are
destroyed. The override matches `@opentui/solid`'s 0.5.9 lifecycle, so an OpenTUI upgrade must run
`browseSlow.test.tsx` before removing or changing it.

One residue on purpose: `main.tsx` deactivates OpenTUI's console overlay the way the harness always
has, because a single stray library warning drawing over the frame reads as the whole app failing,
and the terminal's scrollback after quit is where a log line belongs.

### Unknown nodes and failed trees

Three behaviours, the same on both hosts. A node type this build cannot draw renders as a labelled
placeholder. So does a failed slot. And there is one error boundary per tree. On this host all three
draw as an `Alert` in `warn` tone. A new node name from a newer plugin is a placeholder and a roster
row, never a crash.

### What the TUI never does

- Read the terminal width inside a node or a layout. Breakpoints are the renderer's, and a layout asks
  "am I narrow" of its own region.
- Draw a hover state, drag, or open a pointer context menu. Pointer input is limited to focusing a
  clicked viewport/control and wheel or trackpad scrolling; the keyboard remains the complete path.
- Accept `class`, `style`, or a DOM attribute. The type-level test refuses them and the tree protocol
  drops them on the wire.
- Invent a node. A pane that needs something the kit lacks asks the kit, and the kit answers for both
  hosts or refuses for both.
- Shrink to make room. Yoga answers a height deficit by taking it out of every child that will give,
  and a one-line row given half a line lands on the line above it. Every block node and every row
  refuses to shrink, and the region around them clips or scrolls. A `scrollbox` around the whole pane
  is still refused with the reason in `apps/tui/src/chrome/PaneRow.tsx`: its free-sized content breaks
  width-sensitive layouts. Constrained document/detail viewports own scrolling instead.

## The router

`apps/tui/src/kit/router.ts` is one module-level path signal and the five hooks a pane asks for. It
matches with `matchRoute`, which is client-core's and is what the source registry already resolves a
path with, against core's three patterns and every pattern a source contributed. So the two hosts
cannot disagree about what `/p/:projectId/pulls/:number` means.

It used to be inert — no params, no match, and a navigation that did not happen — on the argument that
there was nothing behind it to answer. That was right during the pane sweep, where an honest blank
column beat a plausible wrong one. It stopped being right when browse became a surface a reader drives
from the shell, because a browse surface carries its project and its open item in the path and nowhere
else: the GitHub surface reads `params.projectId` to decide it has a repository at all, and its list
opens a pull by navigating to it. With an inert shim under both, that surface drew "Select a project"
for ever.

Three details are load-bearing.

`useParams` answers a **proxy**, not an object. Every caller reads a field inside a derivation after
calling `useParams()` once in setup, so the reactivity has to be in the property access; an object
built at call time resolves once and never changes, which is the inert shim in a better disguise.

**Order decides a match.** Core's patterns come first, then the contributed ones in the order they were
declared, which `sourceRouteContributions` already sorts. That is what puts `/p/:id/pulls/new` in front
of `/p/:id/pulls/:number`, and it is why a route contribution carries an `order` at all.

**The query string is still absent.** Carrying it would be a few more lines and no caller needs them:
the surfaces that keep view state in the query on the desktop already pass `router: false` here.

What a path *means* is not in that file. `apps/tui/src/chrome/routing.ts` holds the shell's reading of
it — open the task a path names, move the rail to the source that claims it, and keep the path on a
project the open workspace has — because the router is aliased as `@solidjs/router` and every plugin in
the graph imports it, so it must not reach into the chrome. That is the separation `keys/regions.ts`
keeps when it takes a pane cycler rather than importing the shell.

## Keys and focus

[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) § Focus and typing owns the
intents, the four layer tiers, and the two rules a host with no pointer adds. What follows is the
mechanism.

### The adapter

`apps/tui/src/keys/install.ts` builds the engine from `apps/tui/src/keys/keymapHost.ts`, this
package's own `KeymapHost`, where the DOM host builds `createDefaultHtmlKeymap(root)` from the
package's own adapter. Eleven of the host's thirteen members are `@opentui/keymap`'s OpenTUI adapter,
delegated to unchanged, and two are ours: `getFocusedTarget` returns the region store's focused node,
and `onFocusChange` subscribes to the store. That is the whole of the difference and it is the
difference that matters — the package's adapter answers `getFocusedTarget` with whichever renderable
the renderer has focused, so a layer bound to the node the *store* said had the keys did not fire
while the renderer disagreed, and that disagreement is what the navigation fixes in this client's
history were about (§ Focus regions).

`client-core/kit/keys/keymapHost.ts` holds the engine at the widest type pair the engine allows and
hands each host's pair back at the one call that reads it, rather than being generic over a pair
every caller threads through: every caller in the kit means the DOM's, and forty components would
have gained two type parameters to say nothing new. One host-supplied predicate crosses instead,
"is somebody typing", which is the only question a binding asks about the focused thing.

Chords are spelled with `ctrl` here. The engine reports the platform's primary modifier, which on
macOS is `super`, and a terminal emulator keeps Cmd for itself and never delivers it, so `commit` was
a chord nobody could press. `setKeymap` takes a `primary` and this host passes `ctrl`.

Spelling it `ctrl+return` is half the answer, and `main.tsx` asks the terminal for the other half:
`createCliRenderer({ useKittyKeyboard: { disambiguate: true } })`. A legacy terminal sends one byte,
`\r`, for Return with Ctrl held and Return without it, so `commit` does not reach the engine as a chord
at all. The `disambiguate` flag of the kitty keyboard protocol is what makes the two distinguishable,
and it settles a lone Escape the same way, which the parser otherwise has to wait out. A terminal that
does not know the request ignores it, and the mode is popped on exit either way. Both test harnesses
ask for the same protocol, because a suite driving a different keyboard from the app is testing a
different keyboard.

### The five key groups

Every key is an intent before it is a key (`client-core/kit/keys/intents.ts`). Where an intent lands
depends on the thing that has the keys, and an intent bubbles: the innermost thing that can answer
does, and a handler returning `false` passes it on.

| Group | Keys | In a collection | On a parent stop | On a plain stop | On a viewport with no stops | Bubbled to the region tier |
| --- | --- | --- | --- | --- | --- | --- |
| Move | `↓` `j` / `↑` `k` | next/previous row, wrapping as `collectionIntents.ts` says | Down enters the panel the strip is showing; Up leaves for the previous stop | next/previous stop in reading order within the panel, revealed in every viewport around it; an edge is a wall | scroll a fifth of a page | nothing |
| Cross | `→` `l` / `←` `h` | `expand`/`collapse`, which a tree answers and a horizontal collection moves; a plain list and a leaf bubble | the next/previous tab; an edge bubbles | bubbles | bubbles | one column left or right, landing on that column's last-used region, no wrap |
| Act | `⏎` `space` | activate the row, then enter main where the region says so | nothing | press: `onPress`, a toggle, a `Select`'s list, an `Input`'s submit, an entered rectangle | nothing | nothing |
| Back | `esc` | the parent stop if a panel holds the collection, else the region's home | the region's home | the parent stop, else the region's home | the region's home | a notification clears, else the climb the shell's topology names |
| Page | `pgup` `pgdn` `home` `end` | `pagePrev`, `pageNext`, `first`, `last` on the collection | scroll the viewport around it | scroll the viewport around it | scroll | nothing |

**A cross key has one meaning per level and one at the bottom.** A handler that changed nothing
returns `false`, so the key carries on down: a tab strip at its last tab, a tree row that is a file,
a plain list with no fold. What waits at the region tier is the column move, and it is the only thing
`h` and `l` mean there — so Left with nothing to the left goes one column left in every control on
the screen. That is a reversal: a tab-strip edge used to be a wall, on the grounds that a failed Left
threw the reader back into the rail unexpectedly. The surprise was smaller than the inconsistency,
which was one key with five meanings and two of them silent. The footer says `column` where that is
what the key will do, so the reader is told before they press it.

Two keys sit at the screen level and never bubble. Tab and Shift+Tab cycle every region on screen in
declared order and wrap, and the pane chords cross the column edge before they switch the pane. Both
are in § Navigation.

`ctrl+⏎` is `commit` and submits the `Composer` or `Input` that has the keys. It is typing-exempt, so
it fires from inside the text, and a `Composer`'s submit button is also a plain stop that Down
reaches, for a reader who does not know the chord.

While an `Input` or `Textarea` has the keys, bare keys type. The move, cross and page groups go inert
except `↑` and `↓` inside a multi-line `Textarea`, which move the cursor. Escape leaves the field for
its parent stop or the region's home, which is how a reader gets out of a composer without sending.
Tab, Shift+Tab, `ctrl+⏎` and the pane chords all work from inside a field.

**Typing is a layer, not a matcher.** That paragraph used to be said once per binding, as
`active: () => !isTyping()` on every bare key of every control on screen. It is said once now, by a
layer at the `TYPING` tier that binds the bare keys while a field has them and is unregistered when it
loses them (`apps/tui/src/keys/install.ts` § The typing shadow, `apps/tui/src/keys/tiers.ts`). Its
bindings claim the key so that nothing below the tier answers, and carry `preventDefault: false` so
the key still reaches the field and is typed. That is the same shape as a `Modal`'s key claim — a
scope, not a swallow (§ Traps) — with one difference: a scope is pushed by the box that is drawn, and
the shadow follows the region store's focus signal, because "is the focused thing a field" is a fact
about focus and the store is the only truth about that (§ Focus regions).

The key still has to reach the field, and the dispatcher hands it over rather than leaving that to the
renderer. `Renderable.focus` installs a handler that calls the renderable's own `handleKeyPress`, and
the renderer runs those after every ordinary listener and only while nothing has called
`preventDefault` — so typing used to work because the renderer happened to have focused the same
field. `apps/tui/src/keys/install.ts` § typeInto is one ordinary listener after the engine's: where no
binding claimed the key and the store's focused node is a field, it calls `handleKeyPress` itself and
then claims the key, so the renderer's own route cannot type it a second time. An OpenTUI edit
buffer's `handleKeyPress` reads the key and its own suspend trait and nothing else, which is what
makes the hand-off possible, and `apps/tui/src/kit/kit.test.tsx` types into a field with the
renderer's caret on another renderable to keep it that way.

The reason it is a layer is a number. `@opentui/keymap` 0.5.9 caches the answer to "what is live right
now" only while no registered layer, command or binding carries a runtime matcher, and the counter is
global, so one such binding turned the cache off for the whole process — and the footer asks that
question on every render (§ The footer). On a browse screen 48 bindings carried the matcher during
ordinary navigation; the count is zero now. The command layer follows the same rule for the same
reason: its bindings are filtered where they are built rather than gated where they fire
(`apps/tui/src/keys/commandLayer.ts`).

The tier is the whole of the design and it sits between the collection's 40 and a stop's 42.
Everything at or below it is a layer that reaches a focused field from somewhere else — the collection
around it, a viewport's page keys, the screen's own column moves, the command layer's bare keys — and
each has to go quiet while somebody types. The two tiers above it are bound to an exact renderable by
focus, and a field is never the renderable they are bound to, with two deliberate exceptions that want
their key while somebody types: the suggestions list under a `MentionTextarea` and the Down and Escape
that leave a descriptor source's filter field. A `MenuList` wants the same thing and cannot have it at
its own tier, because its arrows sit *below* the collection on purpose, so it registers a second pair
above the shadow while a field inside it has the keys — a layer that comes and goes, like the shadow
itself.

### Focus regions

`apps/tui/src/keys/regions.ts` keeps the DOM host's contract and replaces every mechanism in it. It
describes five levels and nothing else:

```text
Screen
└─ Column           0 the rail, 1 the pane, 2 a second frame        right/left cross, no wrap
   └─ Region        Menu, Browse, Tasks, the pane strip, a layout's own regions   Tab cycles them
      └─ Parent stop   a strip that owns panels                    Down enters, Escape returns
         └─ Stop    a row, a control, a viewport holding no other stop
```

A region is registered by its layout with its id and its order, from the layout's own knowledge of
its regions rather than from `compareDocumentPosition`. **Focus is a value the store holds, and
nothing else has an opinion about it.** One signal says which renderable has the keys, one function
writes it — which region that puts them in and what the region should remember are written in the
same place — and everything that moves the keys goes through `focusRenderable`, which decides and
reports whether they went. It used to be the other way round: focus was OpenTUI's and the store a
view of the renderer's `focused_renderable` event, so in the gap between the renderer moving focus on
its own and the view catching up the two disagreed. A lit border with dead arrows was that gap, and
about 40% of this client's commits were repairs of it.

One thing still goes out to the renderer and it is paint rather than focus. `EditBufferRenderable`
draws no caret unless the renderer has focused it, so the store mirrors its own answer with one
`renderable.focus()` in `paintCaret` and never reads it back. `apps/tui/src/invariants.test.ts` counts
the calls: one `focus`, one `blur`, both in that mirror, and no source file outside a test asks the
renderer which renderable has the keys.

The mouse is a hit test rather than a focus event. The renderer resolves which renderable a left click
landed on and bubbles it up to the root; the store walks up from there to the nearest thing that could
hold the keys and focuses that through its own door, and a click with nothing focusable above it moves
nothing. `autoFocus` is off wherever a renderer is built — `apps/tui/src/main.tsx` and both test
harnesses — because with it on the renderer walks up from the same click and focuses the first
focusable ancestor itself, which is a second opinion about focus for exactly the case one owner is
for.

Entering a region lands on its first parent stop, else its first collection row, else its first stop,
else the region's own frame, walking OpenTUI's retained tree depth first. The middle step is this
host's own: on the desktop a reader arrives with a pointer and clicks what they meant, and here the
first thing focused is the thing the bare keys drive, so landing in a filter box would mean `j` types
a `j`. A landing on the frame is never remembered — the list that arrives a moment later is what the
next walk into the region finds. Without that rule a reader who looked into Browse before choosing a
source came back to a lit border, no caret, and arrows that did nothing, for the rest of the run.

**A strip with panels is a parent stop.** `markParent(node, panels)` marks one, where `panels()`
returns the boxes whose subtrees it owns. From outside it is one stop: `left`/`h` and `right`/`l` walk
it without wrapping and an edge bubbles to the column move, `down`/`j` enters the panel it is
showing, `up`/`k` is the previous stop beside the strip rather than one of the strip's own tabs, and
Escape from anything inside that panel returns to it. A strip that owns
none, such as GitHub's Open/Closed pull filter, is an ordinary control, so Browse still opens on its
rows and Up/Down reaches the collection. The strip is a sibling of its panels rather than an ancestor,
so walking up from a control never reaches it: the panel box is what the walk reaches, and the panels
list is the edge that carries the rest of the way.

Which panels a strip owns is drawn rather than passed. A `TabPanel` registers its own box under the
`idPrefix` it already carries and a `Tabs` reads the set under the same prefix, so a plugin that draws
the two halves in sibling components gets the behaviour without knowing about any of this — which is
how Linear's issue view, Rollbar's item view, Docker's two strips, the HTTP panes and the editor's
side strip all came to have it. `idPrefix` is the pairing because the DOM kit already requires it on
both nodes to build the `aria-controls` ids, so it is a relation the kit promises rather than one this
host invented. The `tabs` layout frames its panel with `Panel` instead of a `TabPanel` and registers
it under its own `stateKey`. `DocumentTabs` is not a parent: the document an editor tab opens is the
layout's region below the strip, not a panel the strip owns, so it is a horizontal collection —
`←`/`→` open the next document, Enter re-opens the current one, Delete closes it.

**Arrows move between stops.** `down`/`j` and `up`/`k` on a control go to the next stop beside it in
reading order and reveal it in every viewport around it. The neighbours are the stops of the panel the
control is in, or of its region where no panel owns it, and an edge is a wall: an arrow never crosses
a region, because Tab already does that and a strip that did it surprised readers. `stopsIn` is the
walk, depth first over the retained tree, and each of its rules is a level of the model showing
through. A parent stop counts once and its panels are skipped, since a panel is the level below and
Down is the way in. A collection counts once, drawn as the row its caret is on. A scroll viewport is
transparent while it holds a stop and is the stop itself otherwise. Anything else focusable counts
once. `moveStop` answers false for whatever the walk does not own, which is how a row hands the arrows
back to its collection and a document with no controls keeps them for scrolling.

**The store is indexed, and the lists it keeps are for ordering.** Every question here is asked inside
a walk of the retained tree: `stopsIn` asks of each child whether it is a region, a parent stop, a
collection or somebody's panel, and `regionOf`, `parentOf` and `boxAround` ask the same of each
ancestor. Each of those was a scan of a module-level array, and `isPanel` was a scan that allocated a
panel list per parent per question, so a key press cost the number of renderables in the region times
the number of regions on screen. They are a `Map` from box to region, a `Map` from node to parent stop,
a `Map` from box to collection, and one `Set` of every panel on screen; the arrays stay, because
ordering is what they are good at, and `ordered()` — the region cycle — caches its sorted answer until
a region registers or a scope moves. The panel set is derived from the same `panels()` getters
`parentOf` reads rather than written beside them, so there is still one answer to "is this a panel"
(`apps/tui/src/keys/regions.ts`, `apps/tui/src/kit/grouping.tsx` § registerPanel). A move asks
`stopsIn` once and hands the list to the walk, where it used to ask twice.

**One deferred decision.** A focus decision that needs a renderable the current render has not
produced yet waits in `ensureFocus`, queued at most once per turn by `scheduleSettle`. A microtask
rather than a frame event, because a test renderer under `flush()` may render several times before a
frame, while Solid commits synchronously and every renderable of the current render exists at the end
of the current task. `apps/tui/src/invariants.test.ts` holds the folder to one `queueMicrotask` and
the kit to none.

A tree to read is the whole of what the microtask buys. It orders nothing against the reconciler's
`process.nextTick` destruction, which exists for `Suspense` (§ Destroy on disposal) and is no longer
load-bearing for focus: a scope popping takes the keys out of the box that is going rather than
waiting to be told, and nothing in the pass depends on a node that has been disposed still reporting
itself live.

**One question.** Can the renderable that has the keys still hold them, and is it the real thing
rather than a stand-in? Holding them means alive, visible, visible all the way up to the root, still
`focusable`, and inside the top scope. The walk up the parents is the half that matters, because
OpenTUI's `visible` is per node: the shell hides the main row behind an overlay and a `TabPanel`
hides the tab that is not showing, and a focused descendant of either goes on saying it is visible. A
stand-in is a region's own frame while that region has an entry stop, or a collection's container
while that collection has a live active row. Both are `focusable` so that they can hold the keys when
nothing else can, and both stop being the right answer the moment their contents arrive. If the
answer to the question is yes, the pass reveals the stop in the viewports around it and stops.

**Four steps if the answer is no.** A scope holding the keys takes the stop it last had, then the
first stop inside its box, then the box itself, which is `focusable` from the push. On the screen the
same four steps run with a region in front of them: the region that still claims the keys, else the
region the shell opens on, else the first one drawn; and inside whichever of those answers, the stop
it last had, its entry stop, its frame, which is `focusable` from registration. A remembered stop
resolves by collection identity first, because a query refresh redraws the same logical row as a new
renderable, and a stand-in is never restored.

**Hiding a subtree asks for a pass.** Two boxes here hide what is inside them rather than unmounting
it, so that the rail and the pane behind an overlay keep their queries and their models and a tab
that is not showing keeps its state: the shell's main row, and the `ScrollViewport` that a `TabPanel`
is. Hiding raises nothing anybody can hear and `visible` is per node, so each schedules a landing
pass when its flag goes false and the pass does the rest, since it already walks the parents before
it decides who can still hold the keys. Without that the keys stayed on a node behind the
overlay: invariant 6 was false of a hidden subtree, and an entered rectangle on a tab that had been
switched went on eating every key in the app.

**A region and a scope each remember their own stops, and one focus move writes one memory.** A
`Modal` or an open `Menu` is drawn inside whichever region held the keys. A region that also
remembered the dialog's rows would hand the keys back to a destroyed row when the dialog closed
instead of to the trigger that opened it, and its claim would say the reader had changed region while
they were answering a dialog. So handing the keys back needs nothing recorded when a scope opens: the
scope remembers where they were inside it, the region behind it still remembers its own last stop,
and closing a `Select` drawn inside a `Modal` comes back to that `Select`.

**The shell installs what the keys cannot know.** `setTopology` takes three answers and
`setPaneCycler` takes a fourth, both from `chrome/Shell.tsx`: where Escape goes from the top of a
region, which region takes the keys when the screen first has any, which regions a first crossing into
a column passes over, and what "the next pane" means when only one is drawn. No chrome id is spelled in
the keys module. It used to find Browse by comparing its id to a string, and the pane strip by
comparing another, which is how a module whose own header forbids reaching into the shell came to
depend on it anyway.

The region cycle is the whole screen rather than the focused pane: the registered rail panels, the
pane strip while a task makes it visible, the pane's own regions, and back. Browse keeps its frame for
layout stability when a component-only source is selected, but registers no region without a list;
neither it nor the absent strip becomes an empty Tab stop. The desktop draws several panes side by
side and Tab into the next one would surprise; there is no next one here. The chrome orders itself
around the pane by declaring orders outside the range a layout uses. `nextPane` first honours the
rail/main edge in its direction; once focus is already in main and there is no further column, it
switches which task pane is drawn.

Regions also declare a column, as an integer counted left to right. Menu, Browse and Tasks pass 0;
the pane strip and every layout or source region default to 1; a layout that draws two frames side by
side declares the second one 2, which `list-detail` does for its detail and
`frame-beside-document` for its frame. A bubbled `expand` (`right`/`l`) moves to the nearest column
to the right and a bubbled `collapse` (`left`/`h`) to the nearest on the left, restoring the last
group used there and never wrapping. Left in the rail and Right from the rightmost column do nothing,
deliberately: a key that jumps across the whole screen from an edge is a surprise, and Tab already
cycles. One rule therefore crosses the rail-to-pane edge and the list-to-detail edge alike. It was a
pair, `rail | main`, and a pair could not say that two frames inside one pane are two columns: every
region a layout registered was `main`, so Right in a `list-detail` pane had nothing to cross to and
did nothing at all. A first crossing into the pane's
column passes over the pane strip and enters the pane itself, because the strip is a line above the
pane rather than a place to work. Collections and layouts keep first refusal: a tree that can expand,
or a narrow `list-detail` that can switch groups, consumes the intent before the region tier. Escape
from a source detail returns specifically to Browse, and from a task pane to the pane strip, because
the shell says so rather than because something remembers the last rail panel visited. Spatial
movement is disabled while an input owns the keys.

### Collections

The intent half of `collection.ts` is shared. The element half has a DOM file and
`apps/tui/src/keys/collection.ts`, where "focus the active item" is a call to the store's own
`focusRenderable`. A virtual
`Rows` owns the visible window: keyboard movement reveals the active key by the smallest amount, and
wheel movement changes the window without changing that key. `Grid` keeps its documented exception:
a virtualised row has no renderable, so the arrows move `selected` and the view follows.

`Timeline` is the exception that goes the other way. `focusRoles.ts` calls it a collection and the DOM
host roves over its turns; here a turn is a `Card`, and a card is a stop only where it takes an
`onPress`. So the stops in a pull request's conversation are the controls and composers inside the
turns rather than the turns themselves, and nothing roves. A reader moves through them with the arrows
and reads the text between with the page keys, which is what every other document here does.

**Moving the caret selects.** Every `Rows` on this host passes `selectOnMove`, which
`collectionIntents.ts` already had and only `Tabs` and `Select` used. It is this host's own answer and
the same kind of departure as opening a region on its list: with no pointer the caret is the selection,
and a reader arrowing down a list of pull requests is asking to see them.

Only `onSelect` fires on a move. `onActivate` still waits for Enter, so showing something is immediate
and opening it stays deliberate, which is the split `pick` and activate already draw. A list that
supplies no `onSelect` — the task list is one — gets nothing new. Arriving on a row is ordinarily not
a move. Menu and Browse opt into one narrow exception at their region boundaries: entering either
runs the collection's ordinary `goTo` for the row it lands on, including when that row arrives after a
query. Menu waits until the provider and workspace-link gates have both answered, then highlights and
shows the first available source together. Its collection place is scoped by workspace, and a
workspace switch clears the old view before publishing the new roster, so the first visit cannot
inherit a detached or non-first row. Browse highlights and shows its first item. Re-entering a
remembered row is idempotent.

### Scrolling viewports

Anything that can outgrow its box is a viewport. `overflow="scroll"` is not one: it is a yoga
clipping instruction, so it hides what will not fit and owns no offset for anything to move. It looks
like a scroll right up to the moment the caret walks below the fold and nothing follows it, which is
what eight of the nine plugin lists used to do. A region body that can grow past its frame is a
`ScrollViewport` or a `Rows virtual`, and `apps/tui/src/kit/scrolling.tsx` is the one file under
`apps/tui/src` allowed to spell the clip. `apps/tui/src/invariants.test.ts` greps for that, because a
clip reviews well.

`apps/tui/src/kit/scrolling.tsx` is the non-virtual viewport seam. It draws a constrained OpenTUI
`scrollbox`, which owns the vertical offset, visible scrollbar, wheel/trackpad acceleration and
clamping. Panels opt into it for document/detail bodies; hidden tab panels keep their own offsets.
The viewport itself is the fallback focus stop for a document with no controls. When it contains a
row, textarea, rectangle or other real stop, it is transparent to focus and a focused child is
revealed through every scrollbox ancestor with `scrollChildIntoView`.

A viewport whose `visible` flag goes false asks for a landing pass, because a `TabPanel` is this node
and hiding a panel raises nothing anybody can hear (§ Focus regions).

A page key clamps rather than wrapping. `pageNext` goes to the last row and `pagePrev` to the first,
and each hands the key back once the caret is already there, so the viewport below the collection
scrolls instead. This is in the shared `collectionIntents.ts`, so the desktop keeps the same rule:
PageDown on the last row of a list stops. The arrows still wrap, because a list you cannot fall off
the end of is a list you never have to look at.

The reveal runs twice. Once synchronously on every focus move, and once more on the renderer's next
`frame` event, from the one renderer listener `apps/tui/src/keys/regions.ts` installs beside its click
hit test. The second one exists because `scrollChildIntoView` compares a child's laid-out `y` against
its viewport's, and `Renderable.y` is whatever the last completed layout pass left there: for a row
that did not exist in the previous frame the first reveal reads stale or zero geometry, scrolls by
the wrong delta, and nothing corrects it. A reader meets that three ways, and all three are common:
a region entered on a freshly mounted list, a refetch replacing a row by identity, and a virtual
window shift. It is not a landing rule and decides nothing about where the keys go; it only makes the
viewport show where they already are.

Phase 1 of the terminal rewrite meant to delete the second half and let the landing pass do the
revealing, on the grounds that the pass runs after Solid has committed. It cannot: the pass is a
microtask, so it runs before the next layout and reads the same stale geometry the first reveal did,
and `apps/tui/src/kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted`
fails without it. It stays for as long as this renderer draws. Under the painter phase 3 of that
programme built there is one reveal, on the frame event, because a frame there is layout and then
paint in one function and the geometry the reveal reads is the geometry the reader is about to see
(docs/future/terminal-rewrite/phase-3-widgets-and-the-pty.md).

Arrows move and page keys scroll, which is the one sentence the footer has to be able to say
everywhere. Arrow keys and `j`/`k` scroll a viewport only while the viewport itself has the keys, and
it has them only where the document holds no other stop. `pgup`, `pgdn`, Home and End scroll it from
anywhere inside it, so a reader on a control halfway down a long panel can see the rest of the panel
without giving up their place. A collection inside the viewport answers those four first, so Home in a
list still goes to its first row. A long description with a copy button at the top is therefore read
with the page keys and the wheel: `↓` lands on the button and stops there, because the text between
two stops is not a place the keys can be.

The diff pane is the third shape, and it is a viewport with a window inside it. `DiffPane` in
`apps/tui/src/kit/showing.tsx` used to build one `<text>` per line of every file, which for a
five-thousand-line patch is five thousand renderables in a pane that shows twenty. It keeps its rows as
one flat list — a file's header is a row in it, so an anchor is an index — and draws the slice around
the viewport's offset with a box above and below standing in for the rest. The spacers are what keep
it a `ScrollViewport`: the scrollbox still owns the offset, the bar, the wheel and the page keys, and
it is still the focus stop a document with no controls needs. The offset reaches the window two ways,
because the viewport raises an event for one of them and not the other: its own key handlers call an
`onScroll` the pane passes in, and the wheel is caught on a box *around* the viewport, where OpenTUI's
mouse walk delivers it after the scrollbox has already moved. The known ceiling is that a spacer is one
line per row and an annotated row draws two, so the content is as many lines taller than the model as
there are marked rows inside the window.

Virtual `Rows` deliberately do not sit inside that mechanism: they render only their visible slice,
so there is no offscreen child for a native scrollbox to move. Their own `top` offset handles wheel
input and draws the custom thumb. A wheel can move the active row offscreen without changing
selection; the collection container temporarily keeps the keys, and the next keyboard move reveals
and restores the active row. This division keeps document scrolling native without replacing the
large-list virtualizer or putting a free-sized scrollbox around an entire pane.

### Traps

A trap is a scope, not a swallow. `apps/tui/src/keys/regions.ts` keeps a stack of them. The bottom
is the screen, which contains everything, and a `Modal` or an open `MenuList` pushes its own box
while it is drawn. Every question the store answers is answered inside the top scope and nowhere
else: which regions are on screen, which stops a walk can see, where Tab goes, where Left goes.
Nothing behind the top scope exists as far as the keys are concerned, so a key that has nothing to
reach does nothing. A stack rather than one box, because a `Menu` inside a `Modal` is a second scope
over the first and closing it must leave the modal still holding the keys.

That leaves `keys/trap.ts` with one layer, for `dismiss` at tier 60. It is global rather than bound
to the overlay's box, because a layer with a target only fires when focus is inside it and Escape has
to close the dialog from anywhere. The palette's own arrows sit one number above it, since a palette
is a text box steered with the arrows and the bare keys are inert while somebody is typing.

**A swallow cannot work.** The layer this replaced bound every intent but `dismiss` to a handler that
returned true, and that means naming every key it swallows. The moment its table differs from the
table something else binds, the difference is a key that leaks. That is exactly what happened:
`trap.ts` read the shared `keysFor()`, where `nextRegion` is `f6` alone, while `keys/install.ts`
binds `hostKeysFor()`, which adds `tab` for this host. So Tab was swallowed nowhere, walked the keys
onto a rail row behind the plugin trust prompt, and the swallow then ate everything but Escape. The
one key the footer advertised was the one that broke the dialog. A scope names nothing and has
nothing to leak.

Two more things follow from the rule. The command layer's bare keys, `w`, `p`, `n`, `q` and `?`,
fire only at the screen's own depth, so a reader who presses one inside a dialog does not get a
picker over the top of it. Chords stay live at every depth. And the footer has to ask the store
rather than the engine, because the region layer's Tab is still registered inside a dialog and the
engine still reports it live, so `activeHints()` shows the `tab region` hint only while more than one
region is in scope.

**Taking the keys is the other half, and pushing the scope is both.** `Modal` calls `pushScope`
from its own box's `ref` and pops it in `onCleanup`, so a dialog contains the keys, lands them on its
first stop by being drawn, and gives them back to the renderable that had them when it closes.
Landing them used to be the caller's job, and the six callers in `apps/tui` all remembered. The
helper was this app's, though, and a plugin only has the kit, so every modal a plugin drew trapped
the keys and left them where they were. A dialog that swallows what the reader presses and never
receives it is worse than one that does not open.

### The Rectangle contract

A rectangle is one tab stop from outside. Enter hands the keys to what is inside, Escape takes them
back. A `pty` rectangle owns its keys by intercepting rather than by holding a layer, because a layer
answers keys it can name and a rectangle answers all of them: `PtyRectangle` registers an intercept
above every layer and consumes what it takes. Keys reach the emulator through `encodeKey`, not through
the emulator's own handler, because the emulator only takes keys when the renderer has focused it and
here the box holds the focus so Enter and Escape belong to the rectangle.

**Being entered is a fact about the screen, not a flag anybody keeps.** A rectangle is entered while
the reader has pressed Enter since the box last lost the keys, the box has the keys now, and the box
is on screen all the way up to the root. The intercept asks all three of those at the moment a key
arrives, so there is nothing to go stale. The one thing stored is the Enter, and the store's own focus
signal clears it: something else taking the keys and the box going off screen are two different ways
to lose them, they used to raise a renderer event and nothing respectively, and one signal is both.

It used to be a flag set by Enter and cleared by Escape or by unmounting, and neither of those
happens when a subtree is hidden without being unmounted. `visible` is per node in OpenTUI, so hiding
an ancestor blurs the ancestor and leaves the rectangle's box reporting itself focused and visible.
Both of this app's ways of hiding a subtree do exactly that, the shell's main row behind an overlay
and a `TabPanel` that is not showing, so a rectangle nobody could see went on consuming every key in
the app, `Ctrl+C` included, because the intercept sits above every layer there is. It kept them until
the reader found the tab it was on and pressed Escape at it.

The footer asks that same question of every rectangle that is mounted rather than counting the ones
that are entered. Two can be mounted at once, a task with a terminal pane beside a docker exec, and
a count was the thing that could disagree with the screen: the second one leaving decremented a
number the first one still held, and a hidden one never decremented at all.

Escape alone leaves. A second Escape within 400 milliseconds goes back in and sends one. There is no
pending window on the first press, because holding it to see whether a second arrives would put a
delay on every exit, and this is already the one key rule the desktop does not have. Leaving moves
the keys through `focusRenderable` like every other move, so the region the rectangle sits in sees
them come back to its door.

### The footer

The footer lists the intents the focused thing accepts with their primary keys, read off the keymap's
active layers. Nothing is declared twice. `activeHints()` reads the signals that move them: where the
keys are, whether an overlay has taken them, how many regions are in scope, whether somebody is typing,
and the engine's own `state` event, which fires when focus moves and when a layer is registered or
unregistered. Without those the footer is whatever was true at the render that happened to build it.

The list is cached against exactly those five, because the footer draws whenever anything on the screen
does — a terminal frame, a toast, a task list arriving — and building it walks every active layer. A
keyboard-free redraw costs nothing now, where it used to cost two full collects. Two, because the plain
list and the descriptions were separate calls; `includeMetadata` enriches the same keys rather than
choosing different ones, so it is one call.

The words come from a table in `bindings.ts` with one row per kind of focused thing, because the same
key promises different things in different places and a reader on a Merge button should not be told
Enter opens something. `focusedKind()` asks the region store which kind has the keys, in this order:

| What has the keys | `j`/`k` | `enter` | `h`/`l` | `ctrl+enter` |
| --- | --- | --- | --- | --- |
| A field, meaning an `Input` or a `Textarea` | move | press | type | send |
| A row of a collection | move | open | fold, or column | commit |
| A parent stop, meaning a strip showing a panel | `j` enter | press | tab | commit |
| A stop that opens a list, meaning a `Menu` trigger and so every `Select` | move | open | column | commit |
| A viewport holding no other stop | scroll | press | column | commit |
| Any other stop | move | press | column, or move | commit |

A `Menu` says which it is by passing `opens` to `pressable`, and nothing else in the kit does yet. The
order is a priority: a field is a stop too, and a viewport is only ever a stop while it holds none.

The `h`/`l` column is the one the kind alone does not settle, so `words()` resolves it from two
questions the store answers. A collection that was given an `onExpand` folds and says `fold`; one
that was not declines the intent, which bubbles, and says `column`. A stop that answers `expand` and
`collapse` itself is a horizontal collection drawn as one stop — `DocumentTabs`, `SegmentedControl`,
a chip row — and says `move`, because the pair moves inside it and never reaches the column. The
footer said `fold` for every kind before that, which was true of one of them. A field's bare keys
type, so their layers are inactive and the engine never reports them live; the words in that row are
there for the table's sake and the footer draws the chord alone.

While a PTY is entered the footer says `esc leave · esc esc send escape`. `?` opens the cheat sheet as
a modal with the same hints and a sentence each, and the footer itself is not a focus stop: it is a
label with nothing to drive, and a stop that does nothing is a hole a reader falls into.

### Seeing what the keys did

`ACORN_TUI_KEYS_TRACE=1` writes one line per key to `keys.log` under the XDG state directory
(`$XDG_STATE_HOME/acorn/keys.log`, else `~/.local/state/acorn/keys.log`):

```text
17:08:29.001 key=f6      reason=binding-handled    focused=BoxRenderable#box-72 region=pane/body scope=overlay:2 steps=11
17:08:29.492 key=enter   reason=intercept-consumed focused=BoxRenderable#box-91 region=pane/body scope=screen    steps=0
```

The parsed key, what answered it and why, the renderable that had the keys, its region, how many
overlays deep the keys are, and how many renderables the store walked to answer. There used to be an
`agree` field beside those, for whether the renderer and the store agreed about where the keys were,
and it is gone with the second owner it was watching (§ Focus regions). It is
a `key:after` intercept in `keys/install.ts`, which runs once per key after dispatch and claims
nothing; the hyphenated `key-after` is not a hook name and registers nothing at all. Registered
without `release`, or every keystroke would log twice.

Two lines are a bug wherever they appear. `reason=no-match` on a key the footer offers is the footer
lying. `region=none` while the screen has regions means nothing owns the keys. The line quoted first
above is a third: the region layer answered Tab while an overlay held the keys, which is how a dialog
comes to be on screen and unanswerable.

The line ends with `steps=`, which is how many renderables the store's walks visited answering that
key. It is the number the focus model is supposed to bound: it should track the depth of the tree the
keys are in and not the number of rows in the region, so a `steps` that grows with a list is a walk
that has started scanning something. The counter is in `apps/tui/src/keys/regions.ts` and is off unless
this flag is on, because a counter nobody reads is a branch on every node of every walk.

The log is an appending stream opened once rather than an `appendFileSync` per key. The second thing
this flag is for is measuring, and a synchronous open, write and close on the loop that draws is a
trace that measures itself.

This is the first thing to turn on when somebody says the keys stopped working.

### The invariants

Eleven sentences about the keyboard, each one a test rather than a scenario. A scenario pins one
path, and every bug the fourteen focus fixes chased was a path nobody had written a scenario for.
`apps/tui/src/reachability.test.tsx` walks every stop on eight surfaces, which are the browse rail,
the six panes the pane sweep opens, and the cheat sheet as an open dialog. It asks five of these
after every press, so a new pane or a new control joins the property the day it lands.

| # | The invariant | Where it is checked |
| --- | --- | --- |
| 1 | Every stop a region declares is reachable from the keyboard. | `reachability.test.tsx`, against `_allStops()` |
| 2 | Every stop acts: focusing it and pressing Enter calls the handler. | `kit/kit.test.tsx` § every control is a stop |
| 3 | One caret. At most one `›` is on screen and it marks what has the keys. | `reachability.test.tsx`, after every press |
| 4 | Escape is bounded and ends in the rail. | `reachability.test.tsx` § escape is bounded |
| 5 | One deferred decision: `queueMicrotask` appears once in `keys/` and never in `kit/`. | `invariants.test.ts` |
| 6 | Focus never sits on a corpse. | `reachability.test.tsx`, after every press |
| 7 | No chord this host cannot press: `super+` is spelled only where it is rewritten. | `invariants.test.ts` |
| 8 | The footer tells the truth: the word beside a key is what that key does there. | `reachability.test.tsx`, against the word table |
| 9 | There is one focus value, and it names a node that is in the tree and can hold the keys. | `reachability.test.tsx`, after every press. Made structural by the one owner: `setFocusedNode` appears once, `.focus()` and `.blur()` once each and both in the caret mirror, no source outside a test asks the renderer what has the keys, and `focusable =` appears only where `invariants.test.ts` allows it. |
| 10 | Focus is inside the top scope: with a dialog open, no key moves the keys out of it. | `reachability.test.tsx`, after every press on the overlay surface |
| 11 | A claimed key changed something. A handler that changed nothing returns `false` and the key bubbles. | `reachability.test.tsx` § crossKeys, which presses `h` and `l` on every kind of focused thing the walk met and asks whether the footer's word came true |

Two of them changed on contact with the build. Invariant 3 also promised one lit control, and it is
not checked: focus draws `strong` and `accent`, and so does an active tab label, so a span count
cannot tell the two apart and a test that cannot tell fails on a passing screen. Invariant 4 promised
`depth + 1` Escapes, counting the parent stops above the caret; that is short by the region chain,
which on a task pane is two more hops — the pane's region climbs to the strip and the strip climbs to
Tasks. The bound the test uses is the parent stops plus the chain `chrome/topology.ts` names.

The walk itself is Tab major and `↓` minor: inside whichever region has the keys, Down until the caret
stops moving, then Tab to the next region. A failure names the surface, the size and the line it could
not reach, and pressing the same keys in the same order puts the same thing under the caret. Right
and Enter are not in the walk, because what the property is over is `stopsIn` per region and a panel's
contents are the level below.

### What must never happen

- A second keymap, or key handling in a component. Every key goes through `@opentui/keymap`'s layers.
- A node that handles `ArrowDown`. Nodes handle `next`.
- Focus state a node owns. The host owns it on both hosts.

## Chrome

`apps/tui/src/chrome/` draws the shell around the panes, which on the desktop is bespoke DOM rather
than kit. [ui-design.md](./ui-design.md) § Shell hierarchy has the two hierarchies side by side.

### The screen

Left to right and top to bottom: one topbar line, a column of three framed panels, the active pane in
the rest with a strip of pane labels above it, one footer line.

The three panels are Menu, Browse and Tasks, read down the screen. Menu is the browse sources this
workspace has, which the desktop draws under a rule below its task list. Browse is what is under the
chosen one — the source's own `list` region, drawn here rather than inside the surface it belongs to.
Tasks is the tasks in the workspace. With no explicit task or source, the screen opens on the first
available Menu source after its provider and workspace-link gates have loaded, with focus on the same
row. Switching workspace clears the old task/source and repeats that defaulting pass for the new
workspace; closing the picker restores focus by region when the old row was replaced. An explicit
`--task` path still opens in Tasks. `ctrl+b` hides the whole column.

The column takes about a third of the shell's width, between a floor of 20 cells and a ceiling of 34,
which is the shape `list-detail` uses to size its own list column. A fixed number could not be right at
both ends: thirty reads well at 120 and leaves the agents session list clipping its own titles at 80.
So at 80 columns the pane is 54 and every pane in the roster inherits that — well under `list-detail`'s
own 80-cell threshold, which means one group at a time with `expand` switching between them.

**Frames, one level deep.** Each panel is a box with its name in the top border, drawn in the accent
tone while the keys are inside it, in `apps/tui/src/panel.tsx`. Each layout puts one round every region
it holds, and nothing wraps a frame round something that already has one: a frame costs two rows and
two columns, and at 24 rows the body has 22 to spend. `header-body-footer`'s pinned strips stay bare
for the same arithmetic — a frame round one line of content is three rows of chrome.

**A panel is a place on the screen, not a wrapper round a list.** A growing panel takes the room left
over rather than the room its contents want, so a Browse list of forty pull requests cannot push the
Tasks panel off the bottom of the screen. What is inside it either clips or scrolls. A `Rows` marked
`virtual` is handed its height by the panel, draws only the rows that fit, and puts its own scrollbar
down the right edge. A non-virtual document/detail body uses OpenTUI's native scrollbox and scrollbar.
The virtual window holds still until the caret walks off an edge, then follows by exactly as much as
it has to; wheel input can inspect another part of the list without moving the caret.

**A row clips, it does not squeeze.** A `text` is a box to yoga, so a row of them at a width they do
not fit is a row of boxes each shrunk and each cutting its own content: `[ST]` drew as `[ST`, the gaps
between the fields closed up, and the one-cell caret column shrank to nothing, so a focused list
looked exactly like an unfocused one. The parts of a row now give up cells in an order — the trailing
controls first, then the meta, then the title down to sixteen cells, and never the caret or the
leading glyphs. Past that the row runs off the right edge and the frame cuts it. In a 28-cell rail
that means a pull request reads as its number and its title, and its timestamp is simply not there.

The name in the border is the string the DOM host puts in a region's `aria-label`, and the lit border
is what `:focus-within` does to a region's edge there. Same two facts, one rendering each. The lit
border is read off the focus signal rather than from OpenTUI's own `focusedBorderColor`, which needs
the box to be `focusable` — and a focusable frame is a stop in the cycle, so a region holding another
frame would open on the frame instead of on the list inside it.

There is no collapse to a strip of marks below 100 columns any more. It only ever said anything because
every row carried a glyph, and most of those glyphs drew nothing: a source's glyph is a Lucide name,
this host has no brand marks at all, and `Icon` draws a name it has no character for as nothing. The
rail's leading icons went with it. `ctrl+b` is the one way to lose the column.

### A descriptor source's list

A plugin contributes a rail source in one of two ways, and only one of them shipped with a terminal
answer. A compiled plugin hands over a component, which is kit and draws here. A plugin that
contributes by manifest hands over a *descriptor*, and the host draws the list — through
`ChromeSourcePanel`, which is `<main class="panes">` around `<section>`s and the DOM kit's primitives.
The chrome registry named it directly, so selecting Linear or any other descriptor source in `acorn`
handed the reconciler a `main` and it refused.

`client-core/host/chrome/sourcePanel.ts` is the seam, and it is the third of exactly this shape after
`KIT_COMPONENTS` and the layout table: the host package supplies its own and the DOM's is the
fallback, so nothing on the desktop moved. It hands back a whole contribution rather than a component,
because the two hosts do not put the halves in the same place — the desktop draws one surface across
the window, and this host puts the list in the Browse panel and the detail in the main one.

`apps/tui/src/plugins/SourcePanel.tsx` is this host's. Everything that is not drawing is imported
rather than rewritten: `readRailItems` and `chromeKey` are the query, so both hosts share one cache
entry; `runChromeAction` is what a row press does; and `projectSurfaceRegistry` is what the detail is,
which is the same surface the desktop draws beside its own list. Two things are left out and they are
omissions rather than gaps in the seam: the create-task menu on a row, and the dashboard panels beside
the list. Each is a surface of its own on this host and neither is what a rail list is for.

The title filter is here. `/` — the `search` intent, so `Ctrl+F` reaches it too — puts the keys in a
field above the rows, what is typed narrows the list by title, `↓` goes back to the rows and `Escape`
leaves the panel. The field is drawn only once there is a list to filter, and that is a focus rule
rather than a tidy one: entering a region lands on its first collection row, else on its first stop, so
a field above an empty list takes the keys the moment the panel opens and `j` types a `j`. The two
walks out of the field differ on purpose — `↓` walls at the last stop so a filter matching nothing
leaves the caret where it is, and Escape does not, so the same reader can still climb out. The filter
is per source and goes when the source does, because a source change unmounts the panel.

The source-panel factory is keyed by `(pluginId, descriptorId)`. Chrome contribution resyncs update a
signal holding the current descriptor and return the same `regions.list` and `regions.detail`
functions. `Dynamic` therefore updates labels and descriptor props in place instead of treating a
roster/trust refresh as a new component and remounting the list, which would discard its caret,
virtual window and query subscriptions.

### What is drawn bespoke

The rail's task list goes through the same `rail.taskList` exclusive slot the desktop's does, so a
plugin that offers to replace it replaces it on both hosts. `ExclusiveSlotHost` is host-supplied like
the component table, because the DOM's copy reaches for `Dynamic` from `solid-js/web` and pulling that
in would put a second Solid renderer in the graph to render one child. The arbitration rule in
`exclusiveSlots.ts` is shared unchanged. The topbar and the pane strip are bespoke until the
client-plugins programme gives each a contract.

The palette is a `Modal` over the same session the desktop's runs on
(`client-core/host/registries/commands/session.ts`). The query, the order, the cursor, the frame stack
and what Enter does are that object's; this host binds keys to it, draws its rows and prints its
breadcrumb, and fetches and invokes nothing itself. The session is built in `chrome/Shell.tsx` rather
than in `chrome/Palette.tsx`, because the component is mounted only while the overlay is up and a
shortcut aimed at a group has to be able to open it.

It does not use the kit's collection: a collection's keys are bare keys, a bare key does not fire while
something is being typed into, and in a palette something always is. So the arrows are bound above the
trap and the session owns the cursor they move. Escape is the single way back — it pops a frame, and
at the root it closes, which is the `Modal`'s `onDismiss`.

An overlay takes the whole screen under the topbar, and hides what is there rather than replacing it.
It is a sibling of the rail-and-pane row in `chrome/Shell.tsx`, not a child of the pane column: an
overlay belongs to the screen, and mounted inside the column it drew in the pane's width with the rail
still beside it, which read as one more panel rather than the thing being asked. Opening the palette
must not tear down the rail and the pane behind it and throw away their queries and their models, so
the row is `visible={false}` while an overlay is on top, the same thing `TabPanel` does for a hidden
tab. `visible` is yoga's `display: none`, so the row gives up its height and the overlay takes it.
`pushScope` in the region store is this host's answer to the DOM palette's `prevFocus`.

Notifications are the same `toast()` store the desktop's `ToastHost` draws, so `bridge.ui.toast` and
every plugin that calls it lands on a line above the footer. They never take focus.

**The count and the inbox.** The topbar's right edge carries `◔ N` in the warn tone when something
is waiting, and nothing when nothing is. It is the number the desktop's bell puts on its pill and on
the app icon — unread notices plus the rows in the attention inbox — and it gets here the same way it
gets onto the dock: `trackBadge` calls the platform seam's `setBadge`, and this host's `notify` group
writes the signal the topbar reads (`apps/tui/src/kit/notify.ts`). One number with one meaning on
both hosts, and [notifications.md](./notifications.md) owns what goes into it.

`n` opens what is behind it. `apps/tui/src/chrome/Inbox.tsx` is the bell's two sections — "Needs you"
and "Notifications" — as an overlay, because there is no popover here and the column has no room for a
fourth panel. It reuses the bell's data and not its component: the same `createAttentionInbox`
fan-out and the same notice ring, drawn as one collection rather than two so that `j` and `k` walk the
whole thing. Two collections inside a modal would leave the second unreachable, because a dialog is
a scope with no regions in it and `nextRegion` has nowhere to go. Enter switches node if the row belongs to another one, opens the task, and
dispatches the row's target through the same handler table the desktop uses.

**Asking the terminal to notify.** An unseen notice reaches `initSystemNotices`, which is the same
channel the desktop raises an OS banner from; here the seam writes an escape sequence and the
emulator decides. OSC 9 for iTerm2, Ghostty, WezTerm and Warp, OSC 99 for kitty, OSC 777 for rxvt,
wrapped in a tmux DCS passthrough with every ESC doubled when `TMUX` is set, and title and body
stripped of anything that could end the sequence early. A terminal on none of those lists gets the
BEL and nothing else. `ACORN_TUI_NOTIFY` is the switch, in the `ACORN_TUI_OSC52` pattern: `off`,
`bell`, `terminal`, or `both`, which is the default. There is no settings page here to hold it.

Whether the terminal is the window the reader is looking at comes from DEC 1004: the renderer emits
`CliRenderEvents.FOCUS` and `BLUR`, `apps/tui/src/main.tsx` feeds them to `setHostFocused`, and the
gate's seen rule reads them. Unknown counts as focused, so a terminal that never reports stays quiet.

### Navigation

`Tab` and `Shift+Tab` cycle regions, beside `F6`, which is what the DOM host spells the same intent
because the browser owns Tab. The cycle reads down the screen: Menu, Browse when it has a list,
Tasks, the pane strip when a task is open, then the pane/source regions. `right`/`l` crosses from the
rail to main and `left`/`h` comes back; neither wraps. `Ctrl+Option+Right` and
`Ctrl+Option+Left` take the same spatial edge before they cycle a task pane, so the advertised pane
chord works from Menu, Browse, and Tasks. In a rail list, Up/Down and `j`/`k` move; `Enter` performs the
row's ordinary activation and then enters main. An overlay or entered PTY keeps first refusal on
Escape. A tabbed detail adds one deliberate level: `left`/`right` (or `h`/`l`) choose a tab, `down`/`j`
enters its controls, and Escape returns to the tab strip. Moving a focused control beyond the viewport
reveals it automatically; mouse wheel/trackpad input scrolls the viewport independently.

Escape climbs one level each press, and where it goes at the top of a region is the shell's to say
rather than the keys module's. `apps/tui/src/chrome/topology.ts` is the whole of it, and it is the one
file in the chrome that names a region by string anywhere but where it declares one. A source detail
goes to the Browse list it came from, or to the Menu row that chose the source when the source draws no
list of its own. A task pane's own regions go to the strip above them, and the strip goes to the Tasks
list the task was opened from. From the rail there is nowhere further left, so Escape falls through to
the shell's own layer and clears a notification instead. The same file says which region takes the keys
when the screen first has any — Tasks when the session opened with a task and no source, Menu otherwise
— and which regions a first crossing into a column passes over, which is the pane strip and nothing
else.

`w` switches workspace and `p` switches project, both through an overlay, because that is the shape
that takes the keys off whatever had them. Neither restores what you were looking at. Both schedule a
settle, so the caret lands on the first row of the roster that replaced the old one rather than on
whatever survived the switch. The command chord opens the palette from anywhere except an entered PTY.

A pane opens with the keys already somewhere, because there is no click to put them there. And a
region opens on its list where it has one rather than on the first field above it, because the first
thing focused is the thing the bare keys drive and landing in a filter box means `j` types a `j`.
Menu and Browse also select the row they open on; other regions only focus it. Which source a
workspace opens on is one derivation in `apps/tui/src/chrome/model.ts`: the first source the Menu
actually draws, once both gates behind that list have answered. The Rail reads it and draws. It used
to be an effect in the Rail, and the shell and the Rail agreed about the answer only because one of
them waited for the other.

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

### Reserved regions

A pane that reserved a `pane.footer` or a `pane.aside` is wrapped by the frame registry, and until the
wrapper became a seam that wrapper was the DOM's: a `div` around an `aside` holding a `PanelGrid` sized
in pixels. Registering such a pane here handed the reconciler a `div` and it refused, so the pane threw
rather than drawing — the same failure the descriptor rail list had, and the same fix.
`client-core/host/chrome/extendedPane.ts` is the seam, `apps/tui/src/plugins/ExtendedPane.tsx` is this
host's answer, and `App.tsx` installs it beside `setLayouts`, `setRemoteTree` and `setSourcePanel`. It
draws the reserved regions under the owner's own tree in reading order: a terminal pane is one
rectangle, and there is no second column for an aside and no row to spare for a strip that is empty
most of the time.

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

A plugin writes no terminal UI, declares no `tui` surface, and learns nothing about the host. What
crosses is decided here, and the table below is the whole of it: one row per cooperative extension
kind and per host UI slot, what the desktop does with it, what this host does, and where the answer
lives.

| Kind or slot | Desktop | Terminal | Where the answer lives |
| --- | --- | --- | --- |
| `rows` (`pane.footer`) | A strip of rows under the pane's frame | A `Rows` collection at the end of the pane, one per contributor, headed by its label and the contributing plugin's id | `apps/tui/src/kit/host.tsx` § `ExtensionRows`, drawn by `apps/tui/src/plugins/ExtendedPane.tsx` |
| `annotation` | Marks inside the diff row, under the code | The same marks on the line below the code, indented past the gutter | `apps/tui/src/kit/showing.tsx` § `AnnotatedDiffLine` |
| `remote` (a `Slot`) | The contributor's tree, in the owner's surface | The same tree, in the same place, drawn from the same batch | `apps/tui/src/kit/host.tsx` § `Slot` |
| `rectangle` (`pane.inline-*`) | Another plugin's iframe | One muted line naming the point | § Rectangles |
| `hook` | Runs on the node | Runs on the node | Nothing to draw on either host |
| `pane.aside` | A dashboard grid the user composed, beside the pane | One muted line naming the point | [future/dashboards/README.md](./future/dashboards/README.md) |
| `rail.taskList` (exclusive slot) | The replacement draws in place of core's list | The same, through the same arbitration | `apps/tui/src/chrome/slot.tsx` |
| `overlay`, `drawer`, `task.footer`, `task.switcher.extra`, `topbar.*` | Host UI slots a plugin fills | Not drawn | [future/client-plugins/04-replaceable-surfaces.md](./future/client-plugins/04-replaceable-surfaces.md) |

The last row costs five first-party registrations: github's pull-file palette, the editor's file
palette and onboarding's first-run screen all take `overlay`; the terminal plugin takes `drawer`; and
docker takes `task.footer`. The terminal's overlays are a fixed set the shell draws and its drawer is
the rail, so giving a plugin those places is a contract for both hosts rather than a component for
this one.

**A contribution is as reachable as the nodes it draws.** A contributor that draws a `Button` inside a
`Slot` is a stop, reached with `↓` from the strip above it and pressed with Enter, inside the region
its host registered. A contributor that draws only `Text` is not a stop, and `↓` walks past it. The
kit decides which is which, on both hosts, and a plugin cannot say otherwise (`focusRoles.ts`).

**A plugin's own chord is pressed with Ctrl here.** A manifest chord is `meta+ctrl+alt+shift+key` and
`meta` is the platform command key, which a terminal emulator keeps for itself. The command layer
rewrites the leading `super` to `ctrl` for every chord (§ Keys and focus), so a plugin that declared
`meta+shift+p` is pressed as Ctrl+Shift+P, and one that declared `meta+ctrl+alt+shift+d` is pressed as
Ctrl+Option+Shift+D. Nothing in the manifest changes.

What a *reader* loses beyond that is one row per plugin in
[first-party-plugins.md](./first-party-plugins.md) § What each of these loses in a terminal, and it is
short. The whole workspace crosses except three rectangles, and the rectangle that defines an agent
workspace, the PTY, is the one a terminal does best.

A `Card` that takes an `onPress` is one stop and the walk does not go inside it, so a pressable card
with its own controls in it reaches the card and nothing else. No first-party pane draws one; a card
that holds controls holds them instead of a press.

Two things nothing draws yet rather than draws worse. There is no settings surface, so the four
plugins that register a settings page contribute nothing through it, and `workflows` contributes
nothing at all. And the rail's drawer sources are the rail's browse sources, not the terminal plugin's
profiles.

## Tests

[testing.md](./testing.md) § Test layers owns the tiers. In short: one case per kit node against a cell
buffer, one per layout drawn from its projection, a twin of client-core's `keys.test.tsx` against the
terminal adapter, a pane file that opens every first-party pane at exactly 80 by 24 and asks whether
the thing the pane is for is on the first screen, a chrome file that drives the whole shell, a
reachability file that walks every stop on seven surfaces and checks four invariants after every
press, and five files that need no renderer and never skip: the focus invariants that are facts about
the source, the palette's collapse to 16 slots, the clipboard
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
- **Pointer actions beyond scrolling and focus.** Drag, hover and context menus stay keyboard-driven.
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
- **A device preference store.** There is no `localStorage` here and `writeDevicePref` is a no-op, so
  every device-scoped setting the desktop holds is either a default or an environment variable on this
  host — the notification switches among them (`ACORN_TUI_NOTIFY`). A file-backed store under the
  TUI's config directory would let the Notifications settings page work here as it does there.
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
