# The terminal drawer

This page covers the client side of the terminal plugin: the desktop drawer, the phone's pane, why its
terminals outlive their task, the `pty` rectangle and `attachPty`, and the terminal client's sessions view. The client is
in `plugins/terminal/src/client/`.

## Client

The terminal drawer is a bottom task surface with tabs, a remembered active tab per task, profile
launchers, status badges, and xterm rendering. It's available when the desktop terminal capability is
present. The Agent pane shows managed sessions, and the drawer holds shells and raw provider TUIs.

The drawer is a `drawer` slot, not a pane. The `Drawer` host component draws its box between the two
icon rails and above the task footer, from a height and a maximized flag the plugin supplies. Inside
it, everything is a kit node: `DocumentTabs` draws the session strip with the profile `Menu`, **+**,
and close in its actions slot, `SplitHandle` is the resize grip, and the session is a
`Rectangle kind="pty"`. The kit owns the box and the keyboard contract, so Escape leaves a focused
terminal.

`terminal:toolbar-actions` draws up to four other plugins' controls after **Stop**. A contributor gets
the selected session's id, title, and running state, and can ask for `interrupt`. The drawer sends the
same interrupt as its own control, and only after a person's press inside that contributor's tree
([toolbar actions](../plugins/toolbar-actions.md)).

## The phone's terminal pane

A phone draws panes and no drawers, so the plugin registers a **Terminal** pane with
`formFactor: ['narrow']`, last in the bar. The drawer (`TerminalPanel.tsx`) and the pane
(`TerminalPane.tsx`) draw one body, `TerminalSessions.tsx`: the tab strip, the profile menu, and a
surface per session. The drawer adds its box, grip, and Hide. The pane loads after the first frame.

The sessions live on the Node, so a phone reaches them over its channel like any client. With no
sessions, the pane starts one from the default profile in **Settings** > **Terminal**, as the drawer's
button does, or shows **New terminal**. Leaving the pane leaves its sessions running, as hiding the
drawer does, and closing the last tab leaves the pane empty.

While a terminal has focus, which on a phone is while the keyboard is up, a row of keys sits at the
foot of the pane, above the keyboard. Its buttons take `keepsFocus`, so a press doesn't close the
keyboard. Each key goes in through xterm, as typing does (`keyRow.ts`):

| Key | Bytes |
| --- | --- |
| Esc | `ESC` (0x1b) |
| Tab | `HT` (0x09) |
| Arrows | `ESC [ A` to `ESC [ D`, or `ESC O A` to `ESC O D` while the program asks for application cursor keys, as `vi` and `less` do |
| Ctrl | Nothing. The next character typed becomes its control code, so `c` sends 0x03. Letters, `@`, `[`, `\`, `]`, `^`, `_`, space, and `?` have one. Anything else is sent unchanged. Either way, Ctrl lets go. |

## Terminals outlive their task view

A terminal tab stays alive until it's closed. Its xterm and attachment last from the first frame the
tab shows until its session leaves the roster: closed, removed, killed, its task archived, or the
Node switched. Output that arrives while you're on another task keeps parsing into it for 10 seconds
(below), so coming back soon needs no new xterm, no `term:attach`, and no rebuild on the Node. A failed roster read keeps every
terminal. Only a roster the Node answered removes one.

Terminals are the exception to the rule that a pane's view doesn't outlive its task
([pane models](../panes/models.md)). A terminal is a running program you expect to keep running, its
state is the emulator's buffer, and rebuilding it from the Node's ring loses scrollback and costs an
xterm, a WebGL context, an attach, and a parse.

Inside the drawer, every open session gets a surface and all but one are hidden. Across tasks the
drawer unmounts, so the xterms don't belong to it. A module-level map keyed by Node and session
(`heldTerminals.ts`) holds each one, and a surface lends it an element while drawn (`liveXterm.ts`).
A terminal nobody draws is out of the document, and xterm's renderer pauses. One that stays hidden
for 10 seconds (`HIDDEN_DETACH_MS`) also detaches, so the Node stops sending its output and the page
stops parsing it. Showing it attaches again, and the Node sends its screen after a reset, so what it
missed draws over a cleared terminal.

The cost is the parse, about 20 ms per megabyte of colored output in Chromium out of the document,
against about 25 ms on screen. WebKit hasn't been measured. A WebKit page gets 16 live WebGL contexts,
so only the four terminals shown most recently keep one (`WEBGL_TERMINALS`). The rest use the DOM
renderer until shown. A lost context falls back the same way.

A surface builds its xterm on the first frame it's shown, because xterm measures cells from a
laid-out box. The list iterates session IDs, not rows, because the roster is replaced on every refresh.
`<For>` over rows would rebuild every surface, and `<Index>` would hand a closed tab's box to the next
session.

## Switching Nodes

A Node switch batches the selection, remembered device state, and the eviction event. The outgoing
channel and session consumers retire before the incoming ones start. Channel slots and held xterms are
keyed by Node and session, and bind HTTP, input, attach, resize, and cleanup to their Node, so stale
cleanup can't detach a replacement. Returning to a Node builds a fresh subscription. Deferred profile,
create, close, and focus callbacks carry the view generation and Node, so an outgoing creation can't
select a tab in another view. A failed first roster read doesn't auto-launch a session.

## The pty rectangle

In the terminal client, a `pty` rectangle is native: `apps/tui/src/kit/rectangle.tsx` draws
`@xterm/headless` in cells, and the PTY's bytes go straight in. The PTY stays on the Node, reached
over the same `term` channel. While a rectangle is entered every key is the PTY's, `Ctrl+C` included.
Escape alone leaves, and Escape twice sends one Escape through.

A plugin doesn't build its own xterm. It describes the channel in the four members of `PtyIo`
(`packages/client-core/src/kit/lib/pty.ts`): open at a size, bytes in, bytes out, and a word to print
when the far end exits. `attachPty(handle, io)` on `@acorn/plugin-api/ui` is the host's end, an xterm
in the DOM and `@xterm/headless` in cells. Docker's exec panel and the editor's `$EDITOR` window use it
([editing in your own editor](../editor/editor-pane.md)). The drawer keeps its own xterm, because it
carries the theme, font size, WebGL renderer, and the Shift+Enter rule, none of which apply in cells.

## Native terminal client sessions

The terminal client opens a task-scoped Sessions view from the task or the palette. The terminal
plugin's session store is the roster, and its HTTP routes and `term` channel are the transport. The
host draws a session picker, profile choices, and one native `pty` rectangle. A new session starts in
the task's worktree. Closing the view detaches and leaves the session running, and reopening restores
the task's last session. Enter gives the PTY the keyboard and Escape returns. The same toolbar
contributors draw under the view's actions, with the same person rule.

An agent handoff uses the same session row. The view can end the provider terminal after a second
Enter, then return input to managed mode. Return is disabled while the linked PTY runs. The host calls
the agents plugin's handoff client contract after the Node accepts the change.
`plugins/terminal/src/contract/hostClient.ts` gives this host the transport and roster, and other
plugins use the narrower `sessionsClient.ts` ([terminal client chrome](../tui/chrome.md)).
