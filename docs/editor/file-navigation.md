# File navigation

Editor owns quick open, positioned reveals, recently activated files, and session navigation history.
The palette presents results and captures the Node/task; document custody continues to own file text
and saves. This page is part of [the editor](../editor.md).

## Palette commands

The plugin's client half registers file search, line search, and find in files
(`plugins/editor/src/client/commands.ts`). They declare `requires: { plugin: 'editor' }`:

| Command | Kind | Chord | What it does |
| --- | --- | --- | --- |
| Go to file (`editor.files.open`) | `search`, task-scoped | `⌘P` | Lists the task's worktree and opens the pick |
| Find in files… (`editor.search.open`) | action | `⌘⇧F` | Opens the editor pane on its search panel |
| Go to line (`editor.navigation.go-to-line`) | `search`, task-scoped | palette | Reveals a positive line and optional column in the active file |

`⌘P` is bound `global` with an `active` check for an open task, and `⌘⇧F` is bound `task`
(`plugins/editor/src/client/index.ts`). **Go to file** ranks over the whole path. A row draws as a
file name with its folder dimmed, but the score uses the entire path, so `client/App` matches across
the join. The host's `localSearch` scores title and subtitle separately, so Editor ranks its own rows.

An empty query shows up to 50 recent valid files for this Node and task, followed by the listing
without duplicates. `minQueryLength` and `debounceMs` are both `0`. The command returns at most 100
rows, and the session draws at most 50. A failed listing isn't cached, so Enter on the error retries.
Only a valid activation updates the device-local recency address in
[scope rules](../state-ownership/scope-rules.md).

Picking a row sends a retained reveal to the editor pane and opens a preview. `path:line` and
`path:line:column` use one-based coordinates clamped to the loaded document. An exact filename wins
before colon parsing; invalid suffixes remain query text. Selection after the captured Node or task
changes is ignored. **Go to line** retains the active path captured with its result and applies the
same context fence.

## Reopen and history

The pane registers focused **Reopen closed file**, **Go back in editor**, and **Go forward in editor**
commands. Their chords are `⌘⇧T` (Control on other platforms) and Alt+Left/Right. The terminal
drawer keeps `⌘⇧T` whenever another pane owns focus. Reopen checks the Node file before inserting
a kept tab at its recorded tab-order index; the 20-entry stack contains only path and index.

History records at most 100 deliberate file switches and position jumps per Node and task for the
session. Replay checks that a file still exists, skips unavailable entries with a notice, and does
not add a new history entry. A new jump after back removes the forward tail. Ordinary typing does
not add entries. The terminal client draws the same palette session, so it gets **Go to file** too.
Editing, autosave, `⌘S`, and the terminal-editor switch stay in the pane.
