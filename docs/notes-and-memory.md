# Notes and memory

Notes and memory are separate Node plugins with different ownership and scopes. Both are
available to the renderer and to task-scoped MCP tools.

## Notes

Notes are Markdown content at task, workspace, and global scope. The notes plugin owns CRUD, context projection, agent read/append tools, and import/export. The Node stores each note as a
plain file with YAML-ish frontmatter at `<data-root>/notes/<workspaceId>/<slug>.md` (task notes get a
reserved workspace key), so an owner can read or edit one by hand. Writes are atomic, temp file then
rename, so a crash never leaves a partial note. Notes has no SQLite file or expected-revision HTTP contract. Concurrent external writers can
replace content; atomic rename protects file integrity, not cross-client conflict detection.

The HTTP surface is `/v1/p/notes/tasks/:id/notes` and
`/v1/p/notes/workspaces/:wsId/notes` (including their read/write, title, inclusion, and delete
subroutes). Workspace and global notes require a device principal; a task-scoped agent credential
can reach only its own task notes.

The Notes pane provides a task-first scratchpad, scope navigation, include-in-context controls,
debounced saves, failed-edit recovery, and Markdown import/export. A task's scratchpad starts virtual,
nothing is written until the first keystroke, and the library groups notes by scope with agent and
seeded notes badged in place. Notes written by an agent are attributed to the task/session and still
use the same file store.


A model captures its QueryClient's originating Node once, including explicit null for a serving
origin. Lists, workspace lookup, reads, scratch creation, and every mutation keep that target.
Selection memory is keyed by Node and task. Held reads and creation results publish only into the
still-current selection; focus and refresh callbacks stop at retirement. Scratch creation may finish
and save the originating document after retirement without selecting it in a new view.

`noteDrafts.ts` owns body/title recovery by Node, full scope address, and slug. Saves serialize with
title, inclusion, and deletion operations on the same document; repeated save requests coalesce into
one active write operation and a latest dirty follow-up. Each acknowledgement clears only the local
edit revision it sent. These revisions are client bookkeeping and are not server conflict tokens.
Body and title debounces both flush before navigation and on model retirement. Edits made while a
navigation read is held flush again before its successful selection is published; failed reads keep
the prior editable document.

Dirty text is immediately owned in memory with no size or draft-count cap. Device recovery writes
batch at 250 ms and flush on navigation, retirement, write acknowledgement, or failure. Abrupt process
loss can lose the unflushed interval. Blocked/quota-exhausted device storage retains the in-memory
copy for this renderer, but cannot provide restart recovery. Returning to the document overlays its
unacknowledged body/title and reports the saved error. There is no background offline replay; a new
edit or explicit save retries against that same Node. Clean owners leave the recovery map when their
view and queued operations release them.

Four `notes_*` agent tools (list, read, write, append) let an agent read and log notes without going
through the HTTP surface a device principal uses. Every write through these tools is stamped
`author: 'agent'` plus the calling session id, which is what lets the pane and the context assembler
show who wrote a note. The workspace-scoped tool resolves the workspace from the calling task's own
membership rather than a caller-supplied id, so an agent cannot address a workspace other than its
own task's. None of the four tools can set a note's `included` flag: an included global note is
injected into every task's assembled context, and that is a decision the tools leave to the pane.

When a task is created from a GitHub PR, its description, its comment and review thread, and any
linked Linear ticket are seeded into notes tagged with that task's id, one note per source. Seeded
notes are stamped `author: 'workflow'` with kind `'scratch'`, which keeps them out of the Notes
pane's editing library: they are external snapshots that belong to context, not something the owner
authored. A workflow run's handoff notes are also `author: 'workflow'`, but kind `'finding'`, so they
stay in the library. Only the workflow-plus-scratch combination counts as a seed.

## Memory

Agents save memory directly with task-scoped tools. The files live under `~/.acorn/memory`, or
`<ACORN_DATA_DIR>/memory` when the Node has an explicit data root. Development sessions therefore
use their isolated data folder. Project memories live in `projects/<projectId>/`; private memories
live in the root and apply across projects. Memory writes do not change a repository checkout.

Each Markdown file has `name`, `description`, and `metadata.type` frontmatter. Writes stamp
`metadata.updatedAt` and `metadata.updatedBy`, with `agent:SESSION_ID` for agent writes. Types are
`user`, `feedback`, `project`, and `reference`. Reads map the legacy `convention`, `architecture`,
`decision`, `fix`, and `task` labels to `project` without rewriting files.

`memory_list` lists names, descriptions, types, scopes, and update dates. `memory_search` scans names,
descriptions, and bodies and returns up to 10 matches with excerpts. Both accept an optional scope.
`memory_get` requires a scope and name and returns the content and its SHA-256 hash. Tools derive the
project from the signed task and accept no project ID. A projectless task can use private memory.

`memory_write` creates or replaces a file directly. Replacing a name requires its current hash from
`memory_get`. `memory_delete` also requires the hash. A stale hash fails with a conflict and the current
hash. Mutations serialize within the Node, write files atomically, regenerate that scope's `MEMORY.md`,
and publish `plugin:memory:memories-changed`. Index lines sort by the file's update time, newest first.

Names follow the memory filename rule and cannot use the reserved `MEMORY` name. Descriptions must be
one line of at most 200 characters, and bodies have a 16 KiB byte limit. Writes reject invisible and
bidirectional controls, role-like tags, instruction overrides, private keys, token-shaped secrets,
and credential assignments. These checks help catch unsafe memory content; they do not replace the
contract's instruction that the person's request and repository guidance take precedence.

Replacement and deletion preserve the prior file under `.history/NAME/` for private memory, or
`.history/projects/PROJECT_ID/NAME/` for project memory. Each name keeps 20 prior versions. The root's
`changes.jsonl` keeps the last 1,000 mutations, with action, scope, name, timestamp, task, and session.
Undo restores prior content, or deletes a file created by that change, and records a restore change.
It refuses if a later logged mutation or an external edit changed the memory.

### The Memory page and transcript

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

## Context integration

Notes contribute to `task_context` and the Context pane alongside task, PR, and linked-issue sections.
Memory does not register a context section or duplicate its index in `task_context`.

Memory supplies `agents.standingContext.v1` with a `build(taskId)` operation. Agents reads that optional
capability once at session admission and stores `config.standingContext`. A resume sends the stored
text unchanged. Generic configuration updates cannot replace it. A fresh session builds another
snapshot; another live session can call `memory_list` or `memory_search` to see subsequent writes.
With Memory disabled, admission stores no memory text.

Standing context contains the single memory contract, the private index, and the signed task's project
index. It includes descriptions, not bodies. The per-scope caps default to 4,000 and 12,000 characters.
The `memory:index-caps:v1` preference can set each cap from 200 through 32,000 characters. Caps apply
at whole-line boundaries, with an explicit marker naming the omitted count and `memory_list`.

Managed Claude appends the snapshot after custom instructions and unattended turn instructions.
Managed Codex appends it to developer instructions. A contributed ACP harness without a system prompt
seam receives it before its first prompt, using the custom-instructions fallback. Workflow managed
sessions use those same paths. Structured generation has no memory injection.

Terminal Claude Code uses the compiled `launchContextArgs` profile seam. Terminal reads launch
contributions before spawning the PTY, then the profile carries the text in `--append-system-prompt`.
The remaining launch instruction points to task context, linked issues, and notes. Other terminal
profiles receive the combined task context and standing memory at the first idle edge through
`terminal:launch-context`. The queued path has a 256 KiB aggregate ceiling, allowing both configured
index caps and the contract. Command overrides receive no automatic agent context.

## From the command palette

Three rows across the two plugins, all registered by their own client half.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

Notes contributes a finder and an input (`plugins/notes/src/client/commands.ts`). **Find a note** is
one search over all three scopes, because a reader looking for the deploy runbook does not know
whether they filed it against this task, this workspace, or globally, and the pane draws all three in
one column anyway. The three lists load once when the frame opens and are filtered on the device after
that (`packages/client-core/src/host/registries/commands/localSearch.ts`). Rows are keyed
`<scope>:<slug>`, and that is load-bearing: a slug is unique inside a scope and nowhere else, so
`task:deploy` and `global:deploy` are two reachable rows where a bare slug would hide one of them and
send the other's pick to the wrong file. A scope whose list cannot be read becomes a row saying so,
since a workspace list is device-gated on the Node and an agent-confined client is refused rather than
broken. Workflow scratch seeds are filtered out here for the same reason the library hides them.
Picking a row emits the retained open intent the pane already answers, so the note opens whether the
pane is mounted or opens because of the pick. **Create a task note** takes a title and nothing else:
the Node owns the kind and the slug, so a note started from the palette gets the default kind and the
same `name-2` collision rule the pane's own button gets. Both rows are task-scoped, because opening a
note is a pane intent addressed at a task even when the note is a global one.

Memory contributes **Search memory** (`plugins/memory/src/client/commands.ts`). The Node scans the
private folder and the captured task's project folder. Search matches every query term literally,
ignoring case, across names, descriptions, and bodies. Name matches rank above description matches,
then body matches; update time breaks ties. Results are capped at 10. Selecting a row opens its scope
and filename on the Memory page. Listing and searching reflect external edits on the next read.
Memory uses no SQLite database or recall counters. Repository `.acorn/memory` folders are outside
all Memory read paths.

What stays out is deliberate. Deleting a note and changing whether an agent sees one stay in the note
list, where the scope and the current value are both on screen. Adding a memory needs a
name, a type, a scope, and a body, which is four fields rather than one line.
