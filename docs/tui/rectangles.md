# Terminal rectangles and limits

This page covers what the terminal client does without a floating layer, how it draws each kind of
`Rectangle`, what happens to unknown nodes, and what the client never does. It's part of
[the terminal client](../tui.md).

## There is no floating layer, so a panel needs somewhere to be laid out

A terminal has no layer to open over, so `Modal`, `Menu`, `Popover`, and `Picker` draw in flow, and a
child is always clipped to its parent's content box. So a panel opened inside a row is laid out in the
few cells its trigger was given. The agents pane header is a `Toolbar` of four controls in about 50
cells, and its new-session list once drew `ClaAv`, a provider name and its status overlapping.

An open `Menu` or `Popover` gives its own box a flex basis of the full width, so the bar wraps it onto
its own line with the whole width. Its trigger moves down with it, so the list sits under the control
that opened it. Outside a row the prop changes nothing.

A bar must not re-scope its children. Hoisting the panel through a context breaks three ways: a Solid
signal treats a function argument as an updater, children built in an effect belong to an owner
neither place controls, and a context provider wraps children in a memo, so every bar reruns as a
unit. `apps/tui/src/kit/kit.test.tsx § a toolbar` holds the layout-prop version.

A bar wraps instead of clipping. Yoga moves what doesn't fit onto the next line before it shrinks
anything, so an overfull bar costs a line, not its words. The gap is the column gap only, so wrapped
lines have no blank row between them.

## Rectangles

`Rectangle` is the kit's one admission that a pane needs pixels, and it has four kinds. On this host:

- **`pty` is native.** `attachPty(handle, io)` on `@acorn/plugin-api/ui` takes the channel: open at a
  size, bytes in, bytes out. The host draws the emulator: xterm on the desktop, `@xterm/headless` in
  cells. The desktop parses the same PTY with the same parser, so output reads the same on both.
  Headless xterm has no keyboard, so `apps/tui/src/kit/ptyKeys.ts` encodes a `KeyEvent` into the bytes
  a terminal sends. It reads application cursor mode and bracketed paste off the emulator when a key
  arrives. The caller's code is the same on both hosts, which is how Docker's exec panel and the
  editor's `$EDITOR` window each work here in about 15 lines.
- The terminal plugin's desktop drawer keeps its xterm. This host opens a full-screen session list
  and a native PTY rectangle from a task with `t` or from the palette, and sessions persist after the
  view closes ([terminal](../terminal.md) § Client). `term:out` is the one binary frame on the Node's
  socket, and the in-process broker hands the bytes straight to the client. A `pty` rectangle takes
  `hidden`, which keeps the box and takes it off screen, so a tab strip over several keeps every
  emulator and channel alive.
- **`editor` draws its box and says the file opens there.** The editor pane's terminal mode runs your
  own editor in a PTY on the Node, so in cells it draws
  ([the editor pane](../editor/editor-pane.md) § Editing in your own editor).
- **`webview` and `frame` draw their `<Fallback>` child**, or a line naming what's missing.

`Rectangle` is `absent` in the support matrix, because this host recognizes the kind and draws it
natively. The `rectangle` extension kind, a sibling region an iframe fills, is absent.

A remote tree can ask its host to present one of its plugin's overlay frames
([companion overlays](../plugins/cooperative-extension-points.md#companion-overlays)). There's no iframe here, so
`apps/tui/src/plugins/RemoteTree.tsx` answers `overlay.open` with a typed `unsupported_host`. The
plugin catches it and keeps its static preview, and the extension point owner's fallback is what you
see. `owner.invoke` works on both hosts through the shared check in
`packages/client-core/src/host/tree/hostRequests.ts`.

## Unknown nodes and failed trees

Both hosts behave the same here. A node type this build can't draw is omitted, a failed slot draws
nothing, and one error boundary contains each tree. Plugin failures go to diagnostics without
replacing the owner's UI with an inline error.

## What the TUI never does

The terminal client never does these things:

- Read the terminal width inside a node or a layout. A layout asks its own region whether it's narrow.
- Draw a hover state, drag, or open a pointer context menu. The pointer focuses a clicked control or
  viewport and scrolls with the wheel or trackpad. The keyboard is the complete path.
- Accept `class`, `style`, or a DOM attribute. The type-level test refuses them, and the tree protocol
  drops them on the wire.
- Invent a node. A pane that needs something the kit lacks asks the kit, and the kit answers for both
  hosts or refuses for both.
- Shrink to make room. Yoga takes a height deficit out of every child that gives, and a one-line row
  given half a line lands on the line above. Every block node and row refuses to shrink, and the
  region around them clips or scrolls. A scroll box around a whole pane is refused, with the reason in
  `apps/tui/src/chrome/PaneRow.tsx`: its free-sized content breaks width-sensitive layouts.
