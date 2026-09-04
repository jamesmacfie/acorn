# Review: the terminal client, its faults, and the reference apps

Read at `9e5d90ca` on 2026-09-03. Three questions: what is the terminal client made of, where did each
of its reported faults come from, and what do yazi, rainfrog, lazygit, lazydocker, and gh-dash do that
makes them feel the way they do. Then the three options and the one taken.

Nothing here was profiled. Line counts are `wc -l`; commit counts are `git log --oneline -- apps/tui`;
everything else is read from source with the path beside it.

## 1. What the client is

`apps/tui/src` is 18,328 lines: 11,876 source and 6,452 test, across 34 test files. By folder:

| Folder | Source | Test | What it holds |
| --- | --- | --- | --- |
| `kit/` | 4,545 | 2,146 | one component per kit node, the text-run helpers, the PTY rectangle, the reconciler patch |
| `keys/` | 1,828 | 1,328 | the region store, the keymap adapter, stops, collections, traps, tiers |
| `chrome/` | 1,854 | 354 | topbar, rail, pane strip, footer, palette, inbox, topology |
| root | 1,863 | 1,776 | `main.tsx`, `App.tsx`, the test harness, the platform seam, the render guard, the fixture |
| `plugins/` | 794 | 357 | the worker sandbox, the tree host, the source panel, the trust prompt |
| `layouts/` | 543 | 229 | seven components for eight layout names |
| `node/` | 449 | 262 | attach or start, supervise, paths, cache, boot test |

### What it renders

The shared contract is not "Solid components". It is a closed vocabulary:

- 75 named nodes in `packages/client-core/src/kit/tokens/support.ts`, each with a per-host support
  level and, where the terminal loses something, a sentence saying what. 53 are `full` on the
  terminal, 18 `reduced`, 3 `absent`, 1 `fallback`.
- A focus role per node in `packages/client-core/src/kit/tokens/focusRoles.ts`: `stop`, `collection`,
  `item`, `trap`, `none`, or `conditional`. A plugin sets none of it.
- Six role enums for props (`space`, `size`, `tone`, `text`, `border`, `radius`) and eleven event
  names (`onPress`, `onChange`, `onSubmit`, `onSelect`, `onActivate`, `onToggle`, `onOpenChange`,
  `onExpand`, `onDismiss`, `onPick`, `onRemove`). Never a key and never a pointer event, by the comment
  in `packages/protocol/src/tree/nodes.ts`, because a terminal host has neither.
- Eight layout names in `packages/protocol/src/paneLayouts.ts` with their region tables. A plugin
  names one and fills the regions; the host owns what each means at every width.

The same vocabulary already exists as a wire format. Sandboxed plugins send a tree of
`{ id, type, props, children }` with `insert`, `remove`, `patch`, `move`, and `text` operations
(`packages/protocol/src/tree/messages.ts`), and `apps/tui/src/plugins/TreeHost.tsx` renders it with a
`Dynamic` over the same component table the compiled plugins use. That is the proof that the contract
is data. A host that implements the 75 nodes and the eight layouts inherits every plugin, compiled or
loaded, without touching one.

Kit purity is enforced, and the baseline is empty: `tools/arch/boundaries.test.ts` refuses a
stylesheet, a raw element, `class=`, `style=`, or `innerHTML` in any plugin's client folder. The only
remaining reaches into the DOM from plugin client code are window focus listeners, timers, and the two
genuine pixel surfaces, preview and the terminal drawer.

### How much of the client touches OpenTUI

The JSX surface is narrow. Across every `.tsx` file under `apps/tui/src`:

| Intrinsic | Uses |
| --- | --- |
| `<box>` | 153 |
| `<text>` | 6 |
| `<span>` | 2 |
| `<code>` | 2 |
| `<input>`, `<textarea>`, `<scrollbox>`, `<markdown>`, `<embedded_terminal>` | 1 each |

The props handed to those tags, in order of use: `flexDirection` (104), `flexShrink` (38),
`flexGrow` (36), `gap` (35), `ref` (16), `paddingLeft` (7), `overflow` (6), `wrapMode`, `width`,
`minWidth` (4 each), and a handful below that. It is a flexbox vocabulary and nothing else.

From `@opentui/core` the client imports `Renderable`, `BoxRenderable`, `ScrollBoxRenderable`,
`InputRenderable`, `TextareaRenderable`, `EmbeddedTerminalRenderable`, `CliRenderer`, `KeyEvent`,
`MouseEvent`, `RGBA`, `TextAttributes`, `createCliRenderer`, and `CliRenderEvents`. From
`@opentui/solid`: `Dynamic`, `render`, `extend`. From `@opentui/keymap`: the engine and its OpenTUI
adapter. Sorted by how hard each is to leave behind:

- **Rewritten outright, about 800 lines.** `apps/tui/src/kit/reconciler.ts` (136), which exists to
  override two functions of the OpenTUI reconciler. `apps/tui/src/renderGuard.ts` (86), which patches
  two prototype methods. `apps/tui/src/kit/rectangle.tsx` (243), built on the embedded emulator.
  `apps/tui/src/kit/roles.ts` (131) and `apps/tui/src/appearance.ts` (92), which speak `RGBA` and
  `TextAttributes`. `apps/tui/src/kit/scrolling.tsx` (89), the scrollbox. About 60 lines of renderer
  setup and console suppression in `apps/tui/src/main.tsx`.
- **Same design, new mechanics, about 2,000 lines.** `apps/tui/src/keys/regions.ts` (1,071),
  `apps/tui/src/keys/install.ts` (247), `apps/tui/src/keys/stops.ts` (130),
  `apps/tui/src/keys/collection.ts` (143), `apps/tui/src/keys/trap.ts` (55), and
  `apps/tui/src/chrome/bindings.ts` (174). The five-level model, the scopes, the one-writer rule, the
  landing pass, and the topology are framework-independent and hard-won. The mechanics are
  `Renderable.focusable`, `focused`, `visible`, `parent`, the `focused_renderable` event, the `frame`
  event, and the keymap engine's layer priorities.
- **Tag rename and prop mapping, about 3,500 lines.** `apps/tui/src/kit/showing.tsx` (1,007),
  `apps/tui/src/kit/grouping.tsx` (766), `apps/tui/src/kit/asking.tsx` (682), `apps/tui/src/kit/cells.tsx`
  (122), `apps/tui/src/kit/pixels.tsx` (72), `apps/tui/src/kit/host.tsx` (321), and `apps/tui/src/layouts/`
  (543). These are `<box flexDirection>` trees. If the replacement accepts the same intrinsic names and
  the same flex props, they change very little.
- **Untouched, 2,634 lines in 17 files.** The platform seam, the fixture, markdown to runs, the router,
  notifications, the chrome model, routing, topology, the node folder, custody, the worker factory,
  glyphs, the kit facade, the editor stub, the icon table.

The test harness is the hidden cost. `apps/tui/src/kit/render.tsx` and `apps/tui/src/harness.tsx`
(496 lines together) sit on `@opentui/core/testing`: `createTestRenderer`, `captureCharFrame`,
`captureSpans`, `mockInput`, `mockMouse`, `resize`. Every one of the 34 test files goes through them.
The scenarios they drive read characters and coloured runs and press named keys, so they carry over
to any harness that offers the same five verbs.

## 2. Where each fault came from

The client's git history is 34 commits in one continuous arc from the first pane drawn. Fourteen of
them are repairs of focus, navigation, or rendering. `apps/tui/src/reachability.test.tsx` says why in
its own header: every bug those commits chased was a path nobody had written a scenario for. Below,
each fault class with the mechanism that produced it. None of them is our code being wrong.

### 2a. The renderable lifecycle fights Solid's

OpenTUI destroys a renderable one `process.nextTick` after it leaves the tree
(`@opentui/solid` 0.5.9, `_removeNode`). Solid's `Suspense` removes its children when it suspends
and hands the same instances back when it resolves. A tick always runs before a promise settles, so
any boundary that showed content and then suspended again was destroyed, refused on re-add
("was already destroyed, skipping add"), and blank until the process exited. Reading an uncached
query's data is a suspension, so the ordinary shapes hit it: the caret landing on a pull whose detail
had not loaded, a browse window sliding onto rows whose queries had not run. The fix in
`apps/tui/src/kit/reconciler.ts` monkeypatches `destroyRecursively` on every element and ties
destruction to the reactive owner instead of to detachment. `apps/tui/src/browseSlow.test.tsx` pins
it, and its header records that the zero-latency fixture could never reach the bug, so the browse
tests passed while the app drew blank panels.

### 2b. Layout results reach the painter unclamped

`Renderable.updateFromLayout` takes width and height straight from Yoga. A node that joined the
tree after the frame's layout pass has no measured size, `Math.max(undefined, 1)` is `NaN`, and the
Zig side takes a `u32`, so `bufferDrawBox` throws "Argument 3 must be a uint32" from inside the render
loop and the process ends. Switching to a workspace whose task opened the agents pane killed `acorn`.
`apps/tui/src/renderGuard.ts` patches `onLayoutResize` and `updateFromLayout` on the prototype to
clamp, and `apps/tui/src/renderGuard.test.ts` fails the day OpenTUI clamps its own so the guard can
go. As of 0.5.10 it does not.

### 2c. Text has rules the DOM never had

A run of text must have a `text` parent. On the DOM a bare string anywhere is a text node. So
`<Stack>{count()}</Stack>` is correct kit and throws here, from inside `insertNode` deep in a signal
write, which aborts the whole update pass and leaves every other reader of that signal un-notified.
Four crashes in one week were this, wearing four values: `""`, `"7"`, `"8"`, and a pending `lazy()`.
The reconciler's second override wraps a bare string in a `text` when the parent is a box.

A `span` drops every prop except `href` and `style`, so a colour handed to one is discarded and the
run inherits its parent's, and a `text` given no colour draws opaque white rather than the terminal's
foreground. That was every markdown paragraph and every diff line on a light terminal.
`apps/tui/src/kit/roles.ts` and `apps/tui/src/appearance.ts` carry the two fixes.

A `text` is a box to Yoga, so a row of them shrinks each and clips each, turning
"hash but `signIn` still" into "hash bsignInstill" (`apps/tui/src/kit/cells.tsx` § `Run`).

### 2d. Two owners of focus

This is the class behind the navigation reports. The region store is the model: five levels, scopes,
a landing rule, a topology the shell installs. The renderer is the mechanism: it holds
`currentFocusedRenderable`, routes keys to it, and changes it on a click, on a blur, and on a destroy.
Where the two disagree, the reader sees a lit border that answers nothing, or keys eaten by a box
nobody can see. The specific mechanics, each the cause of a shipped fix:

- `visible` is per node. A focused descendant of a hidden box goes on reporting itself visible and
  focused. The shell hides the main row behind an overlay and a `TabPanel` hides its unshown tab, and
  in both cases a hidden PTY rectangle kept consuming every key in the app, `Ctrl+C` included
  (`apps/tui/src/kit/rectangle.tsx`, `apps/tui/src/kit/scrolling.tsx`, `apps/tui/src/keys/regions.ts`
  § `onScreen`).
- `blur()` refuses a node that is no longer `focusable`, so a node that held the keys and then lost
  the flag kept them for the rest of the run. `apps/tui/src/invariants.test.ts` now pins the exact
  set of files allowed to write `focusable =`.
- `Renderable.y` is whatever the last completed layout pass left there, so revealing a freshly
  mounted row in a viewport reads stale geometry and scrolls by the wrong delta. The store installs a
  second reveal on the renderer's `frame` event to correct it.
- The keymap engine's tie-break at equal priority is registration order, which is the reconciler's
  business, so tier 41 exists in `apps/tui/src/keys/tiers.ts` purely to sit one above 40.
- The engine caches active keys only while no layer carries a runtime matcher, and this host puts
  `active: () => !typing()` on every bare-key binding, so the cache is off for the process and the
  footer collects every layer twice per render
  ([performance.md](../../performance.md) item 10).

The invariant that catches all of this is one line in `apps/tui/src/reachability.test.tsx`: after
every press, the renderer's focused renderable and the store's must be the same object. That suite
walks eight surfaces at eighty presses each and takes about three minutes on a warm worker.

### 2e. The terminal is the renderer's stderr

Nothing may write to stderr while the renderer owns the terminal, because that is the file it draws
on. `apps/tui/src/main.tsx` deactivates OpenTUI's console overlay, removes Node's warning listeners
and holds the warnings in a set until `renderer.destroy()`, and raises the renderer's listener cap to
200 because every live scrollbox subscribes to the `selection` event and a pull request has more than
ten. The same three lines are repeated in both test harnesses.

### 2f. The floor

`apps/tui/src/main.tsx` exits with code 2 below Node 26.4 because OpenTUI's Zig core is reached over
`node:ffi`, a builtin behind `--experimental-ffi`. `node-runtime.json` pins the repo at 24.11.0 with
an engines floor of 22.18 or 24.4. `apps/tui/src/ffi.ts` (deleted in phase 4) probes for the builtin
and every drawing test is `describe.skipIf(!hasFfi)`, so on the repo's own runtime the visual suite is
a list of skips.
`apps/tui/vitest.config.ts` adds the flag only where the running Node accepts it.

The installed `@opentui/core` 0.5.9 is 13 MB with eight optional platform packages; the darwin-arm64
one is a 6 MB `libopentui.dylib` statically linking Ghostty's terminal emulation, libwebp, lcms2, stb,
and Wuffs. It depends on `bun-ffi-structs` and exports a `bun` condition for every entry. Node support
merged 2026-06-08. Ten releases landed between 2026-08-03 and 2026-09-01. `@opentui/solid` pins
`solid-js` at exactly 1.9.12 where the repo catalogs 1.9.13, and pulls Babel and `s-js` as runtime
dependencies. The upstream issue list at 2026-09-03 includes one open item where every render request
walks the whole tree, so a single spinner costs about a quarter of a core on an idle app.

### 2g. What is not a fault

Frame rate. OpenTUI renders on demand and there is no continuous loop unless something calls
`start()`, which nothing here does. No "flicker" or "tearing" evidence exists anywhere in the tree or
the history. The visual faults are crash, blank, and wrong colour. The keyboard faults are focus
disagreement. That matters for the design: the replacement does not need to be faster at painting,
it needs to be simpler about what a node is.

## 3. What the reference apps do

Read from source and docs on 2026-09-03.

**yazi** is Rust on `ratatui-core` and `ratatui-widgets`, pinned to its own fork, with tokio and
mlua. There is no crossterm; `yazi-tty` talks to the terminal through libc directly. Rendering is
immediate mode: every frame is rebuilt into a buffer and the buffer diff is written out. The Lua layer
is a real UI language: `ui.Layout`, `ui.Constraint` (Length, Percentage, Ratio, Min, Max, Fill),
`ui.Line`, `ui.Span`, `ui.List`, `ui.Bar`, `ui.Border`, `ui.Gauge`. A component's `redraw()` returns a
table of elements. Plugins are async by default; only `@sync` plugins may touch UI state and they call
`ui.render()` to request a redraw.

**rainfrog** is Rust on ratatui 0.30 and crossterm with an event stream. It follows the ratatui async
template: a `Component` trait, an unbounded `Action` channel, a `Tui` event stream yielding tick,
render, key, mouse, and resize. A `Focus` enum (Menu, Editor, Data, History, Favorites, PopUp) selects
the keymap; an active popup captures all input. Keys are vim-like and user-remappable from TOML.

**lazygit** and **lazydocker** are Go on a fork of gocui over tcell. Views are retained line buffers
implementing `io.ReadWriter`. The main loop drains the event queue, runs every manager's `Layout`, and
redraws every view unconditionally; there is no dirty tracking in gocui, and tcell's cell diff keeps
the output small. On top sits the contexts system: a context is tied to a view, carries state and
keybindings, and lives on a stack. Seven context kinds, from side panel to temporary popup. Controllers
own the handlers, and one controller is reused across every list context. `?` shows the keybindings
menu generated from the same table, `/` filters, `esc` pops the stack, digits jump to panels in
lazydocker.

**gh-dash** is Go on bubbletea, lipgloss, glamour, and bubbles. The Elm shape: `View()` returns a
string, a ticker flushes at 60 frames per second and skips unchanged lines. Layout is manual string
composition. Keys are `key.Binding` values in a `KeyMap` struct; `ShortHelp()` returns `?` and
`FullHelp()` switches on the view type. Users add per-view bindings in YAML. `j`/`k` within a
section, `h`/`l` across sections.

What they share:

1. **The frame is a function of state.** Each frame is built whole and diffed at the cell level.
   Nothing has a lifecycle, so nothing has stale geometry and nothing is destroyed too early.
2. **Focus and keymaps are plain data the app owns.** A `Focus` enum, a context stack, a `KeyMap`
   struct. The framework routes bytes; the app decides who has them. Help is generated from the same
   table that dispatches.
3. **Layout is constraints, not a shrinking flex tree.** Length, percentage, min, fill. Nothing gives
   up half a line to a sibling.
4. **State and paint share a process in a compiled language.** That is where the startup time and the
   per-keystroke latency come from, and it is the one property we cannot have without rewriting
   client-core.

Our intent table, tiers, regions, scopes, and footer hints already match points 2 and 3 on paper.
Point 1 is what OpenTUI's retained tree denies us. Point 4 is out of reach and is not what the reported
faults are about.

## 4. The options

**A. Stay on OpenTUI.** The embedded terminal emulator and the input stack are real value. The seven
workarounds are contained and tested. But 2a through 2e are properties of a retained node with its
own lifecycle and its own focus, and no upstream release changes that. Each release re-opens the three
monkeypatches. 2f gets worse the day we ship. Running under Bun would remove the flag, but the plugin
sandbox in `apps/tui/src/plugins/workerFactory.ts` depends on Node's permission model, which Bun does
not have.

**B. A compiled painter behind a wire.** Rust with ratatui, or Go with bubbletea, receiving the tree
protocol from Solid in Node and sending keys back. The team already builds Rust for the desktop shell.
But every handler still lives in Node, so the painter forwards every key and owns nothing about focus.
It writes the 75 node renderers in a second language. It ships two runtimes. It adds a serialization
step on every frame that the tree protocol was designed for but that in-process code does not need.
And it gets none of point 4, because the model is still Node. Refused, with the reasoning kept in
[refused.md](./refused.md).

**C. Own the paint in TypeScript.** Solid keeps creating and mutating a tree of plain objects through
a universal renderer with our own node operations. Each frame lays that tree out, paints it into a
cell buffer, diffs against the previous frame, and writes the runs that changed. Layout comes from
`yoga-layout`, the WebAssembly build of the same engine OpenTUI embeds, so the 153 `<box>` trees keep
their props and their results. Focus is a value in the region store and paint reads it. A hidden
subtree is not walked. A detached node is unreferenced and nothing destroys it. The PTY rectangle
draws from `@xterm/headless`, already a dependency of the desktop, the terminal plugin, and the agents
plugin. The floor drops to the repo's Node. What we take on: an input parser for the kitty keyboard
protocol, SGR mouse, and focus reporting, a few hundred lines; a scroll viewport, an input, a
textarea; and the long tail of terminal quirks, which we already own for OSC 52 and the notification
sequences.

C is the programme. [architecture.md](./architecture.md) is what it builds.
