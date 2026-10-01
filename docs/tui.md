# The terminal client

The `acorn` launcher opens this client with no arguments. With a subcommand it opens the
[headless command-line client](./cli.md), which shares custody but does not load the terminal
renderer.

`acorn` with no command is the terminal client: client-core booted under Node, drawing the same pane tree the desktop
draws, in cells. It is the second host of the closed kit and the only test that the kit is intent
rather than layout.

`apps/tui/` contains the host, cell renderer, and terminal projections of the kit and layouts. The panes,
the query layer, the keymap, the palette session, the focus intents
and the tree protocol are `packages/client-core`'s, unchanged. No plugin writes terminal UI, declares
a `tui` surface, or learns which host it is on.

Three docs have "terminal" in the name. This one is acorn running in a terminal.
[terminal.md](./terminal.md) covers raw PTY sessions in the desktop drawer and this host's native
session view. [managed-agents.md](./managed-agents.md) is the other way to run the same providers,
driven over a protocol with a ledger.

Two design records are in git rather than in the tree, and comments in `apps/tui` cite both:
`docs/future/terminal/`, nine phases between 2026-08-30 and 2026-08-31, which is how this client came
to exist; and `docs/future/terminal-rewrite/`, five phases on 2026-09-03 and 2026-09-04, which is how
it came to draw its own cells. Each was deleted the day it shipped. Find one with
`git log --follow -- docs/future/terminal/README.md`, and the same for the other.

## What it is, in one screen

```text
Topbar:   one line. Workspace > project and task count on the left; the open branch, node state,
          and Task: title on the right. Focusing another task previews it as Task to open: title
Left:     three framed panels — Menu, the sources; Browse, what is under the chosen one; Tasks
Main:     one pane, or the chosen source's detail, with a strip of pane labels above it
Overlays: commands, setup, settings, file paths, task promotion, terminal sessions, and confirmations
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

In **Tasks**, moving the caret previews a row's title in the topbar as **Task to open**. Press Enter
to open that task. The pane then mounts the opened task's content; moving the caret alone leaves the
open pane in place.

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

A prepared data root can have `node.json` before this TUI has ever saved a fleet row. The test
fixture does this. The shell keeps that known Node ID while the handshake is in flight, then selects
it against the completed fleet and refreshes active queries. Selecting against the still-empty fleet
would clear the ID and leave the first screen with no tasks even after the Node came online.

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
desktop. The first `acorn` against one asks for a pairing code. For a desktop-supervised node, open
**Settings → Nodes → Pair another client** in the desktop to show the code and identity words. For a
standalone node, run `kill -USR1 <pid>` and read the code from its launching terminal. The TUI then
runs the ordinary pairing exchange against loopback. A loopback mint route would remove the step and
does not exist.

### Remote nodes

`acorn --node https://host:4317` runs the desktop's three steps in a terminal
(`packages/custody/src/broker/nodePairing.ts`): an unverified probe of `GET /v1/node` that cross-checks
the socket's fingerprint against the body's, the six words printed for the reader to compare against
what the node printed at its own boot, and `POST /v1/pair` over a pinned agent with the code. Both run
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

When the selected Node returns, the TUI refreshes active queries without cancelling reads already in
flight. It then refetches failed inactive queries: an error boundary may have unmounted the observer
that would otherwise make the failed read active. After those reads settle, failed pane and region
boundaries remount their content. A persistent error keeps its message and a keyboard-accessible
`Retry` control. Retry refetches failed reads in the selected Node's cache partition before remounting
that boundary.

An empty project roster opens **Set up acorn** after the Node's roster query completes. The route
chooses or creates a workspace, adds a project from an absolute path on that Node, and creates a task
with the shared branch rules. `Ctrl+K` keeps **Set up acorn** and **New task** reachable afterward. The
provider step lists connections, accepts descriptor-defined credentials with masked password fields,
and starts device authorization when a provider offers it. Installed Claude and Codex CLIs are
detected by the Agent pane. Settings is its own route (§ Settings).

The device token is plain bytes at 0600. The desktop encrypts under the platform keychain through a
`TokenCipher`; there is no keychain here, so the TUI supplies a pass-through, which is what the node
beside it already does with its own TLS private key and session key. On NTFS the mode is advisory,
which [future/bundle.md](./future/bundle.md) § The snags carries with the other file-mode claims
Windows does not honour.

`acorn.json` in this config directory holds device appearance, shortcuts, rail order, and selected
exclusive providers. The TUI reads it at startup and watches for changes; valid fields pass through
the same device preference setters as Settings. A parse error keeps the last valid values. Plugin
entries appear as installation offers in the Plugins palette and never grant trust. Local-folder
requests are omitted because this host has no folder picker. Unknown keys survive Settings writes.
The schema is `packages/plugin-types/acorn-device.schema.json`.

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

**The roster and loaded-plugin worker factory load after the first frame.** `apps/tui/src/roster.ts`
holds the twelve client plugins. `main.tsx` imports it and the Node worker factory on the renderer's
first `frame` event, then installs the factory before starting the loaded-plugin watcher. Registering
late is safe because every contribution registry is a Solid signal. The chrome draws first, then the
rail, pane strip, and palette fill through the same reactivity that handles a plugin arriving from a
Node later. The four host seams in `App.tsx`, especially the layout table, must remain eager because a
pane needs them before it can draw.

| Group | What the TUI installs |
| --- | --- |
| `transport` | `NodeBroker`, in-process. Responses stay buffered `Uint8Array`. |
| `fleet` | The fleet store: `list`, `probe`, `pair`, `rename`, `forget`, `reconnect`, `restartLocal`. `nodeAdopt` and the tunnels are not installed. |
| `pairing` | Probe only. The probe is remembered in the seam rather than handed back, so confirming a fingerprint is a step rather than a parameter a caller could skip. |
| `plugins` | File-backed custody. See The sandbox below. |
| `files` | A terminal path prompt reads local bytes for attachments and writes exports or artifacts locally. It requires an absolute path, rejects attachments above the Agent route's 10 MiB limit before reading bytes, reports read/write errors, and confirms replacement of an existing file. The Node never receives that local path. |
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
  is no SVG here: the TUI kit resolves selected shared `Icon` names to one-cell glyphs in
  `apps/tui/src/kit/glyphs.ts`. Unmapped names draw nothing. The DOM component that reads the table
  remains in the graph because client-core's components have to resolve, not because it draws here.

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
(`client-core/host/tree/kitEntry.ts`). On this host every entry is a component: the table loads with
`src/plugins/RemoteTree.tsx`, outside the startup graph. Presentation components live by behavior
under `src/kit/showing/`, with `src/kit/showing.tsx` preserving the kit import surface.
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
The terminal reads the device's `acorn.json` through the same schema and device preference setters
as desktop. On a truecolour terminal, a built-in theme selection uses six colour primitives generated
from the desktop theme stylesheet. Without a selected theme, or without truecolour support, the
terminal uses its own palette. Follow-system mode uses the configured light theme because terminal
emulators expose no reliable system light/dark signal.

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
  at about fifteen lines each. The terminal plugin's desktop drawer retains its xterm, while this
  host opens a full-screen session list and native PTY rectangle from a task with `t` or from the
  palette. Sessions persist when that view closes; see [terminal.md](./terminal.md) § Client.
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

Three behaviours are the same on both hosts. A node type this build cannot draw is omitted, a failed
slot draws nothing, and one error boundary contains each tree. Plugin failures remain available to
diagnostics without replacing the owner's UI with an inline error.

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

For the full contract, see [Terminal interaction and reporting](./tui/interaction.md#keys-and-focus).

## What the terminal client reports

For the full contract, see [Terminal interaction and reporting](./tui/interaction.md#what-the-terminal-client-reports).

## Chrome

For the full contract, see [Terminal chrome and plugins](./tui/chrome-and-plugins.md#chrome). Task
rows project the allocator's complete ordered marker legend as a count. At narrow widths the row
shows `+N`; focus that row and press `Shift+F10` or the menu key to inspect every label in the
host-owned **Task markers** list. The desktop keeps its four-corner allocation.

## Settings

**Open settings** in the `Ctrl+K` palette opens the Settings route. It lists the desktop's nine
groups, then a group's pages, then one page, and Escape climbs back one level at a time: an open
detail, the page, the group, and then the route. The list is the registry the desktop's settings view
reads. Core's pages come from the declaration table in
`packages/client-core/src/features/settings/corePages.ts`, which the desktop's
`apps/desktop/src/client/pageContributions.tsx` also draws from, and the roster's plugins register
theirs through `ctx.settingsPages`. So the groups, the page order, the labels, and each page's scope
match the desktop. `apps/tui/src/chrome/settingsPages.tsx` decides what this host draws:

- A plugin page written with the kit draws unchanged, through the terminal projections of
  `SettingsSection` and `SettingRow`. A row with `from` shows where its value comes from and no
  control. A row's or a section's `help` prints as a grey line under its description, because this
  host has no hover to hide it behind. The agents plugin's pages, Docker, and Workflows draw this way.
- Notifications has a terminal form of its own. Its **Terminal alerts** row shows the mode
  `ACORN_TUI_NOTIFY` chose, whether the variable set it or the default did, and whether this terminal
  takes a notification sequence at all. The variable is the only way to change it, and the row says
  so. The event switches and the test notification are the desktop's, through the same accessor. The
  desktop's sound, system notification, and app icon switches are absent, because the environment
  variable chooses this host's channels and the topbar count is always on.
- Every other core page, and the terminal plugin's drawer page, is listed with **desktop app** beside
  it. Opening it says why this host does not draw it and where to go. A node page's change on the
  desktop applies here, because the node keeps it. A device page's does not, and for Appearance,
  Keyboard shortcuts, Rail and surfaces, and Device config file the page names this client's own
  `acorn.json`. Overview also offers **Set up acorn**.

A page runs inside the same unsaved-changes and detail seams the desktop provides, so a form with
Save and Cancel asks before Escape drops it, and a list page's detail puts its name in the
breadcrumb. `confirmAction` from `@acorn/plugin-api/ui/host` is a real dialog here
(`apps/tui/src/chrome/Confirmation.tsx`). It draws over whatever has the screen and keeps that
surface mounted underneath, and its caret starts on **Cancel**. A notice target of kind `settings`
and `presentation:open-settings` open the route on the page they name. A section in a deep link is
ignored, because this host cannot scroll a page to one.

The place in the route lasts for the session only. The palette carries **Open settings** alone rather
than the desktop's row per page and per section ([command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)).

## Loaded plugins

The terminal's file-backed custody implements device install and remove through the same client-core
platform contract as desktop. It uses the shared archive and manifest validation and keeps trust
decisions and device preferences in its own configuration directory. The **Plugins on this device**
palette group installs from a GitHub release, npm package, or HTTPS URL. It also updates, enables,
disables, changes development trust, and removes installed bundles. Its source forms use the same
resolver and trust prompt as the desktop. The terminal does not offer a local-folder picker.

For the full contract, see [Terminal chrome and plugins](./tui/chrome-and-plugins.md#loaded-plugins).

## What a plugin loses here

For the full contract, see [Terminal chrome and plugins](./tui/chrome-and-plugins.md#what-a-plugin-loses-here).

## Tests

[testing.md](./testing.md) § Test layers owns the tiers. In short: one case per kit node against a cell
buffer, one per layout drawn from its projection, a twin of client-core's `keys.test.tsx` against the
terminal adapter, a pane file that opens every first-party pane at exactly 80 by 24 and asks whether
the thing the pane is for is on the first screen, a chrome file that drives the whole shell, a
reachability file that walks every stop on nine surfaces and checks four invariants after every
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

For terminal UX work, the agent driver runs the compiled TUI in a real PTY and captures its visible
cells through a headless terminal. It sends raw keyboard input through the parser that the harness
bypasses, records snapshots and resizes, and can run a bounded navigation flow against the shared
desktop fixture. [local-development.md](./local-development.md#agent-driven-terminal-development)
has the commands and comparison procedure. The driver complements the fast cell tests; a terminal
emulator and human inspection still cover color, focus, and host-specific behavior.

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
