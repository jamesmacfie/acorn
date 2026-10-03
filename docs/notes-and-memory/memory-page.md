# The Memory page

This page covers the Memory page in the project rail, how you edit and restore memories there, the
import flow, and the card an agent's memory write draws in the transcript. The store and tools are in
[notes and memory](../notes-and-memory.md#memory).

## The Memory page

The project rail's **Memory** page is a list beside a detail, drawn the way GitHub and Workflows
are: the source hands over `regions`, so the desktop draws one split and the terminal puts the list
in its Browse panel. The list has a **This project** tab and an **All projects** tab for private
memory, each newest update first. Its filter calls the same Node scan as `memory_search`, matching
every term across names, descriptions, and bodies, with up to 10 results. Select a memory to read its
body, type, scope, timestamp, and last author in the detail column. Agent changes link to their
originating session. With nothing selected, the detail column shows the overview: **Recent changes**,
**What agents see**, and **Import memory**. Close the reader to return to it.

**New** in the list header opens a form in the detail column. It accepts a name, description, type,
scope, and body, and opens the saved memory. **Edit** uses the hash captured when
the draft opens. A conflicting write preserves the draft and displays the current body with
**Reload current version**. Changing a name or scope creates the destination and deletes the source
under the store lock. A destination name collision refuses the move. Each address retains its own
history and change entry. **Delete** and **Restore** each ask for a second press. **Delete** retains
the previous content; a deleted memory stays reachable
from the feed. **History** lists up to 20 retained versions with timestamps and authors; **Restore**
checks the current hash before replacing the memory.

**Recent changes** shows the 50 most recent mutations across this project and private scope. Each
entry identifies the action, name, author, and time. An agent entry links to its session, or to its
task when no session is recorded.
**Undo** appears when the entry is the last mutation at that address, its hash matches the file, and
its prior version is available. The page refreshes its library, reader, feed, history, and context
preview on `plugin:memory:memories-changed`.

**What agents see** uses the same builder as session admission. It displays the contract and capped
indexes, each index's full and displayed character counts, and editable caps. Saving caps writes
`memory:index-caps:v1` for the active owner. Sessions created after the save receive the changed
snapshot; stored session snapshots keep their original text.

**Import memory** discovers Claude Code's repository memory folder and the primary checkout's
`.acorn/memory` folder on the Node. Claude discovery uses the repository's Git common directory,
so linked worktrees share the main repository's memory. It honors `CLAUDE_CONFIG_DIR` and
`CLAUDE_CODE_PROJECT_DIR_NAME` from the Node environment. Custom Claude `autoMemoryDirectory`
settings are outside discovery.

Choose a source to preview filenames, descriptions, types, bodies, and exact name collisions.
Import skips collisions unless **Overwrite** is selected for that file. It maps legacy types to the
four memory types, validates each file through the normal write rules, and records author `import`.
The source and destination hashes from the preview must still match. Failures are reported per file;
successful files remain imported. Import skips `MEMORY.md`, symlinks, and invalid filenames, refuses
files larger than 64 KiB, and regenerates Acorn's index. It leaves source files unchanged.

The TUI draws the same library, feed, history, context preview, and import controls. **Edit body in
$EDITOR** opens a disposable Markdown body draft in a throwaway PTY on the Node. Exiting the editor
returns the body to the form; **Save memory** applies validation and the original hash. A disconnect
kills the PTY. Compiled plugins have no CLI command registration seam, so memory import is available
through the desktop and TUI.

The memory plugin renders `memory_write` and `memory_delete` through `agents:tool-card`. Successful
calls show the scope, name, description, **Open**, and **Undo**. Undo calls
`POST /v1/p/memory/memory/changes/:id/undo`, which requires a paired device. Manual additions also
require a device and use the same validation, history, and change log as agent writes.
