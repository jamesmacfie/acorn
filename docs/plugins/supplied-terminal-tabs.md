# Supplied terminal tabs

This page covers the client capability that lets another plugin put read-only tabs in a task's
terminal strip. Read it before you supply a tab, or before you change how the strip treats one. It's
part of the [plugin reference](../plugins.md), beside [toolbar actions](./toolbar-actions.md).

## What a supplier gives

The terminal plugin declares `TERMINAL_TAB_SUPPLIER` in
`plugins/terminal/src/contract/suppliedTabs.ts`. A supplier provides one function, `tabs(taskId)`. It
answers `{ loaded, tabs }`, and the strip reads it in a tracking scope, so the supplier's signals
drive the strip. Each tab has these fields:

| Field | What it is |
| --- | --- |
| `id` | Unique within the task, and never a terminal session's ID. Prefix it with the supplier's name |
| `title` | The tab's label |
| `icon` | Optional. `{ name, label }`, drawn as a mark on the tab. The label is what a screen reader says |
| `io` | A `PtyIo` (`packages/client-core/src/kit/lib/pty.ts`) for the body. Leave `input` and `resize` empty |

`loaded` is false until the supplier has first heard about the task. The strip holds a focus request
for a tab it doesn't have until `loaded` turns true, then shows the tab or drops the request.

The agents plugin is the one supplier. It gives a tab for each running background command
(`plugins/agents/src/client/sessions/taskBackgroundCommands.ts`), and
[background commands](../managed-agents/background-commands.md) covers what those tabs show.

## What the strip does with one

`TerminalSessions.tsx` draws supplied tabs after the task's sessions, in the desktop drawer and the
phone's **Terminal** pane. A supplied tab takes part in the strip like a session's:

- A click, `Cmd+Shift+1` to `Cmd+Shift+9`, and the previous and next tab shortcuts select it.
- The strip remembers it as the task's last tab. When it goes away, the strip selects the first tab.
- `requestTerminalFocusIntent(taskId, tabId)` opens on it, as for a session.

Everything that acts on a session passes it by:

- It has no close button, and middle-click and Delete do nothing on it.
- `Cmd+W` does nothing while it's selected.
- **Stop** and the [toolbar actions](./toolbar-actions.md) are hidden while it's selected.
- The drawer doesn't auto-launch the default profile while the strip has a supplied tab, or while it
  holds a request for one.

Only the selected supplied tab has a view. The strip draws it with `attachPty`, keyed by the tab's ID,
so a list update that keeps the tab keeps its view. Selecting another tab disposes the view, and
selecting this one again calls `io.open` again. The view sizes itself to the drawer, and the size
never reaches the supplier.

## Limits

- One plugin can provide the capability. A second supplier needs a registry the terminal plugin
  publishes instead.
- Only a compiled plugin can supply a tab. A loaded plugin runs in a worker, and a `PtyIo` is
  functions.
- The terminal client's Sessions view doesn't draw supplied tabs.
- A remembered supplied tab is restored only when its supplier lists it by the time the drawer's
  first roster read finishes.

## Why

The tab's body is a live channel, so it has to be a function the strip calls. An extension point hands
a contributor's component a place to draw, and a loaded contributor draws from a worker, where a
`PtyIo` can't go. A client capability passes the function between two compiled plugins, which is what
[client capabilities](./collaboration.md#client-capabilities) exist for.

The key lives in the terminal's `contract/` folder, so the terminal never imports its supplier, and a
supplier gets the tab's shape and nothing of the terminal's write, attach, resize, or kill.

A view only for the selected tab, because the host's terminal view takes focus when it opens. One
built behind a shell would take the caret from the shell.
