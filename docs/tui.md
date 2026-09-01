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

Six aliases in `apps/tui/vite.config.ts`, mirrored in the package's `tsconfig.json` paths. That is
the whole of what makes a compiled pane draw in cells:

- `@acorn/plugin-api/ui` resolves to `apps/tui/src/kit/ui.ts`, this package's kit. A pane imports the
  kit through that facade and nothing else.
- `@acorn/plugin-api/ui/host` resolves to `apps/tui/src/kit/host.tsx`: the palette chrome, the drawer,
  the reference-panel box and the two cooperative-extension nodes, whose DOM copies are portals and
  `<ul>`s.
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
matrix, and both hosts' tables. A node cannot be added with a sentence and no component, or a component
and no sentence. Five prop types are the DOM kit's, imported as types rather than rewritten:
`ButtonProps`, `InputProps`, `SelectProps`, `PickerProps` and `MentionTextareaProps`. Four of the
hand-written copies had quietly lost a prop by the time anything compiled both sets together.

A control is a stop, and on this host that has to be built rather than inherited. A `<button>` on the
DOM is focusable, draws a ring, and raises a click on Enter; a cell renderable does none of the three.
`apps/tui/src/keys/stops.ts` supplies all three in one call: `pressable(box, options)` sets the
renderer's `focusable` flag unless the control is disabled, binds `activate` to the handler in `focus`
target mode so Enter on a button inside a row belongs to the button, and adds the click-to-focus-then-
press the pointer model allows. Its companion `stop(options)` returns the `ref` a component hands its
box and a `focused()` accessor, because a `ref` callback cannot return a signal. The layer sits at
priority 41, one above a collection's: both layers match when focus is on a control inside a row, and
at equal priority `@opentui/keymap` falls back to registration order, which is the reconciler's
business and not something to depend on.

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

One guard sits over the renderer, in `apps/tui/src/renderGuard.ts`, installed beside it in `main.tsx`
and in the test harness. OpenTUI reads a node's size straight from yoga, and a node that joins the tree
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

**`apps/tui/src/kit/reconciler.ts` answers it once**, for everything. It is `@opentui/solid`
re-exported with `insert` replaced, aliased into the Solid transform's `moduleName` so every JSX call
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

Spelling it `ctrl+return` is half the answer, and `main.tsx` asks the terminal for the other half:
`createCliRenderer({ useKittyKeyboard: { disambiguate: true } })`. A legacy terminal sends one byte,
`\r`, for Return with Ctrl held and Return without it, so `commit` does not reach the engine as a chord
at all. The `disambiguate` flag of the kitty keyboard protocol is what makes the two distinguishable,
and it settles a lone Escape the same way, which the parser otherwise has to wait out. A terminal that
does not know the request ignores it, and the mode is popped on exit either way. Both test harnesses
ask for the same protocol, because a suite driving a different keyboard from the app is testing a
different keyboard.

### Focus regions

`apps/tui/src/keys/regions.ts` keeps the DOM host's contract and replaces every mechanism in it. It
describes five levels and nothing else:

```text
Screen
└─ Column           rail | main                                    right/left cross, no wrap
   └─ Region        Menu, Browse, Tasks, the pane strip, a layout's own regions   Tab cycles them
      └─ Parent stop   a strip that owns panels                    Down enters, Escape returns
         └─ Stop    a row, a control, a viewport holding no other stop
```

A region is registered by its layout with its id and its order, from the layout's own knowledge of
its regions rather than from `compareDocumentPosition`. Focus is OpenTUI's focus and the renderer owns
it. OpenTUI focuses mouse targets itself, and the viewport receiving the click mirrors that result
into the region bookkeeping, because there is no DOM `focusin` event to do it.

Entering a region lands on its first parent stop, else its first collection row, else its first stop,
else the region's own frame, walking OpenTUI's retained tree depth first. The middle step is this
host's own: on the desktop a reader arrives with a pointer and clicks what they meant, and here the
first thing focused is the thing the bare keys drive, so landing in a filter box would mean `j` types
a `j`. A landing on the frame is never remembered — the list that arrives a moment later is what the
next walk into the region finds. Without that rule a reader who looked into Browse before choosing a
source came back to a lit border, no caret, and arrows that did nothing, for the rest of the run.

**A strip with panels is a parent stop.** `markParent(node, panels)` marks one, where `panels()`
returns the boxes whose subtrees it owns. From outside it is one stop: `left`/`h` and `right`/`l` walk
it without wrapping and an edge is a wall rather than an implicit trip to the rail, `down`/`j` enters
the panel it is showing, and Escape from anything inside that panel returns to it. A strip that owns
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

**One deferred decision.** A focus decision that needs a renderable the current render has not
produced yet waits in `settleFocus`, queued at most once per turn by `scheduleSettle`. It runs five
steps in order: re-enter a region whose focused row was destroyed, by the row's logical identity;
open the screen if nothing holds the keys; take the keys off a region that was only holding them for
want of anything better; land in an overlay that opened or restore what one gave back; then reveal
the focused stop in every viewport around it. A microtask rather than a frame event, because a test
renderer under `flush()` may render several times before a frame, while Solid commits synchronously
and every renderable of the current render exists at the end of the current task.

There were six of these and each was a correct fix for a real bug. Together they were a state machine
nobody had written down, and the class of bug they produced was always the same: two of them ran in an
order the author had not pictured, and the reader got a lit frame with no caret or a caret on a
destroyed row. `apps/tui/src/invariants.test.ts` holds the folder to one `queueMicrotask` and the kit
to none.

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

Regions also declare one of two columns. Menu, Browse and Tasks are `rail`; the pane strip and every
layout or source region default to `main`. A bubbled `expand` (`right`/`l`) moves rail to main, and a
bubbled `collapse` (`left`/`h`) moves main to rail, restoring the last group used in the destination
column and never wrapping. A first crossing into main passes over the pane strip and enters the pane
itself, because the strip is a line above the pane rather than a place to work. Collections and
layouts keep first refusal: a tree that can expand, or a narrow `list-detail` that can switch groups,
consumes the intent before the region tier. Escape from a source detail returns specifically to
Browse, and from a task pane to the pane strip, because the shell says so rather than because
something remembers the last rail panel visited. Spatial movement is disabled while an input owns the
keys.

### Collections

The intent half of `collection.ts` is shared. The element half has a DOM file and
`apps/tui/src/keys/collection.ts`, where "focus the active item" sets the renderer's focus. A virtual
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

`apps/tui/src/kit/scrolling.tsx` is the non-virtual viewport seam. It draws a constrained OpenTUI
`scrollbox`, which owns the vertical offset, visible scrollbar, wheel/trackpad acceleration and
clamping. Panels opt into it for document/detail bodies; hidden tab panels keep their own offsets.
The viewport itself is the fallback focus stop for a document with no controls. When it contains a
row, textarea, rectangle or other real stop, it is transparent to focus and a focused child is
revealed through every scrollbox ancestor with `scrollChildIntoView`.

Arrows move and page keys scroll, which is the one sentence the footer has to be able to say
everywhere. Arrow keys and `j`/`k` scroll a viewport only while the viewport itself has the keys, and
it has them only where the document holds no other stop. `pgup`, `pgdn`, Home and End scroll it from
anywhere inside it, so a reader on a control halfway down a long panel can see the rest of the panel
without giving up their place. A collection inside the viewport answers those four first, so Home in a
list still goes to its first row. A long description with a copy button at the top is therefore read
with the page keys and the wheel: `↓` lands on the button and stops there, because the text between
two stops is not a place the keys can be.

Virtual `Rows` deliberately do not sit inside that mechanism: they render only their visible slice,
so there is no offscreen child for a native scrollbox to move. Their own `top` offset handles wheel
input and draws the custom thumb. A wheel can move the active row offscreen without changing
selection; the collection container temporarily keeps the keys, and the next keyboard move reveals
and restores the active row. This division keeps document scrolling native without replacing the
large-list virtualizer or putting a free-sized scrollbox around an entire pane.

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
