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

Memory is durable reviewed knowledge. Accepted entries are Markdown files in the repository's
`.acorn/memory/` directory or Node-private memory storage. The memory plugin owns file reconciliation,
hash deduplication, supersession, proposals, an FTS index, and recall metadata.

Agents can search and propose memory entries but cannot write accepted knowledge directly. Acceptance
revalidates the proposal revision and relevant worktree state before updating the authoritative file.
The index is rebuildable; the Markdown files remain the durable content.

## Context integration

Notes and memory each register a context section. Core assembles sections with GitHub, task, Linear,
and Rollbar contributions under a deterministic byte/token budget. Section failure or stale data is
reported independently. The context pane previews the exact snapshot and can send it to a selected
managed agent session.

## Lifecycle hooks

Managed-agent completion can trigger memory review. The hook creates proposals or review attention;
it does not bypass the human acceptance gate. Notes and memory capabilities resolve through the Node
capability registry, so disabling one plugin yields an explicit unavailable section rather than a
cross-plugin import.
