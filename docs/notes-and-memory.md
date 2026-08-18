# Notes and memory

Notes and memory are separate Node plugins with different ownership and review semantics. Both are
available to the renderer and to task-scoped MCP tools.

## Notes

Notes are Markdown content at task, workspace, and global scope. The notes plugin owns revisions,
CRUD, context projection, agent read/append tools, and import/export. The Node stores note records in
`plugins/notes.sqlite`; autosave sends an expected revision and surfaces a conflict rather than
overwriting a newer edit.

The current HTTP surface is `/v2/p/notes/tasks/:id/notes` and
`/v2/p/notes/workspaces/:wsId/notes` (including their read/write, title, inclusion, and delete
subroutes). `/v2/p/memory/.../notes` remains as a one-release compatibility alias for saved agent
prompts and older clients; it uses the notes capability and does not own a second store.

The Notes pane provides a task-first scratchpad, scope navigation, include-in-context controls,
debounced saves, conflict recovery, and Markdown import/export. Notes written by an agent are
attributed to the task/session and still follow the same revision rules.

## Memory

Memory is durable reviewed knowledge. Accepted project entries are Markdown files in a mapped
project folder's `.acorn/memory/` directory (or an active task worktree); private entries live in
Node-private memory storage. The memory plugin owns file reconciliation, hash deduplication,
supersession, proposals, an FTS index, and recall metadata. Plain folders are supported: they use
project scope without Git revision/diff anchoring.

Agents can search and propose memory entries but cannot write accepted knowledge directly. Acceptance
revalidates the proposal revision and relevant worktree state before updating the authoritative file.
The index is rebuildable; the Markdown files remain the durable content.

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
it does not bypass the human acceptance gate. Notes and memory capabilities resolve through the Node
capability registry, so disabling one plugin yields an explicit unavailable section rather than a
cross-plugin import.
