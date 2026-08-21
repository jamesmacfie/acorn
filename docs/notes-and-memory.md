# Notes and memory

Notes and memory are separate Node plugins with different ownership and review semantics. Both are
available to the renderer and to task-scoped MCP tools.

## Notes

Notes are Markdown content at task, workspace, and global scope. The notes plugin owns revisions,
CRUD, context projection, agent read/append tools, and import/export. The Node stores each note as a
plain file with YAML-ish frontmatter at `<data-root>/notes/<workspaceId>/<slug>.md` (task notes get a
reserved workspace key), so an owner can read or edit one by hand. Writes are atomic, temp file then
rename, so a crash never leaves a partial note. Notes has no SQLite file; autosave sends an expected
revision and surfaces a conflict rather than overwriting a newer edit.

The current HTTP surface is `/v2/p/notes/tasks/:id/notes` and
`/v2/p/notes/workspaces/:wsId/notes` (including their read/write, title, inclusion, and delete
subroutes). `/v2/p/memory/.../notes` remains as a one-release compatibility alias for saved agent
prompts and older clients; it uses the notes capability and does not own a second store.

The Notes pane provides a task-first scratchpad, scope navigation, include-in-context controls,
debounced saves, conflict recovery, and Markdown import/export. A task's scratchpad starts virtual,
nothing is written until the first keystroke, and the library groups notes by scope with agent and
seeded notes badged in place. Notes written by an agent are attributed to the task/session and still
follow the same revision rules.

Four `notes_*` agent tools (list, read, write, append) let an agent read and log notes without going
through the HTTP surface a device principal uses. Every write through these tools is stamped
`author: 'agent'` plus the calling session id, which is what lets the pane and the context assembler
show who wrote a note. The workspace-scoped tool resolves the workspace from the calling task's own
membership rather than a caller-supplied id, so an agent cannot address a workspace other than its
own task's. None of the four tools can set a note's `included` flag: an included global note is
injected into every task's assembled context, and that is a decision the tools leave to the pane.

When a task is created from a GitHub PR, its PR description, its comment/review thread, and any
linked Linear ticket are seeded into notes tagged with that task's id, one note per source. These
seeded notes are stamped `author: 'workflow'` with kind `'scratch'`, which keeps them out of the
Notes pane's editing library since they are external snapshots that belong to context, not something
the owner authored. A workflow run's handoff notes are also `author: 'workflow'` but kind `'finding'`,
so they stay visible in the library; only the workflow-plus-scratch combination is treated as a seed.

## Memory

Memory is durable reviewed knowledge. Accepted project entries are Markdown files in a mapped
project folder's `.acorn/memory/` directory (or an active task worktree); private entries live in
Node-private memory storage. The memory plugin owns file reconciliation, hash deduplication,
supersession, proposals, an FTS index, and recall metadata. Plain folders are supported: they use
project scope without Git revision/diff anchoring.

Agents can search and propose memory entries but cannot write accepted knowledge directly. Acceptance
revalidates the proposal revision and relevant worktree state before updating the authoritative file.
The index is rebuildable; the Markdown files remain the durable content.

A search hit or a `memory_get` read bumps that row's recall stats (last-accessed time and access
count), the inputs for future decay and ranking. Listing the index does not count as a read. The
stats survive reconciliation because rows are keyed by a content-hash id.

## Context integration

Notes and memory each register a context section. Core assembles sections with GitHub, task, Linear,
and Rollbar contributions under a deterministic byte/token budget. Section failure or stale data is
reported independently. The context pane previews the exact snapshot and can send it to a selected
managed agent session.

A fresh agent session can receive that snapshot two ways. The **push** queues the assembled block for
the session's first idle edge — but it is delivered `'after-ready'`, so whenever the CLI is still busy
when the user types, it lands *after* the first ask, arriving as reference material for work already
underway. A profile that can carry a standing instruction avoids the race by **pulling** instead: it
sets `launchArgs` on its `AgentProfileContribution` (Claude Code: `--append-system-prompt`, telling it
to call `task_context` / `notes_read` / `memory_search` before starting), and `spawnOne` then skips the
push for that session. A system prompt cannot lose a race, and a pull sees notes edited mid-session.
The push still governs profiles with no such flag. `launchArgs` reach node-pty as argv and the tmux /
`-lc` paths as a quoted line (`launchCommandLine`); a command override (dev-server pane) is a
different binary and gets none.

## Lifecycle hooks

Managed-agent completion can trigger memory review. The hook creates proposals or review attention;
it does not bypass the human acceptance gate. Review runs on the first installed agent profile with a
headless mode, tried in a fixed order (Claude Code, then Codex) rather than one hardcoded CLI, so a
Codex-only install still gets auto-generation. Notes and memory capabilities resolve through the Node
capability registry, so disabling one plugin yields an explicit unavailable section rather than a
cross-plugin import.
