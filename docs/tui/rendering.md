# Terminal rendering

This page covers how the terminal client turns a Solid tree into cells, and the rendering decisions
only this host makes. Read it before you change the renderer or a kit component's terminal half. It's
part of [the terminal client](../tui.md). [UI design](../ui-design.md) owns what every kit node draws
at 80 by 24 and the four support levels. [Pane layouts](../panes/layout.md) owns each layout's
terminal projection.

## How a frame is drawn

Four folders under `apps/tui/src/` draw a frame, and a fifth answers the keyboard. Client-core, the
kit, the layouts, and the chrome write JSX and know nothing about them:

```text
Solid components                                        unchanged
        │  JSX compiled with generate: 'universal', moduleName → tree/renderer.ts
        ▼
Node tree: plain objects        tree/       what Solid creates, patches, and moves
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

**The tree.** A node is a `kind`, a props bag, a parent, an ordered children array, a Yoga handle,
and the rectangle the last layout gave it. It has no behavior, events, `destroy`, or focus. The tree is
the only retained UI state, and only Solid writes it. Paint reads it. Two other readers want last
frame's size: a layout's own breakpoint, and a `pty` rectangle's `size()`.

**Layout.** `yoga-layout`'s WebAssembly build loads once at boot. `createElement` makes one Yoga node,
freed when the owner that created it is disposed, so a `Suspense` never frees a handle it's about to
hand back. `visible={false}` is `DISPLAY_NONE`, so a hidden subtree costs no layout or paint. Each
frame lays the root out at the terminal's size and reads four numbers back into every node.

**Paint.** A buffer of `cols × rows` cells, each a grapheme, a foreground, a background, and an
attribute bitmask. Paint walks the tree depth first inside each node's clip rectangle and keeps the
previous frame's buffer. The flush moves the cursor and writes each changed run, wrapped in
`CSI ? 2026 h` and `CSI ? 2026 l`, so the emulator applies the frame at once. A tree change asks for a
frame, coalesced to one per event-loop turn, so an idle screen costs nothing. Width is
`Intl.Segmenter` for cluster boundaries and a table of East Asian Width `W` and `F` ranges, with an
ASCII fast path (`apps/tui/src/width.ts`). Every color is a slot or, where `COLORTERM` allows, 24-bit.
The buffer after a frame is a pure function of the tree, the rectangles, the focus value, and the
emulators' buffers, which lets the test harness draw it with no terminal.

**Input.** A parser over stdin bytes produces keys with a name, modifiers, text, and press or
release, mouse events, focus in and out, pastes, and resizes from `SIGWINCH`. It asks for the kitty
keyboard protocol on entry and pops it on exit. A terminal that ignores the request gets the legacy
parse: CSI sequences, SS3, and a timeout for a lone Escape. There's one `KeyEvent` shape
(`apps/tui/src/keyEvent.ts`), read by the keymap host, the footer, the `pty` rectangle's encoder, and
both test harnesses.

## Rendering

The component table is `apps/tui/src/kit/components.tsx`, keyed by `KitNodeName` like the DOM host's.
`tools/arch/kitTable.test.ts` holds four lists to one: the 80 by 24 appendix, the support matrix, and
both hosts' tables. An entry can be a component or a loader
(`packages/client-core/src/host/tree/kitEntry.ts`). Here every entry is a component, and the table
loads with `apps/tui/src/plugins/RemoteTree.tsx`, outside the startup graph. Presentation components
live by behavior under `apps/tui/src/kit/showing/`. `TreeHost` draws each root under a `Suspense`
with a `null` fallback, which is safe because a node that leaves the tree is unlinked and kept, so a
boundary that suspends twice gets the same objects back. Five prop types are the DOM kit's, imported
as types: `ButtonProps`, `InputProps`, `SelectProps`, `PickerProps`, and `MentionTextareaProps`.

### Controls are stops

A DOM `<button>` is focusable, draws a ring, and clicks on Enter. A cell does none of that, so
`apps/tui/src/keys/stops.ts` supplies all three. `pressable(box, options)` sets the `focusable` flag
unless the control is disabled, binds `activate` to the handler in `focus` target mode, so Enter on a
button inside a row belongs to the button, and adds the press half of a click. Its companion
`stop(options)` returns the `ref` a component hands its box and a `focused()` accessor. The stop layer
sits at priority 42, above a collection's 40, so the order never depends on registration order. The
typing shadow is at 41 ([typing](./typing.md#typing-is-a-layer)).

A focused control draws `litControl` from `apps/tui/src/kit/roles.ts`: `strong` in the `accent` tone,
with the same characters. So `apps/tui/src/kit/render.tsx` reads a frame back as colored runs as well
as characters, because a focused `[Save]` and an unfocused one have the same six characters.

### Color

`apps/tui/src/appearance.ts` collapses a theme's tokens to the terminal's 16 slots plus `dim` and
`bold`. `roleCell()` returns the cell style for a role value, and `ignored` returns nothing. The
terminal reads the device's `acorn.json` through the same schema and setters as the desktop. On a
truecolor terminal, a built-in theme uses six color primitives generated from the desktop theme
stylesheet. Without a theme or truecolor, the terminal uses its own palette. Follow-system mode uses
the configured light theme, because terminals expose no reliable light or dark signal.

### Sizes

The seven layout components are in `apps/tui/src/layouts/`, reached through
`packages/client-core/src/host/layouts/table.ts`.

`apps/tui/src/layout/pass.ts` clamps a node's size where it's read back. Yoga returns `NaN` for a node
it hasn't measured, and a node that joins after a layout pass is exactly that for one frame. The
read-back turns `NaN` into zero, which paints nothing, and the next frame has the real size. Only
`Number.isFinite` can tell, because an empty box and a hidden subtree are legitimately zero. A left or
top can be negative, as an overflowing centered child is, and clipping is paint's job. So the rule is
four finite integers, and the width and height are never below zero.

### Nothing on stderr

Nothing may write to stderr while the renderer owns the terminal, because a stray line garbles the
screen until the next full repaint. `main.tsx` holds three things and prints them after handing the
terminal back: Node's process warnings, deduplicated; a started Node's piped stderr; and every
`console` call from renderer creation until `quit`. `format` from `node:util` renders them, so an
`Error` keeps its stack.

A text node under a box paints as a one-line run, so `<Stack>{count()}</Stack>` needs no wrapper.
`removeNode` unlinks a node and keeps it, so there's nothing to be already destroyed when a `Suspense`
boundary suspends twice.

The shell keys each source match by its component. Switching to a lazy source must replace the
source's region and its focus claim together, or the old tree stays under the resolved boundary and
the new controls are unreachable. `sourceSwitch.test.tsx` covers that.
