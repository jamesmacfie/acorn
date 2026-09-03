# Phase 3: widgets and the pty

Status: not started. Waits on phase 2 and on phase 0's spike 4.

## Goal

The four node kinds a box and a text cannot be, drawn by our painter: the scroll viewport, `Input`,
`Textarea`, and the `pty` rectangle. Mouse events hit-test against the tree. The input parser from
phase 2 is wired into the dispatcher. At the end, every golden frame matches under
`ACORN_TUI_PAINTER=own`, and the keys, panes, chrome, and reachability suites pass under it.

## Why this phase

Phase 2 proves the painter draws a static tree the way OpenTUI did. A pane is not static: it scrolls,
it takes typing, and the one rectangle that defines an agent workspace is a terminal. Those four are
the only places the kit's components reach for something with state of its own, and they are the
places where the design has to make a decision rather than transcribe one.

They are also where OpenTUI's version earned its keep, so this phase is honest about what it
replaces. `ScrollBoxRenderable` owns an offset, a bar, wheel acceleration, and clamping;
`TextareaRenderable` is an edit buffer with word wrap; `EmbeddedTerminalRenderable` is Ghostty's
emulator with its own key encoder. The replacements are smaller because they only need what the kit
asks for, and the kit asks for little: the composer, the filter field, the palette's field, and a
`Rectangle kind="pty"`.

## Scope

In:

- **The scroll viewport.** A `scrollbox` node kind whose component (`apps/tui/src/kit/scrolling.tsx`,
  rewritten in place) owns `offset` as a signal and passes it as a prop. Layout measures the content
  child at unconstrained height and the viewport at its flex height; paint translates the content by
  `-offset`, clips to the viewport, and draws a one-column bar when content exceeds the viewport.
  `scrollBy` and `scrollTo` clamp to `[0, contentHeight - viewportHeight]`. `scrollChildIntoView`
  compares the child's rect to the viewport's rect from the *current* frame's layout, which is why
  the second reveal goes: the reveal runs after layout in the same frame that paints. Wheel events
  arrive from the parser, hit-test to the innermost viewport under the pointer, and move its offset.
- **`Input`.** An `input` node kind. The component in `apps/tui/src/kit/asking.tsx` owns `value`,
  `cursor`, and a horizontal `scroll` as signals and passes them as props; the dispatcher's typing
  hand-off calls an `edit(event)` function exported beside the component that returns the new model
  or `false` for a key it does not take. Paint draws the visible slice, the placeholder when empty,
  and writes the terminal cursor position when the node is focused. About 150 lines, most of them
  the key table: characters, Backspace, Delete, Left, Right, Home, End, Ctrl+A, Ctrl+E, Ctrl+U,
  Ctrl+W, and Return for `onSubmit`.
- **`Textarea`.** A `textarea` node kind over a model of ours, which spike 4 wrote and measured at
  89 lines beside a 44-line wrap function; `@codemirror/state` saves 26 of those and costs 47,922
  bytes in the eager graph, so it loses. Start from the spike's `wrap.js` and `plain.js`. The
  component owns the model, `edit(event)` handles insert, delete, the four arrows over visual lines,
  Home, End, word motions, and Return (newline; `ctrl+return` is `commit` and stays the dispatcher's),
  and paint draws the visible wrapped lines with the cursor. Home and End go to the visual line's ends,
  not the document's, which is a deliberate difference from `@opentui/core`'s
  `defaultTextareaKeyBindings`. The component holds the wrapped rows beside the model and rebuilds
  them when the text or the width changes, rather than per keystroke: a wrap of a 400-line note is
  163 microseconds. Selection and undo are out. Nothing under `apps/tui/src` reads either, and there
  is no way to copy a selection out. `Composer` and `MentionTextarea` in `asking.tsx` build
  on it as they build on `TextareaRenderable` today; their `plainText` reads become a `value()` read.
- **The `pty` rectangle.** A `pty` node kind whose component (`apps/tui/src/kit/rectangle.tsx`,
  rewritten in place) owns a headless xterm `Terminal` sized to the last rect. On `onSizeChange` it
  calls `term.resize`. It implements the `CellTerminal` interface `apps/tui/src/kit/pty.ts` already
  speaks (`write`, `onData`, `onResize`, `size`), so `pty.ts` does not change. Paint copies
  `buffer.active` cells into the rect with their fg, bg, bold, dim, underline, inverse, and the
  cursor when the rectangle is entered. A key encoder (new, beside the component) maps our `KeyEvent`
  to the bytes a terminal sends, honouring application cursor keys mode, bracketed paste, and the
  modifyOtherKeys or kitty state the emulator reports through its modes; the emulator's own `onData`
  carries responses (device attributes, cursor position reports) back to the PTY as today. The
  Escape-pair contract, the 400 ms window, the arming on Enter, and "entered is a fact about the
  screen" carry over verbatim from [tui.md](../../tui.md) § The Rectangle contract; `onScreen` is now
  a walk over our tree.
- **Mouse hit testing.** A `hit(x, y)` over the tree returning the deepest node whose rect contains
  the point. A press walks up to the nearest stop the store recognises and focuses it, as phase 1's
  design says; a wheel walks up to the nearest viewport. Nothing else is done with the pointer, per
  [tui.md](../../tui.md) § What the TUI never does.
- **Wiring the parser.** `apps/tui/src/keys/install.ts`'s host adapter (phase 1) subscribes to the
  parser's key events instead of `renderer.keyInput`. Focus in and out feed `setHostFocused` as the
  DEC 1004 events do today. Paste reaches the focused input or textarea as text.
- **The golden comparison** now covers every golden, and `apps/tui/src/kit/kit.test.tsx`,
  `apps/tui/src/layouts/layouts.test.tsx`, `apps/tui/src/keys/keys.test.tsx`, `apps/tui/src/panes.test.tsx`,
  `apps/tui/src/chrome/chrome.test.tsx`, and `apps/tui/src/reachability.test.tsx` run under `own` with
  no skips.

Out: selection and copy inside the pty (OpenTUI's emulator had it; nothing in the kit exposes it;
`CopyButton` is the copy path). Sixel or kitty graphics. An `editor` rectangle that is anything other
than a box handing off to `$EDITOR`, which is [tui.md](../../tui.md)'s door left open and stays open.
Virtual `Rows` changes; the component stays the virtualiser it is, and the diff pane's windowing is
performance phase 9.

## Design

**Widgets are components with state, not nodes with behaviour.** This is the sentence that keeps the
node tree plain. A `scrollbox` node has an `offset` prop; the *component* has the signal, the key
handlers, and the clamp. Paint reads the prop. Nothing on the node knows how to scroll, so nothing on
the node can be in a state the component disagrees with. The same for `value` and `cursor` on an
input, the model on a textarea, and the `Terminal` on a pty (passed by reference as a prop, since
paint must read its buffer).

**The dispatcher hands a key to a component, not to a node.** Phase 1 calls `handleKeyPress` on an
OpenTUI renderable. Here the component registers its `edit` function with the store when it takes
focus (`stops.ts` already has the registration shape for a pressable), and the dispatcher calls it.
`isTyping` is "the focused node's kind is `input` or `textarea`", read off the node.

**xterm headless is the emulator because it is already here.** `apps/desktop`, `plugins/terminal`,
and `plugins/agents` depend on `@xterm/headless` 5.5.0, and
`plugins/agents/src/server/usage/processRunner.ts` shows the Node import shape (`createRequire` for the
CommonJS build). The desktop draws the same PTY through xterm.js in the browser, so a program's output
is parsed by the same parser on both hosts and looks the same. The one thing headless xterm lacks is a
keyboard, hence the encoder. The mapping is
documented in xterm.js's own `Keyboard.ts` for the browser build; ours covers what a terminal program
can receive, not what a browser can send.

**Cursor position is paint's.** One node at most is focused and typing; paint writes `CSI row;col H`
for its cursor after the frame and shows the cursor, and hides it otherwise. An entered pty draws the
emulator's cursor at its buffer position translated into the rect. OpenTUI's `setCursorPosition`
becomes two lines in flush.

## Code touched

- `apps/tui/src/kit/scrolling.tsx`, `apps/tui/src/kit/asking.tsx`, `apps/tui/src/kit/rectangle.tsx`:
  rewritten in place under the switch. While the switch exists each file has both implementations
  behind `__ACORN_PAINTER__`; phase 4 deletes one.
- `apps/tui/src/paint/` grows the four kinds' draw functions and the cursor write.
- `apps/tui/src/layout/` grows the unconstrained content measure for a viewport.
- `apps/tui/src/input/` grows nothing; the parser is complete from phase 2. The pty key encoder is
  `apps/tui/src/kit/ptyKeys.ts` (new).
- `apps/tui/src/keys/regions.ts`: `hit`, and the two hide-site `scheduleSettle` calls move into
  `setProperty('visible')`.
- `apps/tui/src/keys/install.ts`: the parser subscription.
- `apps/tui/src/keys/stops.ts`: registering an `edit` function.
- `apps/tui/package.json`: `@xterm/headless` added at the version the other three packages pin.

## Tests

- `apps/tui/src/kit/scrolling.test.tsx`: existing cases, plus a wheel over a viewport moves its offset
  and not the focus, and a reveal of a freshly mounted row reads the current frame's geometry (the
  case the second reveal existed for, now passing with one reveal).
- `apps/tui/src/kit/kit.test.tsx`: the `Input`, `Textarea`, `Composer`, and `MentionTextarea` cases
  unchanged, plus cursor motion over a wrapped textarea and a paste into each.
- `apps/tui/src/kit/ptyKeys.test.ts` (new): every key the tiers name encodes to the bytes a real
  terminal sends in normal and application cursor modes, checked against a recorded table.
- `apps/tui/src/kit/rectangle.test.tsx` (new or existing cases moved): a pty rectangle draws what the
  emulator holds after a `write`, resizes the emulator on a layout change, hands Enter and Escape to
  the contract, and stops taking keys when hidden.
- The reachability suite under `own`, both sizes, all eleven invariants.
- `apps/tui/src/golden.test.ts` (new in phase 2): every golden matches.

## Docs owed

None until phase 4. The pty encoder's mode table is documented in its own file header.

## Done when

- Every golden matches under `own`.
- Every suite under `apps/tui/src` passes under `own` with no phase 3 skip markers left.
- `apps/tui/src/kit/pty.ts` is byte-identical to its state at `9e5d90ca`, which is the proof the
  `CellTerminal` seam held.
- A `$EDITOR` handoff (vim in an `editor` rectangle, per [editor.md](../../editor.md) § Editing in your
  own editor) works in a real terminal with the switch on, checked by hand and noted here with the
  terminal it was checked in.

## Verify before building

- Spike 4's answer is written in [phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md).
- Confirm `@xterm/headless` is still 5.5.0 in the three packages and that `buffer.active.getLine(y)`
  and `getCell(x)` with `getFgColor`, `getBgColor`, `getFgColorMode`, `isBold`, `isDim`,
  `isUnderline`, `isInverse`, `getWidth`, and `getChars` are still the API; read the installed
  `typings/xterm-headless.d.ts`.
- Confirm `apps/tui/src/kit/pty.ts` still speaks `CellTerminal` with the four members, and that
  nothing else implements the interface.
- Confirm `apps/tui/src/kit/asking.tsx` still reaches `TextareaRenderable` only through `plainText`
  and the `onContentChange` and `onSubmit` props, so the textarea's surface is what this file says.
- Read [tui.md](../../tui.md) § The Rectangle contract and § Scrolling viewports in full first.
