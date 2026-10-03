# Notes and memory

Notes and memory are separate Node plugins with different owners and scopes. Notes are Markdown at
task, workspace, and global scope. Memory is what agents save for later sessions. Read this page for
both stores, their agent tools, and how they reach an agent's context. The plugins are
`plugins/notes/` and `plugins/memory/`.

## Notes

Notes are Markdown content at task, workspace, and global scope. The notes plugin owns CRUD, context projection, agent read/append tools, and import/export. The Node stores each note as a
plain file with simple frontmatter at `<data-root>/notes/<workspaceId>/<slug>.md` (task notes get a
reserved workspace key), so an owner can read or edit one by hand. Writes are atomic, temp file then
rename, so a crash can't leave a partial note. Notes has no SQLite file or expected-revision HTTP contract. Concurrent external writers can
replace content; atomic rename protects file integrity, not cross-client conflict detection.

The HTTP surface is `/v1/p/notes/tasks/:id/notes` and
`/v1/p/notes/workspaces/:wsId/notes` (including their read/write, title, inclusion, and delete
subroutes). Workspace and global notes require a device principal; a task-scoped agent credential
can reach only its own task notes.

The Notes pane provides a task-first scratchpad, scope navigation, include-in-context controls,
debounced saves, failed-edit recovery, and Markdown import and export. A task's scratchpad starts
virtual: nothing is written until the first keystroke, and the library groups notes by scope with agent and
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

<a id="the-memory-page-and-transcript"></a>

[The Memory page](./notes-and-memory/memory-page.md) covers the library, editing, recent changes, what
agents see, import, and the transcript card.

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
