# Terminal client: open doors

Date: October 3, 2026. Status: proposals, moved from the "Doors left open" section of
[the terminal client](../../tui.md) by the documentation overhaul. Nothing here is built.

These are directions the terminal client's design leaves room for:

- **A loopback token mint.** Attaching to a Node the desktop started needs a pairing code
  ([process](../../tui/process.md#attach-or-start)).
- **"Open a pairing window" as a terminal client command.** A client attached to the local Node is an
  out-of-band channel of its own, and it answers `SIGUSR1` not existing on Windows.
- **Tunnels through the fleet group.** The platform seam models them, and nothing draws them.
- **Pointer actions beyond scrolling and focus.** Drag, hover, and context menus stay keyboard-only.
- **Sixel or kitty graphics** for image attachments, if terminals that support them turn out to be
  common.
- **A container image carrying `acorn`**, so `docker exec -it <container> acorn` attaches from inside.
- **The Node half out of process.** The worker factory, the flags, and the two ports are the design
  rung 2 inherits. It still needs `ctx` as authorized calls and a plugin-scoped token behind them
  ([the node realm](../../security/plugin-node-realm.md#rung-2-isolated-node-realm)).
- **A read-only text view inside an `editor` rectangle**, with a find bar. The box and `$EDITOR` cover
  the case.
- **A test for the no-shrink rule.** One `flexShrink` left at its default on a pane's path brings back
  overlapping rows, and only a pane test noticing a missing string catches it
  ([what the TUI never does](../../tui/rectangles.md#what-the-tui-never-does)).
- **A file-backed device preference store**, so the Settings route can change notification channels
  and other device settings instead of pointing at `ACORN_TUI_NOTIFY` and `acorn.json`.
- **A modal comment box**, entered with a key as gh-dash does, if a field ever needs more keys than a
  panel can spare ([typing](../../tui/typing.md#tab-in-a-field)).
- **Sharing `editor_mode` with the desktop**, so a person's editor choice follows them between hosts,
  and attaching to a running editor process instead of spawning a second one
  ([the editor pane](../../editor/editor-pane.md#editing-in-your-own-editor)).

## Verify before building

- Read [the terminal client](../../tui.md) and its process and plugin pages.
- Check `apps/tui/src/node/open.ts`, `apps/tui/src/platform.ts`, and
  `apps/tui/src/plugins/workerFactory.ts`.
