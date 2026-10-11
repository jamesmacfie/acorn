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

Duplicate basenames gain the shortest parent suffix; each tab has its own menu, inactive ones too.
On the desktop, `⋯`, right-click, and Shift+F10 on the tab open it without activating the tab. In the
terminal strip, arrows move a caret without activating, and Shift+F10 or the adjacent `⋯` opens the
caret tab's menu below the strip. The menu scrolls when the column cannot show every item, and other
plugins' [file actions](../plugins/menus-and-markers.md#context-menus) follow Editor's. Its write hold
starts before focus leaves the document and ends before a selected guarded close begins.
Close others, to the right, and all capture their ordered targets and ask the pane's guarded close
for each one. A save failure, conflict, or intervening edit stops the run and reports how many closed.
Only successful explicit closes enter the 20-entry session reopen stack. Reopen checks the Node file
before opening it and inserts a kept tab at its former tab order position. A closed preview reopens
as kept. Preview replacement and trash do not
count as closes.

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

**Show ignored files** is a device preference, on by default. Ignored rows are muted and named
accessibly; turning it off hides them. Explicit reveal temporarily shows an ignored active path.
The tree shows dotfiles and excludes `.git` and `node_modules`. A save into `.git` is refused, even
through a link. An unavailable ignore read leaves entries visible and shows its error. **Collapse all folders** clears retained
descendant expansions; **Reveal active file** opens ancestors and scrolls to the row.

### Git status

Changes supplies a task-wide, read-only Git status snapshot through Editor's optional
`editor:file-status` Node point. Editor serves it at
`GET /v1/p/editor/tasks/:id/editor/file-status` and groups paths for its tree and tabs. The
tree lists files independently of this read. A missing provider or a checkout without Git
shows ordinary names. A transient read failure keeps the previous marks and shows a stale
explanation. A plugin roster change clears marks before the next read.

The badges use Changes' status words: `M` modified, `A` added, `?` untracked, `R` renamed,
`!` conflicted, and `D` deleted. A deleted file has no phantom tree row, but an open tab may
carry `D`. The tooltip names staged, unstaged, or both scopes and gives the source path for
a rename. One path has one badge even when both scopes change. Conflict wins over rename,
then added, untracked, modified, and deleted. The dirty-buffer dot remains separate.

Folders count distinct changed descendant paths, including deleted files absent from a
listing. A conflict gives its parent folders the danger tone. Editor computes these counts
from the snapshot without opening folders. The terminal draws the same letters and names
the active tab's status. Git deletion does not decide whether a document can save: the
disk revision read still owns **Deleted on disk** and recovery.

The tree controls share one row of labeled icon buttons. Creation dialogs label each field.

The file tree uses the kit's virtual `Rows` and passes measured placement to `TreeRow`. Rows follow
stable keys when expanding moves them. Before viewport geometry arrives, the tree admits at most 12
rows. A reveal waits for usable geometry, including in a restored hidden pane. The terminal client
uses its own collection viewport.

Listings belong to the Node and task that asked. Matching reads share one request, and a stale result
can't replace a listing. Collapsing keeps loaded listings. Worktree events, reconnects, and window
focus refresh loaded directories, parents first. The worktree event carries no path, so every loaded
directory refreshes, including collapsed ones, and unopened directories stay unloaded. A failed
refresh keeps the last listing and shows **Retry**.

The tree's ellipsis, right-click, and focused-row menu show file actions, other plugins' included,
without opening a preview or saving a draft. F2 renames the focused row. On the terminal, Shift+F10 opens its menu and Ctrl+N
opens the worktree root's New menu from a focused row. The terminal stacks a 12-line file list above
the document at narrow widths and uses a name dialog; the desktop keeps name entry in an available
row. Root creation has an optional relative destination folder, so it can create beside an open
file. A terminal without OSC 52 clipboard support shows a selected path for manual copy. Names are
single basenames, including dotfiles. Create uses an
exclusive Node operation and opens a file as a kept tab. Rename stays in the same folder. Both
operations leave Git staging and imports alone.

**Move to trash…** names the task and entry and warns when a folder's descendants are affected. The
menu disables it when the owning Node lacks a supported trash command. An unsaved descendant needs
**Save and move to trash**; a failed or conflicted save stops the action. Opening the menu suspends
ordinary writes before focus changes, including closed drafts kept in device recovery. A confirmed
operation keeps its hold until the Node reply and local tab and recovery changes finish. Cancel is
disabled while the operation is running; a partial result blocks old writers and explains where to
resolve the draft. Node entry IDs detect a replaced file even after an explicit save changes ctime.
A confirmed rename updates open tabs, document custody, recovery, view state, and expanded paths;
confirmed trash retires affected tabs and local recovery. Rename uses a Node build artifact that
calls the host's atomic exclusive rename primitive on macOS or Linux. An ordinary Node host does not
compile code when a person renames a file. The action is disabled when this Node build has no helper
for its platform or architecture and fails closed when the volume lacks the primitive. Quick-open
reads a fresh file list each time; the Node
invalidates Git status
and broadcasts worktree changes to task aliases. Restore trashed entries from the owning Node's
system Trash. The editor has no permanent-delete action or in-app trash browser.

Rename also rewrites closed-tab, navigation, and device recent paths under the captured Node and
task. Trash prunes those references. These records contain paths and positions, never document text.

## Reload on focus

Window focus, worktree invalidation, reconnect, and **Reload status** revalidate the active text
file. Bursts share one active-file refresh at a time. Inactive cached files become stale and
revalidate before the pane shows them. An unchanged
read leaves the buffer, undo history, selection, and save timer alone. Changed disk text replaces a
clean buffer and clamps its cursor and scroll. A dirty draft stays visible and pauses automatic saves
when the disk revision diverges. A failed read retains the useful text. A missing file shows
**Deleted on disk**; connection failures show a separate read error.

**Compare** renders the disk snapshot against the live draft through the shared read-only diff rows.
**Reload from disk** confirms before discarding a dirty draft. **Overwrite disk…** confirms the
named file and snapshot revision captured when its confirmation appears, so a tab switch or newer
disk version makes that decision fail. Reload confirmation follows the same rule; when disk already
contains the draft text it preserves the editor's selection and undo history. **Recreate file…** uses an
absence precondition. **Save as…** writes a separate path under the task root. **Retry save** handles
ordinary write failures. None of these actions stages a file.

## File status and editing controls

See [editing controls](./editing-controls.md) for the strip, wrap and indentation settings, and
focused graphical commands.

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

See [file navigation](./file-navigation.md) for quick open, positioned reveals, reopen, and
back/forward commands on both hosts.
