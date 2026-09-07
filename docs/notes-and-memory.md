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

The HTTP surface is `/v2/p/notes/tasks/:id/notes` and
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

When a task is created from a GitHub PR, its description, its comment and review thread, and any
linked Linear ticket are seeded into notes tagged with that task's id, one note per source. Seeded
notes are stamped `author: 'workflow'` with kind `'scratch'`, which keeps them out of the Notes
pane's editing library: they are external snapshots that belong to context, not something the owner
authored. A workflow run's handoff notes are also `author: 'workflow'`, but kind `'finding'`, so they
stay in the library. Only the workflow-plus-scratch combination counts as a seed.

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

### The Memory page

Memory has a rail source of its own, `plugins/memory/src/client/MemoryCenter.tsx`: the pending
proposals at the top, then what has already been accepted, filtered on the device. It draws one
full-width column, so the contribution declares `component` rather than `regions`.

Both lists are scoped to the routed project, which is why the source declares `projectScoped`. The
memories half is the node's own rule: `listMemories` returns the project's rows plus the private
ones, since a private memory in `~/.acorn/memory` applies wherever you are. The proposals half
applies the same rule on the device, in `proposalsForProject`: this project's, plus the ones that
name no project at all. That second half matters. An agent whose task will not resolve proposes with
a null project on purpose, so that a reviewer still sees it rather than losing what it learned
(`plugins/memory/src/server/agentTools.ts`), and scoping those away would leave them with nowhere to
be reviewed from. A page opened from a surface that routes no project shows everything, because
there is no scope to apply.

It exists because a proposal is not task-scoped, however much its record looks it. Acceptance
resolves the task's worktree and falls back to the project folder
(`plugins/memory/src/server/knowledgeChannel.ts`), and archiving a task nulls its worktree path, so a
proposal is still acceptable after the task that raised it is gone. Before the page, the only review
surface was a fold inside a task's Context pane, which meant those proposals were reachable by the
API and unreachable by hand.

The Context pane's section stays, drawing this task's proposals where the reader is already working.
Both surfaces render the same card, `ProposalList.tsx`, so accept and reject cannot drift apart.

The "Review memory" row in the notification bell lands on the proposal it named, not on the top of
the page: the card takes the kit's `focus`, which scrolls it into view and puts the reader on it, and
the highlight is cleared when the page unmounts so a later visit does not re-scroll to a proposal
already dealt with. The row carries the proposal's project, so the inbox routes there before it opens
the page — without that step the page would scope this very proposal out of the view it just opened.
It carries no task id. It used to, which sent the click to the task and left the reader on whatever
pane happened to be open. The row draws with the memory mark rather than the generic nudge glyph,
since every row this source raises is the same kind of thing. See
[notifications.md](./notifications.md) § What a row points at.

Accept and reject report their own failures, on the card that was pressed. There are two, and both
used to be silent. A refusal answers 200 with `ok: false` — most often a worktree removed since the
proposal was raised — and a route that is gated, unreachable, or 500s throws out of the client
instead of answering. Neither put anything on screen, so the button read as dead. A page can hold a
dozen proposals from a dozen tasks, which is why the message sits on the card rather than in a banner
above the list.

Accepting also refetches the memories below it. Without that the proposal vanishes from the top of
the page and nothing takes its place, which reads as though the accept did nothing.

Memory stays a first-party plugin. The loaded tier contributes a declarative source descriptor
(`packages/protocol/src/plugin/contract.ts`), a data-driven list and detail, which cannot draw this
page; and memory is the human gate on knowledge an agent proposes writing into your repository, which
is the wrong thing to move behind the sandbox.

## Context integration

Notes and memory each register a context section. Core assembles sections with GitHub, task, Linear,
and Rollbar contributions under a deterministic byte/token budget. Section failure or stale data is
reported independently. The context pane previews the exact snapshot and can send it to a selected
managed agent session.

Memory also draws in the pane. Its proposal queue and its add-memory form are a component registered
against the `context:section` extension point with `matches: ['memory']`, which the context plugin
opens and the host mints. For more information, see the cooperative extension points in
[the plugins doc](./plugins.md). Context draws its own rows for the section and memory's card joins
them, because the point stacks. Neither plugin imports the other, and disabling memory leaves the
section drawing its rows.

A fresh agent session can receive that snapshot two ways. The _push_ queues the assembled block for
the session's first idle edge. It is delivered `'after-ready'`, so if the CLI is still busy when the
user types, the block lands after the first ask, as reference material for work already underway. A
profile that can carry a standing instruction avoids the race by _pulling_ instead. It sets
`launchArgs` on its `AgentProfileContribution` (Claude Code uses `--append-system-prompt`, telling it
to call `task_context`, `notes_read`, or `memory_search` before starting), and `spawnOne` skips the
push for that session. A system prompt cannot lose the race, and a pull sees notes edited
mid-session. The push still governs profiles with no such flag. `launchArgs` reach node-pty as argv,
and the tmux and `-lc` paths as a quoted line (`launchCommandLine`). A command override, such as the
dev-server pane, is a different binary and gets none.

## From the command palette

Four rows across the two plugins, all registered by their own client half.
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

Memory contributes a search and one open action (`plugins/memory/src/client/commands.ts`). **Search
memory** goes through the existing full-text path, so the ordering is that index's own rank and the
device does not re-rank it, and a row reveals by the memory's name rather than its id, because the
name is what the context section keys its rows by. It is task-scoped even though the query is about
the project: the query carries the captured project, but the surface a hit opens in belongs to a task,
and a row that cannot be opened is not worth offering. **Review memory proposals** goes to the Memory
page instead, and so is offered with no task in hand.

What stays out is deliberate. Deleting a note and changing whether an agent sees one stay in the note
list, where the scope and the current value are both on screen. Accepting or rejecting a proposal
needs the proposal's body and its verification flags in front of the reader. Adding a memory needs a
name, a type, a scope, and a body, which is four fields rather than one line.

## Lifecycle hooks

Managed-agent completion can trigger memory review. The hook creates proposals or review attention;
it does not bypass the human acceptance gate. Review runs on the first installed agent profile with a
headless mode, tried in a fixed order (Claude Code, then Codex) rather than one hardcoded CLI, so a
Codex-only install still gets auto-generation. Notes and memory capabilities resolve through the Node
capability registry, so disabling one plugin yields an explicit unavailable section rather than a
cross-plugin import.
