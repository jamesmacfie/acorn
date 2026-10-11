# The terminal client

`acorn` with no arguments is the terminal client: client-core booted under Node, drawing the same pane
tree as the desktop, in cells. Read this page to find the topic page that owns a part of it. With a
subcommand, `acorn` runs the [headless command-line client](./cli.md) instead, which shares custody
but doesn't load the renderer.

The terminal client is the second host of the closed kit, and the test that the kit describes intent,
not layout. `apps/tui/` holds the host, the cell renderer, and the terminal versions of the kit and
layouts. The panes, query layer, keymap, palette session, focus intents, and tree protocol are
`packages/client-core`'s, unchanged. No plugin writes terminal UI, declares a `tui` surface, or learns
which host it's on.

Three docs have "terminal" in the name. This one is acorn running in a terminal.
[Terminal](./terminal.md) covers PTY sessions in the desktop drawer and this host's session view.
[Managed agents](./managed-agents.md) runs the same providers over a protocol with a ledger.

## What it is, in one screen

The screen has five parts:

```text
Topbar:   one line. Workspace > project and task count on the left; the open branch, node state,
          and Task: title on the right. Focusing another task previews it as Task to open: title
Left:     three framed panels — Menu, the sources; Browse, what is under the chosen one; Tasks
Main:     one pane, or the chosen source's detail, with a strip of pane labels above it
Overlays: commands, setup, settings, file paths, task promotion, terminal sessions, and confirmations
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

In **Tasks**, moving the caret previews a row's title in the top bar as **Task to open**. Press Enter
to open it. Moving the caret alone leaves the open pane in place.

Run it from a checkout with `pnpm --filter @acorn/tui dev`. `pnpm --filter @acorn/tui capture` prints
one frame at a fixed size against the fixture in `apps/tui/src/fixture.ts`, with no TTY, and
`capture -- notes` picks a pane by name. To drive it as an agent, see
[agent drivers](./local-development/agent-drivers.md#drive-the-terminal-client).

## Pages

[Process](./tui/process.md) covers the Node runtime range, attaching to or starting a Node, remote
Nodes, where the client keeps files, signals, and the in-process broker.

[The host switch](./tui/host-switch.md) covers booting client-core under Node, the platform groups,
the build aliases that make a pane draw in cells, and the router.

[Rendering](./tui/rendering.md) covers the tree, layout, paint, and input pipeline, controls as
stops, color, and sizes.

[Rectangles and limits](./tui/rectangles.md) covers panels without a floating layer, each rectangle
kind, unknown nodes, and what the client never does.

[Chrome](./tui/chrome.md) covers the screen, its panels, task markers, the palette, overlays, and the
notification count and inbox.

[Sources and settings](./tui/sources-and-settings.md) covers manifest rail sources, loaded document
regions, and the Settings route.

[Keys](./tui/keys.md) covers the transcript shortcuts, the keymap adapter, and the five key groups.
[Typing](./tui/typing.md) covers fields and the typing layer. [Focus](./tui/focus.md) covers the
region store. [Navigation](./tui/navigation.md) covers the region cycle, columns, Escape, and the
global keys. [Collections and scrolling](./tui/scrolling.md) covers lists, viewports, and the diff
window. [Dialogs and rectangles](./tui/traps.md) covers how a dialog or PTY holds the keys.
[Footer and key trace](./tui/footer.md) covers the footer line, the cheat sheet, and
`ACORN_TUI_KEYS_TRACE`.

[Reporting and invariants](./tui/reporting.md) covers telemetry, the 11 keyboard invariants, and what
must never happen.

[Loaded plugins](./tui/plugins.md) covers install, the worker sandbox, worker lifetime, reserved
regions, custody, and the trust prompt.

[What a plugin loses](./tui/plugin-losses.md) covers each extension kind and host slot compared with
the desktop.

[Tests](./tui/tests.md) covers the harness, the boot test, and the agent driver.

Proposals for this client, such as a loopback token mint, are in
[the terminal review](./future/tui-review/open-doors.md).

## Related

- [UI design](./ui-design.md) owns the closed kit, every node at 80 by 24, and the role tokens both
  hosts read.
- [Pane layouts](./panes/layout.md) owns each layout's terminal projection.
- [Focus and typing](./command-palette-and-shortcuts/focus-and-typing.md) owns the intents and layers.
- [Security](./security.md) owns the trust boundaries and the containment ladder.
- [Standalone Node distribution](./node-distribution.md) covers reaching a Node with `acorn` from the
  Node's side.
- [First-party plugins](./first-party-plugins.md) lists what each plugin loses here.
- [future/bundle.md](./future/bundle.md) covers packaging `acorn` with the Node.
