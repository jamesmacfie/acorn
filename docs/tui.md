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

Two design records are in git rather than in the tree, and comments in `apps/tui` cite both:
`docs/future/terminal/`, nine phases between 2026-08-30 and 2026-08-31, which is how this client came
to exist; and `docs/future/terminal-rewrite/`, five phases on 2026-09-03 and 2026-09-04, which is how
it came to draw its own cells. Each was deleted the day it shipped. Find one with
`git log --follow -- docs/future/terminal/README.md`, and the same for the other.

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

The floor is the repo's. `node-runtime.json` holds the pin and the range every package here builds,
lints and runs on, `apps/tui/package.json` declares that same range in its `engines`, and `acorn`
needs no flag: the painter is this package's own TypeScript and Yoga arrives as WebAssembly, so
drawing reaches no native library at all.

So the whole suite draws on the Node the repo already has, with no skips and no second runtime to
bundle ([testing.md](./testing.md) § Test layers, [future/bundle.md](./future/bundle.md)).

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

An alias list in `apps/tui/vite.config.ts`, and the entries tsc also has to know about mirrored in
the package's `tsconfig.json` paths. Both, or tsc and the bundle disagree and nothing says so. That
is the whole of what makes a compiled pane draw in cells:

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
- **Three stubs answer packages this host does not install.** CodeMirror's grammars and
  highlight-style half, browser xterm and its two addons, and shiki are each reached only from a DOM
  surface that cannot draw in cells, so `apps/tui/src/kit/codemirrorGrammars.ts`,
  `apps/tui/src/kit/xterm.ts` and `apps/tui/src/kit/shiki.ts` stand in front of their specifiers.
  Every export throws and names the host, because a stub that answers plausibly is how this bundle
  once carried seventeen CodeMirror grammars it could never highlight. Each is a pattern rather than
  a line per package, so a language added to client-core does not become a package this host has to
  install again — and the names still have to exist, because the build links a named import against
  the stub and would rather say so than wait for a reader. Two specifiers are deliberately left
  alone: `@xterm/headless`, which is the `pty` rectangle's own emulator, and `@codemirror/language`,
  which `codemirror` itself depends on and the `editor` pane really does import. A stub may only
  stand in front of a specifier no working surface reaches.
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

Beside the aliases, two build facts. `vite-plugin-solid`'s `generate: 'universal'` sends JSX to the
module named in `moduleName` instead of to the DOM, and that name is `apps/tui/src/tree/renderer.ts`
spelled as its own path rather than as a bare specifier with an alias behind it — one place to look
rather than two. And `__ACORN_HOST__` is `'tui'`, which is what `Only` and `Fallback` read and the
only thing in the kit that asks which host it is on ([ui-design.md](./ui-design.md) § The closed kit).

`apps/tui/src/tree/renderer.ts` is the whole of what Solid drives: the ten node operations
`solid-js/universal` asks for — `createElement`, `createTextNode`, `replaceText`, `setProperty`,
`insertNode`, `removeNode`, `isTextNode`, `getParentNode`, `getFirstChild`, `getNextSibling` — over
the plain objects in `apps/tui/src/tree/node.ts`, plus the `render` and `Dynamic` a Solid host has to
export. Every JSX call in the process lands there, client-core's and a sandboxed plugin's included,
which is why the two rules this host used to need are absences rather than code (§ Rendering).

Anything touching Solid's reactive graph is bundled rather than left to Node, so there is exactly one
copy of it. A second copy is a second graph and a second set of contexts, and it fails as "No renderer
found" from inside a component that is plainly under the provider.

## How a frame is drawn

Four folders under `apps/tui/src/` draw a frame and a fifth answers the keyboard. Nothing above them
knows they exist: client-core, the kit, the layouts and the chrome write JSX and are told nothing.

```text
Solid components                                        unchanged
        │  JSX compiled with generate: 'universal', moduleName → tree/renderer.ts
        ▼
Node tree: plain objects        tree/       what Solid creates, patches and moves
        │  a frame, when the tree changed
        ▼
Layout: yoga-layout (wasm)      layout/     one Yoga node per tree node, rectangles clamped here
        ▼
Paint: a cell buffer            paint/      tree → cells, diff against the last frame, flush
        ▼
Terminal (stdout)               synchronized output, 16 slots or truecolor

Terminal (stdin)
        ▼
Input parser                    input/      bytes → key, mouse, focus, paste, resize
        ▼
One dispatcher                  keys/       tiers → layers → the focused stop, or the typing target
        ▼
Region store owns focus         keys/regions.ts     a value, not a property on a node
```

**The tree.** A node is a `kind`, a props bag, a parent, an ordered children array, a Yoga handle and
the rectangle the last layout gave it. Nothing else: no methods that do anything, no events, no
`destroy`, no focus. The invariant is that the tree is the only retained UI state and only Solid
writes it. Paint reads it, and the only other readers of a rectangle are the two that legitimately
want last frame's size — a layout's own breakpoint, and a `pty` rectangle's `size()`.

**Layout.** `yoga-layout`'s WebAssembly build, loaded once at boot; one Yoga node made in
`createElement` and freed when the owner that created it is disposed, which is what keeps a
`Suspense` from freeing a handle it is about to hand back. `visible={false}` is `DISPLAY_NONE`, so a
hidden subtree costs no layout and no paint. Each frame lays the root out at the terminal's size and
reads the four computed numbers back into every node. The invariant is four finite integers, of
which the width and the height are never negative (§ Rendering).

**Paint.** A buffer of `cols × rows` cells, each a grapheme, a foreground, a background and an
attribute bitmask. Paint walks the tree depth first inside each node's clip rectangle, the previous
frame's buffer is kept, and the flush emits a cursor move and the changed run for every run that
differs, wrapped in `CSI ? 2026 h` and `CSI ? 2026 l` so the emulator applies the frame in one go. A
frame is asked for by an operation on the tree and coalesced to one per turn of the event loop, so a
screen nobody is touching costs nothing. Width is `Intl.Segmenter` for the cluster boundaries and a
table of the East Asian Width `W` and `F` ranges for how wide each cluster is, with an ASCII branch
in front of it (`apps/tui/src/width.ts`); every colour is a slot or, where `COLORTERM` says the
terminal takes it, a 24-bit value. The invariant is that the buffer after a frame is a pure function
of the tree, the rectangles, the focus value and the emulators' own buffers — which is what lets the
harness render the same buffer with no terminal behind it (§ Tests).

**Input.** A parser over stdin bytes: a key with a name, modifiers, text and press or release; a
mouse event; a focus in or out; a paste; a resize from `SIGWINCH`. It asks for the kitty keyboard
protocol on the way in and pops it on the way out, and a terminal that ignores the request gets the
legacy parse — CSI sequences, SS3, the escape timeout for a lone Escape. The invariant is one
`KeyEvent` shape, ours, read by the keymap host, the footer, the `pty` rectangle's encoder and both
harnesses (`apps/tui/src/keyEvent.ts`). The engine is generic over it and never constructs one.

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
`null` fallback either way, which is safe here because a node that leaves the tree is unlinked and
kept rather than destroyed, so a boundary that suspends twice gets the same objects back
(§ How a frame is drawn). A node cannot be added with a sentence and no component, or a component
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
at equal priority `@opentui/keymap` falls back to registration order, which is the engine's own
business and not something to depend on. The number between them is the typing shadow
(§ The five key groups).

What a focused control draws is `litControl` in `apps/tui/src/kit/roles.ts`: `strong` in the `accent`
tone, and nothing else about its characters changes. That is the caret's equivalent for something that
presses, and the reason `apps/tui/src/kit/render.tsx` reads the frame back as coloured runs as well as
characters. A focused `[Save]` has the same six characters as an unfocused one, so a test that only
reads characters cannot see focus at all.

Colour comes from `apps/tui/src/appearance.ts`, which collapses a theme's forty-odd tokens to the
terminal's 16 slots plus `dim` and `bold`. `roleCell()` is `roleVar()`'s sibling and returns the
cell style for a role value — a colour and an attribute bitmask — with `ignored` returning nothing.
A theme picked in the app does not reach this host: a theme in acorn is an id whose tokens live in a
`:root[data-theme=…]` block in a stylesheet, and publishing those as data is the appearance layer's
change rather than the terminal's. The default was always the terminal's own palette.

The seven layout components are `apps/tui/src/layouts/`, reaching the pane registry through
`client-core/src/host/layouts/table.ts`, which is host-supplied for the same reason the component
table is.

A node's size is clamped where it is read back, in `apps/tui/src/layout/pass.ts`, and one function
reads it. Yoga answers `getComputedWidth` on a node it has never measured with `NaN`, and a node that
joins the tree after a frame's layout pass is exactly that for one frame — `list-detail` mounts its
divider when the list region arrives, and a `Card` mounts on every turn of the agents transcript. So
the read-back takes `NaN` to nought rather than to a cell: a zero rectangle paints nothing, which is
the honest answer for a box nobody has measured, and the next frame has the real size. `NaN` is the
marker and zero is not, because an empty auto-sized box and a hidden subtree both lay out at zero
legitimately, so only `Number.isFinite` can ask the question.

A left or a top may be negative and stays that way. An overflowing child under `alignItems: center`
reports a left of -15, and moving that run to column nought would put it where it does not belong —
clipping it is paint's job. So the rule is four finite integers, of which the width and the height
are the two that cannot be below zero.

Nothing may write to stderr while the renderer owns the terminal, because it is the same terminal:
paint writes cells to stdout and nothing else, and a stray line on stderr leaves the shell reading as
garbage until the next full repaint. So `main.tsx` holds three things and prints all of them after the
screen is closed and the terminal handed back: Node's process warnings, in a set because Node repeats
a warning per emitter; a started node's own piped stderr; and every `console` call from the moment the
renderer is created, swapped for a push into the same list and swapped back in `quit` before the first
line goes out. The console hold is not belt and braces — client-core's plugin roster and the agents
plugin's session prime both warn with a stack when a node this run started has not bound its port yet,
which is the one moment there is a shell to ruin. `format` from `node:util` does the rendering, so an
`Error` still prints its stack.

Two rules this host used to have are gone, and both are worth knowing because they were crashes
rather than style. `<Stack>{count()}</Stack>` needed a wrapping `text` node — a bare string under a
box was refused from inside a signal write, which aborted the whole update pass and left the screen
not following anything — and paint now draws a text node under a box as a one-line run, so the shape
is only a shape. And a node used to be destroyed a tick after it left the tree, which blanked every
`Suspense` boundary that suspended twice; `removeNode` unlinks the object and keeps it, so there is
nothing to be already destroyed.

### There is no floating layer, so a panel needs somewhere to be laid out

A terminal has no layer to open over, so `Modal`, `Menu`, `Popover` and `Picker` all draw in flow, and
clipping is unconditional — a child is cut to its parent's content box whatever it asks for
(§ How a frame is drawn). Together those two make one trap worth naming, because it reads as a
rendering bug and is a layout one: a panel opened inside a **row** is laid out in the few cells its
trigger was given. The agents pane header is a `Toolbar` of four controls in about fifty cells, and
its New-session list drew `ClaAv` — a provider's name and its status colliding — so a reader could not
tell what they were choosing.

The answer is one layout prop: an open `Menu` or `Popover` gives its own box a flex basis of the full
width, so the wrap below puts it on a line of its own with the bar's whole width to draw in. That is
what `Popover`'s own sentence in [ui-design.md](./ui-design.md) always promised. Its trigger moves down
to that line with it, which is the visible cost and the honest one: the list sits under the control
that opened it. Outside a row the prop changes nothing, because a box in a column is already the full
width.

**A bar must not re-scope its children, and that is worth a rule.** The first version of this hoisted
the panel instead: `Toolbar` held a signal and a slot under its row, and an open panel was handed up
through a context. Three things were wrong with it, and the third shipped. A Solid signal treats a
function argument as an updater, and JSX here is routinely a function. Children built inside an effect
and inserted somewhere else belong to an owner neither place controls. And a context provider wraps
its children in a memo, so every bar in the app re-ran as a unit whenever anything in it changed —
which is a change of behaviour for a hot path that nothing asked for. The layout prop is the whole
feature with none of that, and `apps/tui/src/kit/kit.test.tsx § a toolbar` holds the line.

The bar itself wraps rather than clips, for the same reason and in the same file. A bar is written for
a window and drawn here in a pane column, and Yoga moves what does not fit onto the next line before
it shrinks anything — so an overfull bar costs a line instead of its words. The gap is the column gap
only; a gap on both axes puts a blank row between the wrapped lines.

### Rectangles

`Rectangle` is the kit's one admission that a pane needs pixels, and it has four kinds. On this host:

- **`pty` is native.** `attachPty(handle, io)` on `@acorn/plugin-api/ui` takes the channel — open at a
  size, bytes in, bytes out — and the host draws the emulator: an xterm on the DOM, `@xterm/headless`
  in cells. Three other packages here already depend on it and the desktop parses the same PTY with
  the same parser, so a program's output reads the same on both hosts. The one thing headless xterm
  has no notion of is a keyboard, so `apps/tui/src/kit/ptyKeys.ts` is the encoder: our `KeyEvent` to
  the bytes a terminal sends, reading application cursor mode and bracketed paste off the emulator's
  own `modes` at the moment a key arrives rather than remembering them. The caller's source is the
  same file either way, which is what let Docker's exec panel and the editor's `$EDITOR` window cross
  at about fifteen lines each. The terminal plugin's own drawer
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

**A companion overlay is the same absence, answered rather than ignored.** A remote tree may ask its
host to present one of its plugin's overlay frames (`docs/plugins.md § Companion overlays`). There is
no iframe here to put one in, and a cell-drawn canvas is not something this project is going to invent,
so `src/plugins/RemoteTree.tsx` answers `overlay.open` with a typed `unsupported_host`. A plugin
catches that code and leaves its static preview up, and the point owner's own fallback is what a reader
sees. The other half of that seam, `owner.invoke`, is host-agnostic and goes through the shared check
in `client-core/host/tree/hostRequests.ts` — what a contributor may ask its owner to do is not a
question about which host is drawing, and a copy of that check here would be a copy that could
diverge.
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
package's own adapter. All thirteen of its members are ours, answered over the node tree and the
region store: the tree walk is a node's `parent`, the key stream is an emitter the input parser
pushes onto, and `getFocusedTarget` and `onFocusChange` are the store's one focus value and the
signal behind it. Three are absences rather than stubs — a node is never destroyed, so
`isTargetDestroyed` is false and `onTargetDestroy` never fires, and there is no raw-input pipe to
prepend to because bytes become events before they arrive.

The engine is what stays, and that is the point of the split: it is pure TypeScript, the desktop
drives the same one through `client-core/kit/keys/keymapHost.ts`, and both hosts on one engine is
how the two adapters cannot drift. What a host owns is the thirteen answers, and the one that
matters is where focus comes from (§ Focus regions).

`client-core/kit/keys/keymapHost.ts` holds the engine at the widest type pair the engine allows and
hands each host's pair back at the one call that reads it, rather than being generic over a pair
every caller threads through: every caller in the kit means the DOM's, and forty components would
have gained two type parameters to say nothing new. One host-supplied predicate crosses instead,
"is somebody typing", which is the only question a binding asks about the focused thing.

Chords are spelled with `ctrl` here. The engine reports the platform's primary modifier, which on
macOS is `super`, and a terminal emulator keeps Cmd for itself and never delivers it, so `commit` was
a chord nobody could press. `setKeymap` takes a `primary` and this host passes `ctrl`.

Spelling it `ctrl+return` is half the answer, and `apps/tui/src/input/terminal.ts` asks the terminal
for the other half in its enter sequence, along with the alternate screen, raw mode, SGR mouse
reporting, DEC 1004 focus reporting and bracketed paste. A legacy terminal sends one byte,
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
| Move | `↓` `j` / `↑` `k` | next/previous row, wrapping as `collectionIntents.ts` says | Down enters the panel the strip is showing; Up leaves for the previous stop | next/previous stop in reading order within the panel, revealed in every viewport around it; the bottom edge is a wall and Up from the first stop of a panel is the strip that owns it | scroll a fifth of a page | nothing |
| Cross | `→` `l` / `←` `h` | `expand`/`collapse`, which a tree answers and a horizontal collection moves; a plain list and a leaf bubble | the next/previous tab; an edge bubbles | bubbles | bubbles | one column left or right, landing on that column's last-used region, no wrap; from inside a panel only the pane's own columns count, and with none that way the strip that owns the panel takes it: the tab changes if it can and the keys land on the strip |
| Act | `⏎` `space` | activate the row, then enter main where the region says so | nothing | press: `onPress`, a toggle, a `Select`'s list, an `Input`'s submit, an entered rectangle | nothing | nothing |
| Back | `esc` | the parent stop if a panel holds the collection, else the region's home | the region's home | the parent stop, else the region's home | the region's home | a notification clears, else the climb the shell's topology names |
| Page | `pgup` `pgdn` `home` `end` `g` `G` | `pagePrev`, `pageNext`, `first`, `last` on the collection | scroll the viewport around it | scroll the viewport around it | scroll | nothing |

**`g` and `G` are `first` and `last`, and they are not this host's own.** They sit in `intentKeys`
beside Home and End, so a desktop list answers them too, and the terminal adds no key for either. A
sequence would be the vim spelling — `g g` for the top — and we refuse it: `g` already means `first`
on its own, so making it a prefix would put a timeout in front of a key that answers instantly today,
and the footer has no way to draw "g then g" in a cell. Nothing else on either host wants a sequence,
and the engine's support for them costs nothing while nothing uses it.

**A cross key has one meaning per level and one at the bottom.** A handler that changed nothing
returns `false`, so the key carries on down: a tab strip at its last tab, a tree row that is a file,
a plain list with no fold. What waits at the region tier is the column move, and it is the only thing
`h` and `l` mean there — so Left with nothing to the left goes one column left in every control on
the screen. That is a reversal: a tab-strip edge used to be a wall, on the grounds that a failed Left
threw the reader back into the rail unexpectedly. The surprise was smaller than the inconsistency,
which was one key with five meanings and two of them silent. The footer says `column` where that is
what the key will do, so the reader is told before they press it.

**A panel is a level, and a bubbled cross key does not skip it.** The strip's Left and Right are
bound to the strip by focus, so a key bubbling up from a control inside one of its panels used to
pass the strip and land on the screen's column move — which from any button or row on a tabbed pane
put the reader in the rail. `crossParent` in `apps/tui/src/keys/regions.ts` is the missing level, and
the region tier asks it before it moves a column. Inside a panel the pane's own columns still count,
because Right on a file in the editor's tree is how the document beside the tree is reached; the rail
does not, because Escape is the way out of a pane and a control's Left is not. With no column that
way the strip that owns the panel takes the key: it changes its tab if it can, and the keys land on
the strip either way, because after a switch the panel that had them is hidden, and at the strip's
edge a visible move to the strip beats a silent wall — the next press is the strip's own. The footer
says `column` inside a panel while the pane has a second column and `tab` where the strip is the
answer. Up has the matching rule: the first stop of a panel is entered from the strip with Down, so
Up from that stop is the strip, and only the bottom edge of a panel is a wall. A dialog drawn inside a
panel is out of the panel's scope, so neither rule reaches the tab behind it.

Tab and Shift+Tab cycle every region on screen in declared order and wrap, and the pane chords cross
the column edge before they switch the pane. Both are in § Navigation. Neither bubbles, and Tab has
one exception, below.

A `MentionTextarea` sends on a bare `⏎`, and `⇧⏎` is the newline. That is what the shared prop has
always said the node does — `onSubmit` is documented as "Enter without a modifier. Absent leaves Enter
as a newline" — and the DOM half reads exactly that; this host had it on the `commit` chord alone, so
the agents composer's own hint said `Shift+Enter for newline` and described a keyboard nobody had. An
open suggestion list takes the key first and completes, as it does on the desktop. On a terminal that
ignores the kitty keyboard protocol there is one byte for both, so `⇧⏎` sends too and a newline has to
be pasted; that is the same terminal on which `ctrl+⏎` never arrived either.

`ctrl+⏎` is `commit` and submits the `Composer` or `Input` that has the keys. It is typing-exempt, so
it fires from inside the text, and a `Composer`'s submit button is a plain stop that Tab reaches, for
a reader who does not know the chord.

While an `Input` or `Textarea` has the keys, bare keys type. The move, cross and page groups go inert
except `↑` and `↓` inside a multi-line `Textarea`, which move the cursor. Escape leaves the field for
its parent stop or the region's home, which is how a reader gets out of a composer without sending.
Tab, Shift+Tab, `ctrl+⏎` and the pane chords all work from inside a field.

**Tab in a field is the next control before it is the next region.** The arrows type there, so a
field was the end of its panel's walk: on the pull request pane, the `[Comment]` button beside the
comment box, the review box under it and its three verbs could not be reached from the keyboard at
all — Escape went back to the tab strip and Down came back to the same box. So a field binds Tab and
Shift+Tab to the stop walk at its own tier, above the typing shadow, and says whether it moved; at
the panel's edge it declines and the region tier's Tab answers as it always did
(`apps/tui/src/kit/asking.tsx` § step). The footer says `tab next` in a field and `tab region`
everywhere else. This is the DOM's own rule — Tab is the next control in a form — and it is lazygit's
inside its commit box, where Tab toggles the summary and the description and Escape closes. gh-dash
needs no such key because its comment box is a mode entered with `c` rather than a stop in the
reading order, and that shape is still open to us if a field ever wants more keys than a panel can
spare (§ Doors left open).

**An arrow at a field's edge leaves the field.** A multi-line field answers Up and Down by moving the
caret a row and says so; where there is no row to move to it declines, and the hand-off below walks
the stops instead. Without that the hand-off swallowed the key either way, and a field was a wall: the
agents pane's message box sits between a transcript and an action bar, so with the keys in it the
header above could not be reached at all. Down at the last line leaves the same way, which is the
shape every editor with a form under it has.

**Typing is a layer, not a matcher.** That paragraph used to be said once per binding, as
`active: () => !isTyping()` on every bare key of every control on screen. It is said once now, by a
layer at the `TYPING` tier that binds the bare keys while a field has them and is unregistered when it
loses them (`apps/tui/src/keys/install.ts` § The typing shadow, `apps/tui/src/keys/tiers.ts`). Its
bindings claim the key so that nothing below the tier answers, and carry `preventDefault: false` so
the key still reaches the field and is typed. That is the same shape as a `Modal`'s key claim — a
scope, not a swallow (§ Traps) — with one difference: a scope is pushed by the box that is drawn, and
the shadow follows the region store's focus signal, because "is the focused thing a field" is a fact
about focus and the store is the only truth about that (§ Focus regions).

The key still has to reach the field, and the dispatcher hands it over rather than leaving it to
anything under the dispatcher. `apps/tui/src/keys/install.ts` § typeInto is one ordinary listener
after the engine's: where no binding claimed the key and the store's focused node is a field, it
calls that node's own `handleKeyPress` and then claims the key. A field installs `handleKeyPress` on
its node from its own `ref` (`apps/tui/src/kit/asking.tsx`), and the edit model behind it reads the
key and nothing else — no focus of its own to check, which is what makes the hand-off possible at
all.

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
reports whether they went. Nothing under the store holds focus of its own: a node's `focus` and
`blur` are no-ops kept as a one-way mirror in `paintCaret`, and `apps/tui/src/invariants.test.ts`
counts the calls — one `focus`, one `blur`, both in that mirror, and no source file outside a test
asks anything but the store where the keys are. That is worth a rule rather than a habit. A second
owner of focus is a lit border with dead arrows every time the two disagree, and the disagreement is
invisible: the renderable is drawn as focused and the layer bound to it never fires.

The caret is drawn from the same value. A field asks the store whether it has the keys and writes the
answer into its own props, where paint reads it, so there is no focus state anywhere for the store to
be out of step with.

The mouse is a hit test rather than a focus event. The renderer resolves which renderable a left click
landed on and bubbles it up to the root; the store walks up from there to the nearest thing that could
hold the keys and focuses that through its own door, and a click with nothing focusable above it moves
nothing. `autoFocus` is off wherever a renderer is built — `apps/tui/src/main.tsx` and both test
harnesses — because with it on the renderer walks up from the same click and focuses the first
focusable ancestor itself, which is a second opinion about focus for exactly the case one owner is
for.

Entering a region lands on a stop that asked for it, else its first parent stop, else its first
collection row, else its first stop, else the region's own frame, walking the node tree depth first.
The first of those is `markEntry` and the agents composer is its only caller: a chat surface is one a
reader arrives at to write, so the message box takes the keys and the transcript above it is a walk
away. Nothing else may ask — the rule the rest of the list encodes is "the thing the bare keys drive",
which is why landing in a filter box is refused: `j` there types a `j`. The middle step is this
host's own: on the desktop a reader arrives with a pointer and clicks what they meant, and here the
first thing focused is the thing the bare keys drive, so landing in a filter box would mean `j` types
a `j`. A landing on the frame is never remembered — the list that arrives a moment later is what the
next walk into the region finds. Without that rule a reader who looked into Browse before choosing a
source came back to a lit border, no caret, and arrows that did nothing, for the rest of the run.

**A strip with panels is a parent stop.** `markParent(node, panels, cross)` marks one, where `panels()`
returns the boxes whose subtrees it owns and `cross` is how it answers Left and Right. From outside it
is one stop: `left`/`h` and `right`/`l` walk it without wrapping and an edge bubbles to the column
move, `down`/`j` enters the panel it is showing, `up`/`k` is the previous stop beside the strip rather
than one of the strip's own tabs, and Escape from anything inside that panel returns to it. From
inside the panel, Up on its first stop returns to the strip, and a bubbled Left or Right with no
column of the pane's own that way is handed to the strip's `cross` and lands on the strip (§ The five
key groups). A strip that owns
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

A tree to read is the whole of what the microtask buys, and there is nothing left for it to be
ordered against. A node is never destroyed, so the pass's only question about the node it holds is
whether that node is still in the tree and still on screen, which is a walk up the parents at the
moment it asks. A scope popping takes the keys out of the box that is going rather than waiting to be
told.

**One question.** Can the renderable that has the keys still hold them, and is it the real thing
rather than a stand-in? Holding them means alive, visible, visible all the way up to the root, still
`focusable`, and inside the top scope. The walk up the parents is the half that matters, because
`visible` is per node: the shell hides the main row behind an overlay and a `TabPanel`
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

An entry stop that is a list is its **roving row**, not its first row. A region remembers a
renderable, and a renderable does not survive its list being rebuilt from a different roster — the
collection's own `active` is keyed and does survive, so this is where the two meet. It matters most
where entering also picks: the rail's Menu is entered with `pickOnEnter`, so landing on the first row
is not a caret moving, it is a source being chosen, and a workspace you return to would lose the
source you left it on. A virtual list whose active row is off its drawn window falls back to the first
row, the same allowance `stopsIn` makes.

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

`apps/tui/src/kit/scrolling.tsx` is the non-virtual viewport seam, and the component owns the
scrolling: the vertical offset, the visible scrollbar, wheel and trackpad acceleration, and the
clamp are all in that file, and the node carries the offset as a prop that paint translates its
children by. The `Viewport` type it exports is what the rest of the app asks of a viewport — the key
tables, the store's reveal and `DiffPane` reach one through that shape rather than through whatever
drew it. Panels opt into it for document/detail bodies; hidden tab panels keep their own offsets.
The viewport itself is the fallback focus stop for a document with no controls. When it contains a
row, textarea, rectangle or other real stop, it is transparent to focus and a focused child is
revealed through every scrollbox ancestor with `scrollChildIntoView`.

A viewport whose `visible` flag goes false asks for a landing pass, because a `TabPanel` is this node
and hiding a panel raises nothing anybody can hear (§ Focus regions).

**A region that clips beats a region that scrolls, wherever the pane has something pinned.** The
`list-detail` detail column clips, and what is inside it scrolls. That is the DOM's rule for the same
region — `.layout-region-detail` is `overflow: hidden` and the pane's own timeline, diff or rows is
the scroller (`client-core/infra/styles/shell.css`) — and this host deviated from it by wrapping the
whole region in one viewport. The deviation cost the agents pane its composer: the message box is the
column's last child, so it scrolled away with the transcript and every turn ended with the reader
hunting for it. Both panes that use the layout own their scroll, the transcript through
`Timeline follow` and the diff through `DiffPane`.

A clipping region puts a line between its children, which is `row-gap: var(--gap-stack)` on the
desktop's own detail region. Stacked straight onto each other, a pane's parts read as one pile: the
agents pane's detail column is a transcript, a row of provider pickers, an expand toggle and a message
box, and the reader could not see where one ended. The other half of that separation is the field's
own frame — `Textarea` draws one, which is what its row in [ui-design.md](./ui-design.md) has always
said it does, and it lights in the accent tone while the keys are inside it.

**`Timeline follow` is a scroller that stays on its last turn.** It holds the offset at the foot while
the reader is already there, and lets go the moment they scroll up to read history, which is decided
in `place()` — the one door the offset changes through, so "is the reader at the foot" cannot drift
from the offset itself. The growth it reacts to is the height of a box sized by the turns, not of the
box that grows to fill the region: the second changes whenever anything else in the column does, and
following that would drag the view to the foot every time a menu opened.

The nesting question is what decides the shape. A viewport's height comes from `flexBasis: 0` on a
flex line, and the content box inside one is free-sized, so a viewport nested in a viewport has
nothing to be bounded by — the same reason a scrollbox around a whole pane is refused
(§ What the TUI never does). One scroller per column, and the pane says which node it is.

A page key clamps rather than wrapping. `pageNext` goes to the last row and `pagePrev` to the first,
and each hands the key back once the caret is already there, so the viewport below the collection
scrolls instead. This is in the shared `collectionIntents.ts`, so the desktop keeps the same rule:
PageDown on the last row of a list stops. The arrows still wrap, because a list you cannot fall off
the end of is a list you never have to look at.

The reveal runs once, on the renderer's `frame` event, from the one renderer listener
`apps/tui/src/keys/regions.ts` installs beside its click hit test. It waits because
`scrollChildIntoView` compares a child's laid-out `y` against its viewport's, and a node's rectangle
is whatever the last layout pass left there: for a row that did not exist in the previous frame a
reveal taken at the moment focus moved reads stale or zero geometry, scrolls by the wrong delta, and
nothing corrects it. A reader meets that three ways and all three are common — a region entered on a
freshly mounted list, a refetch replacing a row by identity, and a virtual window shift. A frame here
is layout and then paint in one function, so the geometry the reveal reads is the geometry the reader
is about to see. It is not a landing rule and decides nothing about where the keys go; it only makes
the viewport show where they already are, and
`apps/tui/src/kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted` is
what pins it.

One listener for the whole store rather than one per viewport. A pull request draws enough viewports
that one listener each is a crowd, and they would all be doing the work this does once.

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
five-thousand-line patch is five thousand renderables in a pane that shows twenty. It keeps its rows
as one flat list — a file's header is a row in it, so an anchor is an index — and draws the slice
around the viewport's offset with a box above and below standing in for the rest. The spacers are
what keep it a `ScrollViewport`: the scrollbox still owns the offset, the bar, the wheel and the
page keys, and it is still the focus stop a document with no controls needs. The offset reaches the
window two ways, because the viewport raises an event for one of them and not the other: its own key
handlers call an `onScroll` the pane passes in, and the wheel is caught on a box *around* the
viewport, because a wheel step runs each node's own handler from the node under the pointer upwards
— so a listener above the viewport sees the scroll after the viewport has already moved its offset,
and one on the viewport itself would see it before (`apps/tui/src/tree/hit.ts`). The known ceiling
is that a spacer is one line per row and an annotated row draws two, so the content is as many lines
taller than the model as there are marked rows inside the window.

Virtual `Rows` deliberately do not sit inside that mechanism: they render only their visible slice,
so there is no offscreen child for a scroll viewport to move. Their own `top` offset handles wheel
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

Two more things follow from the rule. The command layer's bare keys, `w`, `p`, `;`, `n`, `q` and `?`,
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
above every layer and consumes what it takes. Keys reach the emulator through `encodeKey`
(`apps/tui/src/kit/ptyKeys.ts`), which is the whole of its keyboard: headless xterm parses bytes and
draws cells and has none of its own.

**Being entered is a fact about the screen, not a flag anybody keeps.** A rectangle is entered while
the reader has pressed Enter since the box last lost the keys, the box has the keys now, and the box
is on screen all the way up to the root. The intercept asks all three of those at the moment a key
arrives, so there is nothing to go stale. The one thing stored is the Enter, and the store's own focus
signal clears it: something else taking the keys and the box going off screen are two different ways
to lose them, they used to raise a renderer event and nothing respectively, and one signal is both.

It has to be a question rather than a flag because `visible` is per node: hiding an ancestor leaves
the rectangle's own box reporting itself visible, and both of this app's ways of hiding a subtree do
exactly that — the shell's main row behind an overlay, and a `TabPanel` that is not showing — so a
flag left a rectangle nobody could see consuming every key in the app, `Ctrl+C` included, because the
intercept sits above every layer there is.

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
| A stop that opens a list, meaning a `Menu` trigger and so every `Select` | move | open | tab, or column | commit |
| A viewport holding no other stop | scroll | press | tab, or column | commit |
| Any other stop | move | press | tab, column, or move | commit |

A `Menu` says which it is by passing `opens` to `pressable`, and nothing else in the kit does yet. The
order is a priority: a field is a stop too, and a viewport is only ever a stop while it holds none.

The `h`/`l` column is the one the kind alone does not settle, so `words()` resolves it from three
questions the store answers. A collection that was given an `onExpand` folds and says `fold`. A stop
that answers `expand` and `collapse` itself is a horizontal collection drawn as one stop —
`DocumentTabs`, `SegmentedControl`, a chip row — and says `move`, because the pair moves inside it and
never reaches the column. Anything else says `column` where there is a column the pair can reach —
which inside a panel leaves out the rail — and `tab` inside a panel with none, because the strip that
owns the panel is what answers there (§ The five key groups). The footer said `fold` for every kind
before that, which was true of one of them. A field's bare keys
type, so their layers are inactive and the engine never reports them live; the words in that row are
there for the table's sake and the footer draws the chord alone.

While a PTY is entered the footer says `esc leave · esc esc send escape`. `?` opens the cheat sheet as
a modal with the same hints and a sentence each, and the footer itself is not a focus stop: it is a
label with nothing to drive, and a stop that does nothing is a hole a reader falls into.

**The cheat sheet is the footer's own list, drawn in full.** It calls `activeHints()` and nothing
else, so a binding that appears in one appears in the other and a key nothing bound can appear in
neither. It snapshots on open, because the modal pushes a scope the moment it draws and would
otherwise answer a question the reader did not ask. What the sheet adds is the `detail` sentence the
footer has no room for. `chrome.test.tsx` asserts the two lists are equal in both directions: a row
the engine never reported is the sheet naming a dead key, and a hint with no row is the footer
offering something the sheet cannot explain.

**Escape sits third, and that is a rule rather than an accident.** The footer cuts rather than wraps,
and the hints run move, act, back, then the chords, then the rest. `esc back` used to sit last in
reading order, which meant the line ran out before it on every screen we draw, the cheat sheet's own
footer included: the hint was in the list and no reader ever saw it. The scopes are a stack and
Escape pops it, and this row is the whole of what draws that depth, so `reachability.test.tsx` reads
the drawn line and not the list, at every depth the walk visits.

**A hint the top scope cannot honour is dropped.** A layer knows nothing about scopes, so inside a
`Modal` or an open `Menu` the region tier's Tab and its column pair are still registered and the
engine still reports them live. `regionsInScope() > 1` is the rest of the question and both hints ask
it. The pair asks it only where its word is `column`, because `fold`, `move` and `tab` are answered
inside the scope by the thing that has the keys.

**A region's name is not in the footer, and we are not adding it.** A `list-detail` pane draws two
titled frames and the caret sits in one of them, so which half has the keys is on the screen already
and is on it in place. A label at the left would cost the cells the hints are short of.

### Seeing what the keys did

`ACORN_TUI_KEYS_TRACE=1` writes one line per key to `keys.log` under the XDG state directory
(`$XDG_STATE_HOME/acorn/keys.log`, else `~/.local/state/acorn/keys.log`):

```text
17:08:29.001 key=f6      reason=binding-handled    focused=BoxRenderable#72 region=pane/body scope=overlay:2 steps=11
17:08:29.492 key=enter   reason=intercept-consumed focused=BoxRenderable#91 region=pane/body scope=screen    steps=0
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
row. Switching workspace clears the old task/source and, for a workspace this session has not been in
before, repeats that defaulting pass; a workspace you have already been in opens on what you left it
on. Closing the picker restores focus by region when the old row was replaced. An explicit `--task`
path still opens in Tasks. `ctrl+b` hides the whole column.

**Reopening where you left off.** `acorn` restores the workspace that was open and, from that,
whatever was open in it. Two preferences and both the node's: `core.workspace-views`, which the
desktop writes too, and `last_workspace`, which only this host reads
([state-ownership.md](./state-ownership.md) § Scope rules). The desktop's own three — a last path, a
last task and a last source — are device preferences in `localStorage`, and a terminal has neither a
router to hold a path nor `localStorage` to hold the preference, so none of them is used here.

The restore replays a workspace switch rather than setting the choice, so the one function that knows
how to apply a remembered view is the one that applies it (`apps/tui/src/chrome/restore.ts`). Nothing
records a view until that pass has run, or the default source the shell picks for the first workspace
on screen would land before the stored one had been read and overwrite it with a choice nobody made.

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
down the right edge. A non-virtual document/detail body uses a `ScrollViewport` and its bar.
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
border is read off the store's focus signal, and it has to be: a border a node lit for itself would
need that node to be `focusable`, and a focusable frame is a stop in the cycle, so a region holding
another frame would open on the frame instead of on the list inside it.

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

Whether the terminal is the window the reader is looking at comes from DEC 1004: the parser turns
`ESC [ I` and `ESC [ O` into a `focus` and a `blur` event, `apps/tui/src/main.tsx` feeds them to
`setHostFocused`, and the gate's seen rule reads them. Unknown counts as focused, so a terminal that
never reports stays quiet.

### Navigation

`Tab` and `Shift+Tab` cycle regions, beside `F6`, which is what the DOM host spells the same intent
because the browser owns Tab. The cycle reads down the screen: Menu, Browse when it has a list,
Tasks, the pane strip when a task is open, then the pane/source regions. `right`/`l` crosses from the
rail to main and `left`/`h` comes back; neither wraps. `Ctrl+Option+Right` and
`Ctrl+Option+Left` take the same spatial edge before they cycle a task pane, so the advertised pane
chord works from Menu, Browse, and Tasks. In a rail list, Up/Down and `j`/`k` move; `Enter` performs the
row's ordinary activation and then enters main. An overlay or entered PTY keeps first refusal on
Escape. A tabbed detail adds one deliberate level: `left`/`right` (or `h`/`l`) choose a tab, `down`/`j`
enters its controls, `Tab` steps between them from inside a text field (§ The five key groups), and
Escape, Up from the first control, or `left`/`right` from any of them return
to the tab strip — the last pair changing the tab on the way. Moving a focused control beyond the viewport
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

**No digit jumps to a region.** lazydocker binds `1` to `6` to its six panels and it works there
because those six are always drawn, always in that order. Ours are not a fixed set: Browse registers
nothing without a list, the rail goes on `ctrl+b`, the strip draws only while a task is open, and a
pane's own regions are its layout's. So `3` would name a different region on nearly every screen,
which is the opposite of what a direct jump is for. The footer settles the rest: it already runs out
of line before `esc back` on every screen we draw, so nine more rows are nine keys it cannot say, and
a key the footer cannot say is what § The footer exists to prevent. Tab and the column moves are the
region keys, and `ctrl+1` to `ctrl+9` are the `tabs` layout's, which is a fixed set drawn in one strip.

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

The last row costs five first-party registrations, and two of them draw nothing: github's and agents'
`overlay` entries are where a command that needs the router or a query client gets mounted, and
onboarding's first-run screen is the one `overlay` that is really a screen. The terminal plugin takes
`drawer` and docker takes `task.footer`. The terminal's overlays are a fixed set the shell draws and
its drawer is the rail, so giving a plugin those places is a contract for both hosts rather than a
component for this one.

What that costs a reader here is small and named: github's changed-file and pull-request searches and
agents' two settings are desktop-only, because the registrations that mint them are not mounted. The
editor's ⌘P quick-open used to be in the same list and is not any more — it is a `search` command its
plugin registers at boot, so it works here.

**A canvas is not one of the losses.** The kit's `Graph` node draws cards on a grid with the edges as
curves on the desktop, and here it draws the indented list the workflows editor drew before the
canvas existed: the same cards in the same reading order with the same selection, indented by rank
instead of placed by coordinate, and `⇐ n` on a card that waits on more than one. Both hosts take the
ranks from the same `kit/lib/graphLayout.ts`, so neither can put a card under the wrong one. Positions
and wires are not drawn, and the one affordance that would otherwise go with them — dragging an edge
into place — is a picker under the list instead. A plugin writes the same `Graph` for both.

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
press, and five files that need no renderer at all: the focus invariants that are facts about
the source, the palette's collapse to 16 slots, the clipboard
sequence, the plugin sandbox, and the boot test. Nothing in the suite skips and nothing asks for a
flag: it runs on the Node the repo pins (§ The runtime floor).

**The harness is the real thing with its two ends replaced.** `apps/tui/src/kit/render.tsx` draws one
fragment and `apps/tui/src/harness.tsx` drives the whole shell, and both open the same renderer the
app opens, with stdout as a buffer sink and no terminal behind it. So a test reads the frame that was
actually painted, as characters and as coloured runs, which is what lets a case assert that a focused
control is lit when its six characters have not changed. `press` puts a `KeyEvent` straight onto the
key stream rather than bytes onto stdin, so nothing is waiting to see whether a lone Escape starts a
sequence — but the press still gives real time to what it started, because a Tab that lands the caret
on a row whose data the fixture answers on a timer needs the timer to fire, and turning the render
loop does not make it.

The boot test (`apps/tui/src/node/boot.test.ts`) is what `apps/desktop/test/boot.test.ts` is for the
shell. Against a fresh data root and a fresh config directory it starts a real standalone node, uses
the real fleet store and token files and the real broker over pinned TLS, and then asks the three
questions only this host has: a second `acorn` attaches rather than starting a second node, a token
the node refuses reads as `revoked` and stops retrying, and quitting drains the child and releases the
root's lock.

## Shipping it

Not shipped. `acorn` runs from a checkout. Putting it in the node tarball and the desktop bundle is
step 7 of [future/bundle.md](./future/bundle.md) § Ordering, which owns the pipeline, the one native
module and the signing gate. What that step still owes is written there.

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
