# Architecture: what replaces OpenTUI

Design, 2026-09-03, against `9e5d90ca`. This is the target the phases build toward. Each section says
what the layer is, what it replaces, and the invariant that holds at its boundary. Where a choice is
still open, the phase 0 spike that closes it is named.

## The shape in one picture

```text
Solid components (client-core, the kit, the layouts, the chrome)     unchanged
        │  JSX compiled with generate: 'universal', moduleName → our reconciler
        ▼
Node tree: plain objects       apps/tui/src/tree/     (new)   what Solid creates, patches, moves
        │  every frame, when dirty
        ▼
Layout: yoga-layout (wasm)     apps/tui/src/layout/   (new)   one Yoga node per tree node, sizes clamped here
        │
        ▼
Paint: cell buffer             apps/tui/src/paint/    (new)   tree → cells, diff against last frame, flush
        │
        ▼
Terminal (stdout)              synchronized output, 16 slots or truecolor, kitty keyboard, SGR mouse

Terminal (stdin)
        │
        ▼
Input parser                   apps/tui/src/input/    (new)   bytes → KeyEvent | MouseEvent | Focus | Resize | Paste
        │
        ▼
One dispatcher                 apps/tui/src/keys/     (rewritten mechanics, same rules)
        │  tiers → layers → the focused stop's handler, or the typing target
        ▼
Region store owns focus        apps/tui/src/keys/regions.ts   a value, not a node property
```

Four folders are new and one is rewritten. Everything above the first arrow is untouched, and so is
everything in `packages/`.

## 1. The node tree

**What it is.** A tree of plain objects. Each node has a `kind` (`box`, `text`, `span`, `scrollbox`,
`input`, `textarea`, `pty`), a props bag, a parent, an ordered children array, a Yoga node handle, and
the rectangle the last layout gave it. Nothing else. No methods that do anything, no events, no
`destroy`, no `focused`, no `visible` flag with semantics. A node is data.

**How Solid drives it.** `solid-js/universal`'s `createRenderer` takes nine node operations:
`createElement`, `createTextNode`, `replaceText`, `setProperty`, `insertNode`, `isTextNode`,
`removeNode`, `getParentNode`, `getFirstChild`, `getNextSibling`. Ours are about a hundred lines. The
module that exports them replaces `apps/tui/src/kit/reconciler.ts` as the target of the `moduleName`
alias in `apps/tui/vite.config.ts`, so every JSX call in the process, including client-core's and a
sandboxed plugin's, lands here. It also exports `Dynamic`, `render`, and the JSX types, because six
files import `Dynamic` from `@opentui/solid` today and the tree host is one of them.

**What it replaces.** OpenTUI's `Renderable` class hierarchy, the `@opentui/solid` reconciler, and
both of its overrides in `apps/tui/src/kit/reconciler.ts`:

- The orphan-text rule goes. A text node under a box is legal: paint draws it as a one-line run.
  `apps/tui/src/kit/cells.tsx` keeps `slot`, `flatten`, and `hasNode`, because they say what a run
  *means* (its role and tone), which is a different question from where it may live.
- The destroy-on-detach race goes. `removeNode` unlinks the node and releases its Yoga handle. If
  Solid hands the same object back on resolve, `insertNode` links it and makes a new handle. There is
  nothing to be "already destroyed".

**Invariant.** The tree is the only retained UI state, and only Solid writes it. Paint reads it.
Nothing reads a node's rectangle except paint and the two things that legitimately need a size from
the last frame: a layout's breakpoint (`apps/tui/src/layouts/ListDetail.tsx` reads `element.width`
in a ref today) and a `pty` rectangle's `size()`. Both read the rectangle the last layout wrote, and
`onSizeChange` fires after a layout pass changes it, which is the contract those callers already have.

## 2. Layout

**What it is.** `yoga-layout` 3.2.1 from npm, the WebAssembly build of Yoga, loaded once at boot. One
Yoga node per tree node, created in `createElement`, freed in `removeNode`. `setProperty` maps the
flex props the kit uses (`flexDirection`, `flexGrow`, `flexShrink`, `flexBasis`, `gap`, the paddings
and margins, `width`, `height`, `minWidth`, `minHeight`, `alignItems`, `flexWrap`, `overflow`,
`border`) onto the Yoga setters. Spike 2 tallied those at 21 distinct props across the 154 `<box>`
and six `<text>` tags, and every one has a setter. A `text` node gets a measure function returning its wrapped or
truncated extent. `visible={false}` is `DISPLAY_NONE`, which is what OpenTUI does today, so a hidden
subtree costs no layout and no paint. Each frame calls `calculateLayout(cols, rows)` on the root and
reads computed left, top, width, height into each node's rectangle.

**Why Yoga and not a constraint solver.** The reference apps use constraint layouts and they read
well. But 153 `<box>` elements already say `flexDirection`, `flexGrow`, `gap`, and OpenTUI computes
their layout with Yoga. Using the same engine means the golden frames from phase 0 match cell for
cell, the layouts port without redesign, and the no-shrink rule in [tui.md](../../tui.md) § What the
TUI never does keeps its meaning. A constraint layout is a good idea to revisit once the painter is
ours and the pain of flex, if any remains, can be measured rather than argued. It is in
[refused.md](./refused.md) as parked, not rejected.

**What it replaces.** OpenTUI's Yoga, reached through its `./yoga` subpath, and the whole of
`apps/tui/src/renderGuard.ts`: the clamp that guards against `NaN` sizes moves into the one function
that reads computed sizes back, where it belongs, and there is no Zig side to throw.

**Invariant.** A node's rectangle is always four finite non-negative integers. The read-back clamps
and the test that pins the guard today (`apps/tui/src/renderGuard.test.ts`) becomes a test of that
function.

**Spike 2 answered** the entry and the speed, and its numbers are in
[phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md) § Spike 2. Take the synchronous
`yoga-layout` entry: both entries reach the same 71,736-byte wasm module, both cost about 20 ms to
load on Node 24.11.0, and the synchronous one is a top-level await that `main.tsx` already has. A
200-row `list-detail` at 120 by 40 lays out in 0.19 ms when one row's text changed and 1.9 ms when
all 200 did, against a 5 ms target. One correction to the paragraph above: an unmeasured node's
computed width and height come back `NaN`, not zero, so the read-back clamp is Yoga's problem too
and not OpenTUI's alone. Yoga does round sizes to whole cells by itself, at the default point scale
factor of 1.

## 3. Paint

**What it is.** A cell buffer of `cols × rows` cells, each a grapheme string, a foreground, a
background, and an attribute bitmask (bold, dim, underline, inverse). Paint walks the tree depth
first, skipping `DISPLAY_NONE` subtrees, and for each node draws into the buffer inside its clip
rectangle: a box draws its background and border, a text draws its runs wrapped or truncated to its
rectangle, a scrollbox offsets its children by its scroll position and clips to itself, a `pty` copies
cells from the emulator's buffer. The previous frame's buffer is kept. Flush walks both buffers, emits
a cursor move plus the changed run for every run that differs, wraps the whole write in `CSI ? 2026 h`
and `CSI ? 2026 l` so the terminal applies it atomically, and swaps the buffers.

**Scheduling.** Paint is on demand, as today. Solid's node operations set a dirty flag and request a
frame with `setImmediate`. A resize sets it too. Nothing runs when nothing changed. A frame is: layout
if any node's props changed since the last one, paint, diff, flush. One frame per turn of the event
loop at most, which is what coalesces a burst of signal writes.

**Colour.** `apps/tui/src/appearance.ts` keeps its six slots and its `slotColor`, but the type behind
a slot becomes ours: either a 16-colour index or an RGB triple, chosen by `COLORTERM` as today. Paint
emits `ESC[3Xm` for an index and `ESC[38;2;r;g;bm` for RGB. The default slot emits `ESC[39m`, the
terminal's own foreground, which fixes the white-on-white class at its source rather than by always
naming a colour. `apps/tui/src/kit/roles.ts` loses its `RGBA` and `TextAttributes` imports and its
`spanStyle` special case, because a span takes the same props a text does.

**Width.** `apps/tui/src/kit/cells.tsx` truncates by `String.length` today and `apps/tui/src/kit/glyphs.ts`
bans emoji to compensate. Paint measures with a grapheme segmenter and an East Asian width table, so a
wide character occupies two cells and a combining mark occupies none. Spike 3 chose `Intl.Segmenter`
with a hand table of the East Asian Width `W` and `F` ranges, in front of a `String.length` branch for
a pure-ASCII string. Not `string-width`: it doubles nine of the kit's own glyph names, because
`emoji-regex` matches a bare text-presentation emoji, and it is in the lockfile once as a dependency
of `@opentui/core`, so it leaves the tree in phase 4 rather than being ours already. `ellipsise` and
`pad` move onto the same measure. Six characters in `apps/tui/src/kit/glyphs.ts` measure two cells
today against a comment there that says every glyph is one; phase 2 replaces the glyphs.

**What it replaces.** OpenTUI's `OptimizedBuffer`, its Zig diff and flush, its console overlay, and
the stderr rules in `apps/tui/src/main.tsx`: stderr is no longer the file the renderer draws on,
because paint writes to stdout and only to stdout. Node's warnings still go to stderr, which is now
the wrong place for a different reason (it is the same terminal), so `main.tsx` keeps holding them
until exit. The listener cap goes with the `selection` event it existed for.

**Invariant.** The buffer after a frame is a pure function of the tree, the layout rectangles, the
focus value, and the emulator buffers. The test harness renders the same buffer without a terminal
and reads it as characters and as runs, which is what `apps/tui/src/kit/render.tsx` promises today.

## 4. Input

**What it is.** A parser over stdin bytes producing events: a key with name, modifiers, text, and
press or release; a mouse event with button, position, modifiers, and press, release, move, or wheel;
a focus in or out; a paste; a resize from `SIGWINCH`. It requests the kitty keyboard protocol with
the `disambiguate` flag on enter and pops it on exit, as `apps/tui/src/main.tsx` does today, so
`ctrl+return` and a lone Escape are distinguishable. It requests SGR mouse mode and DEC 1004 focus
reporting the same way. A terminal that ignores the requests gets the legacy parse: CSI sequences,
SS3, the `\x1b` timeout for a lone Escape, and `\r` for Return with or without Ctrl.

**What it replaces.** OpenTUI's `KeyEvent`, `MouseEvent`, `keyInput`, its capability detection, and
the `RAW_KEYS` table in `apps/tui/src/kit/render.tsx` that exists because OpenTUI's test input typed
`PAGEDOWN` as eight letters. The harness gets a `press(name, modifiers)` that constructs the event
directly, so there is no spelling to get wrong.

**Invariant.** One `KeyEvent` shape, ours, used by the keymap host, the footer, the rectangle's
encoder, and the harness. The engine is generic over the event type and never constructs one.

## 5. One dispatcher, one focus owner

This is the layer phase 1 builds, and it can be built before the painter exists.

**Focus is a value.** `apps/tui/src/keys/regions.ts` holds `focused: Node | null` in a signal it
alone writes, as today's `setFocusedNode`. What changes is that nothing else has an opinion. There is
no `renderable.focus()`, no `focused_renderable` event, no `blur()` that refuses. A click focuses by
the store hit-testing the mouse position against the tree's rectangles and calling its own `focus`.
A node leaving the tree is noticed because `removeNode` tells the store, and the landing pass runs.
A node becoming hidden is noticed because `setProperty('visible', false)` tells the store, and the
landing pass runs. That is the two "hiding asks for a pass" call sites in
[tui.md](../../tui.md) § Focus regions replaced by the one place a hide can happen.

**`onScreen` is a tree walk over data.** Alive means in the tree. Visible means no `DISPLAY_NONE`
ancestor. Both are reads of plain fields. The per-node `visible` lie is gone because there is no
second visibility to disagree with.

**The engine stays; the host adapter is ours.** `@opentui/keymap` is pure TypeScript with no native
code, the desktop drives it through its HTML adapter via the same
`packages/client-core/src/kit/keys/keymapHost.ts`, and every layer in `apps/tui` registers through
the shape it defines. Both hosts on one engine is how the two adapters cannot drift. What is wrong is
not the engine but where it asks for focus, and that is one method on the `KeymapHost` it is built
from. `apps/tui/src/keys/keymapHost.ts` (new) implements that host: `getFocusedTarget` returns the
store's node, `onFocusChange` subscribes to the store's signal, `onKeyPress` subscribes to our input
parser. The tier table in `apps/tui/src/keys/tiers.ts` and every registration shape
(`registerIntentLayer`, `bindKeys`, the intercept for a rectangle) are untouched. Tier 41 stays as
long as the engine breaks ties by registration order; `isTyping` becomes a check of the focused
node's kind. The typing gate as a layer rather than a runtime matcher is
[performance.md](../../performance.md) § 2026-09-03 — phase 9's
and composes with this. Writing our own dispatcher is parked in [refused.md](./refused.md).

**The footer reads the same table.** `apps/tui/src/chrome/bindings.ts` asks the engine which
bindings are live for the focused node, as it does today through `getActiveKeys`. lazygit's `?` menu
and gh-dash's `FullHelp()` are generated the same way, and it is why they cannot lie; phase 5 makes the
cheat sheet read the same source.

**Typing.** An `input` or `textarea` node has the keys when it is the focused node. The dispatcher
hands a key to the node's edit model when the bare-key and typing-exempt rules say so, exactly as
[tui.md](../../tui.md) § The five key groups already states. In phase 1 the edit model is OpenTUI's
`InputRenderable.handleKeyPress`, called directly; in phase 3 it is ours.

**Invariant.** Invariant 9 in `apps/tui/src/reachability.test.tsx` ("the renderer has X and the store
has X") is replaced by "the focused node is in the tree and on screen", and the other ten keep their
wording. `apps/tui/src/invariants.test.ts` keeps its greps: one `queueMicrotask` in `keys/`, one writer
of focus, no `overflow="scroll"` outside `scrolling.tsx`.

## 6. Widgets

Four things a `box` and a `text` cannot be.

**Scroll viewport.** A node kind with a scroll offset, a content extent from layout, and a
one-column bar. Paint offsets and clips. Wheel events hit-test to the nearest viewport ancestor.
`scrollChildIntoView` compares rectangles from the last layout, so the "second reveal on the frame
event" in `regions.ts` becomes a single reveal after layout in the frame that paints. About 150
lines, replacing `apps/tui/src/kit/scrolling.tsx`'s use of `ScrollBoxRenderable`.

**Input.** A single-line edit model: value, cursor, horizontal scroll, placeholder. Paint draws the
visible slice and the cursor when focused. About 150 lines.

**Textarea.** The hardest widget and the one to design before writing. It needs a multi-line model
with word wrap, a cursor with line and column, up and down within the text, Home and End, and word
motions. Spike 4 wrote it both ways and it is ours: 89 lines over a plain string plus a 44-line wrap
function, against 63 lines plus the same 44 over `@codemirror/state`. The 26 lines that package saves
cost 47,922 bytes in the eager graph, and this host runs no CodeMirror today, so the budget here is
135 lines rather than the 400 this file first guessed
([phase 0](./phase-0-baseline-and-spikes.md) § Spike 4).

**The `pty` rectangle.** `@xterm/headless` 5.5.0 is a dependency of `apps/desktop`,
`plugins/terminal`, and `plugins/agents` already, and `plugins/agents/src/server/usage/processRunner.ts`
shows the Node-side import shape. A `pty` node owns a headless `Terminal` at its rectangle's size,
writes the channel's bytes into it, and paint copies cells from `buffer.active` with their colours
and attributes, plus the cursor when entered. Resize calls `term.resize`. Input needs a key encoder,
because headless xterm has no keyboard: about 150 lines mapping our `KeyEvent` to the bytes a terminal
sends, honouring the application cursor mode and bracketed paste flags the emulator reports. The
Escape-pair contract and the "entered is a fact about the screen" rule in
[tui.md](../../tui.md) § The Rectangle contract carry over unchanged and get simpler, because
"on screen" is a tree walk. `apps/tui/src/kit/pty.ts` does not change: it already speaks to a
`CellTerminal` interface with `write`, `onData`, `onResize`, and `size`.

## 7. The test harness

`apps/tui/src/kit/render.tsx` and `apps/tui/src/harness.tsx` keep their exported shapes: `lines`,
`text`, `runs()`, `frame()`, `press()`, `scroll()`, `click()`, `resize()`, `done()`, and the shell
harness's `settle` and region helpers. Underneath, a test renderer is the real one with stdout
replaced by a buffer sink and stdin replaced by a queue the test pushes events onto. `press` pushes a
`KeyEvent`, not bytes, so the settle time for a lone Escape goes. `captureCharFrame` is the current
buffer's characters; `captureSpans` is its runs. The `describe.skipIf(!hasFfi)` gates go, and
`apps/tui/src/ffi.ts` is deleted.

## 8. Boot

`apps/tui/src/main.tsx` loses the Node version check, `createCliRenderer`, the console suppression,
and the listener cap, and gains: load Yoga, open the terminal (alternate screen, raw mode, the
protocol requests), install the input parser, and hand a `render` target to the app. The scripts in
`apps/tui/package.json` drop `--experimental-ffi`. `apps/tui/scripts/check-startup-graph.mjs` keeps
its ceiling; the eager graph loses about 1.5 MB of OpenTUI's JavaScript entry and gains the wasm and
our four folders, which the phase 4 measurement records.

## What this design does not do

- It does not change what any node draws at 80 by 24. [ui-design.md](../../ui-design.md) § Every
  node at 80 by 24 is the specification and the golden frames from phase 0 are its check.
- It does not add a `tui` surface, a per-host prop, or a new node. The kit is closed on both hosts.
- It does not virtualize every list. `Rows virtual` stays opt-in, and the diff pane's windowing is
  performance phase 9's, done after this.
- It does not make startup fast. Booting client-core is the cost and is owned elsewhere.
