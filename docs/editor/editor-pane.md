# The editor pane

This page covers the editor plugin's pane: opening files, image previews, the file tree, reloading on
focus, editing in your own `$EDITOR`, and its palette commands. It's part of [editor](../editor.md).
The plugin is `plugins/editor`.

## Opening a file

Editor file access uses core's task-root guard for reads and writes. Writes refuse dangling links
before opening the file, so a missing target outside the worktree can't be created through a link
inside it. New files under real directories in the root, and safe internal aliases, still work. For
the path replacement limit, see
[security controls](../security.md#process-path-and-configuration-controls).

### One round trip to text

The pane reads the task's checkout path and the remembered open file in the same tick, so text lands
after one round trip. On September 3, 2026, with 50 ms of latency a request, first text on a
remembered file moved from 222 ms to 174 ms.

The checkout path is a query under `['editor', 'root', taskId]` with a one-minute freshness window
(`plugins/editor/src/client/editorClient.ts`). Reopening the pane on a recent task issues no request
for it, and the task rail warms the same key when the pointer rests on a row
([pane contributions](../panes/contributions.md#prefetch)). A cached path paints the rectangle in the
same tick. A missing path is always awaited, because "this task has no checkout yet" can change.

Each open file's `EditorState`, with its text, undo history, and grammar, lives on the pane's model
([pane models](../panes/models.md)). Closing the pane and opening it again costs no requests and keeps
undo history. A state built by an earlier mount is reconfigured before it goes on screen, because its
update listener and save chord close over that mount. Closing the pane still flushes a pending
autosave, and that write finishes its own bookkeeping after the mount is gone.

A file response that arrives after its mount has gone is discarded before CodeMirror parses it, and
the `editor.state.skipped` sample records the size with the reason `pane-unmounted`. A later mount
reads again.

### Text loads

The reader accepts complete UTF-8 text, including Unicode, a real U+FFFD character, and a byte order
mark. Invalid UTF-8 and bodies with NUL bytes return `unsupported_text`. A failed read shows an error
and leaves the surface read-only. It never creates an editable empty file.

Text opens before the optional grammar and [line markers](./line-markers.md) arrive. Those responses
belong to the document entry that asked, and can't fill a preview that has since closed.

Tabs decide what's kept. Replacing a clean preview tab releases its text, saved body, and view state.
Promoted and dirty tabs keep their state when the pane is toggled on the same task. Archiving a scope
evicts view state only for its own Node, so equal IDs on two Nodes keep separate positions.

### Graphical admission

The build's host token decides whether graphical editing is supported. On the desktop, remembered
text can load beside the checkout-path request. The CodeMirror import, the grammar, and the document
state wait until the graphical rectangle mounts, and retiring that rectangle cancels them. The
terminal client builds no graphical document or view state. It keeps the shared text custody through
an entrypoint with no engine, and its terminal-editor preference still mounts the PTY channel.

## Image previews

On the desktop, opening a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO file shows a fitted image in the
document area. The image view is read-only, so it never enters the text pool or autosave. The
terminal client names the image instead of drawing it, and its `$EDITOR` mode still works. SVG opens
as text, because it can contain active content.

The pane reads image bytes through `GET /v1/p/editor/tasks/:id/editor/image?path=…`. The route uses
the same task-root confinement as text reads, limits previews to 32 MiB, and responds with a fixed
image content type, `nosniff`, and `no-store`. The client makes a blob URL, releases it when the tab
changes, and reads the image again when the window regains focus.

## The file tree

The file tree uses the kit's virtual `Rows` and passes measured placement to `TreeRow`. Rows follow
stable keys when expanding moves them. Before viewport geometry arrives, the tree admits at most 12
rows. A reveal waits for usable geometry, including in a restored hidden pane. The terminal client
uses its own collection viewport.

Listings belong to the Node and task that asked. Matching reads share one request, and a stale result
can't replace a listing. Collapsing keeps loaded listings. Worktree events, reconnects, and window
focus refresh loaded directories, parents first. The worktree event carries no path, so every loaded
directory refreshes, including collapsed ones, and unopened directories stay unloaded. A failed
refresh keeps the last listing and shows **Retry**.

## Reload on focus

When the window regains focus, the pane reads the open file again, because an agent edits the same
worktree. A clean document reloads quietly. A dirty or saving one is left alone, so a reload never
overwrites your unsaved edits. The reload checks its read generation, the document, its text, edit
revision, and dirty state after the response. Applying text from disk doesn't schedule an autosave.
It's a plain window listener, because the platform seam carries no focus signal.

## Editing in your own editor

The pane can hold your own editor instead of CodeMirror. The device preference `editor_mode` set to
`terminal` makes the pane mount a PTY rectangle running `$EDITOR <file>`, then `$VISUAL`, then `vi`,
in the task's worktree. Graphical is the default. In the terminal client, the same preference gives
you your editor inside the terminal. With it off, the terminal client draws a box saying the file
opens there.

The PTY is short-lived. It uses its own channel on the authenticated socket (`editor:pty:*`,
`plugins/editor/src/shared/editorPty.ts`) with a client-made ID, and the process ends with the panel.
It creates no terminal session row, tmux binding, or drawer tab. The channel starts a login shell,
because `$EDITOR` is set in a shell profile and can carry flags. The file reaches the shell as `$1`,
not inside the command line, and `resolveInRoot` confines its path to the worktree.

Exiting is the save signal. In terminal mode the pane tracks no dirty state, because the editor in
the PTY owns the buffer. When the process exits, the pane drops its cached copy and reads the file
from disk. A non-zero exit shows an `Alert` instead of claiming a save. Switching the preference back
or changing tabs mid-edit drops the cache the same way.

## From the command palette

The plugin's client half registers two commands (`plugins/editor/src/client/commands.ts`). Both
declare `requires: { plugin: 'editor' }`:

| Command | Kind | Chord | What it does |
| --- | --- | --- | --- |
| Go to file (`editor.files.open`) | `search`, task-scoped | `⌘P` | Lists the task's worktree and opens the pick |
| Find in files… (`editor.search.open`) | action | `⌘⇧F` | Opens the editor pane on its search panel |

`⌘P` is bound `global` with an `active` check for an open task, and `⌘⇧F` is bound `task`
(`plugins/editor/src/client/index.ts`). `plugins/editor/src/client/commands.test.ts` checks three
things about **Go to file**:

- It ranks over the whole path. A row draws as a file name with its folder dimmed, but the score uses
  `src/client/App.tsx` whole, so a query like `client/App` matches across the join. That's why the
  command ranks its own rows instead of using the host's `localSearch`, which scores title and
  subtitle apart.
- An empty query shows the listing, in `git ls-files` order. `minQueryLength` and `debounceMs` are
  both `0`. The command returns at most 100 rows, and the session draws at most 50. A failed listing
  isn't cached, so Enter on the error tries again.
- Picking a row shows the editor pane and opens the file as a preview tab, as a click in the tree
  does.

The terminal client draws the same palette session, so it gets **Go to file** too. Editing,
autosave, `⌘S`, and the terminal-editor switch stay in the pane, because they're about the buffer on
screen.
