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

The HTTP surface is `/v1/p/notes/tasks/:id/notes` and
`/v1/p/notes/workspaces/:wsId/notes` (including their read/write, title, inclusion, and delete
subroutes). Workspace and global notes require a device principal; a task-scoped agent credential
can reach only its own task notes.

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

Memory is durable reviewed knowledge. Every entry acorn accepts is a Markdown file under the owner's
private memory root, `~/.acorn/memory`. Scope decides reach rather than storage: a project entry goes
to `projects/<projectId>/` and applies to that project alone, and through it to that project's
workspace, while a private entry sits in the root and applies wherever the owner is working. Nothing
is written into a repo checkout, so a task's diff and its pull request never carry a `.acorn/`
directory the reviewer did not ask for.

Reconciliation still reads two more places, and only reads them: `.acorn/memory/` in each active task
worktree and in each primary checkout. That is what lets a team commit shared memory into its own
repo, and it keeps entries written before the store moved. The memory plugin owns file
reconciliation, hash deduplication, supersession, an FTS index, and recall metadata. Plain
folders are supported: they use project scope without Git revision/diff anchoring.

Agents can search memory and submit proposed changes, but cannot write accepted knowledge directly.
`memory_write` sends its validated payload to Findings immediately. Findings creates one observation,
candidate, and review bundle, then returns their IDs to the tool. The host derives agent provenance
from the signed task session and checks that the session belongs to the task. If Findings is disabled,
the tool returns an explicit unavailable result and creates no local queue. The index is rebuildable;
the Markdown files remain the durable content.

After a manual write or accepted proposal, the plugin first reconciles the file and derived index,
then publishes `plugin:memory:memories-changed`. Its payload is only the affected project scope, or
the private scope with `projectId: null`; recall counters and ordinary reconciliation reads stay
silent. A node-side consumer re-reads `memory.library`, which returns authorized entry content and
metadata but no file paths or recall bookkeeping.

A search hit or a `memory_get` read bumps that row's recall stats (last-accessed time and access
count), the inputs for future decay and ranking. Listing the index does not count as a read. The
stats survive reconciliation because rows are keyed by a content-hash id.

### The Memory page

Memory list and search routes constrain a task credential's `projectId` to the signed task's project.
The plugin resolves the task and project through core services before reconciling or querying the
memory index. Foreign scope, missing task or referenced project state, and scope lookup failures return the same
`404 not_found`. Omitted `projectId` reads only shared private memories for an existing task.
Device and service credentials can select any project or the private-only scope. Agent read tools
derive project scope from their host-supplied task instead of accepting a project ID from tool input.

Memory has a project-scoped rail page in `plugins/memory/src/client/MemoryCenter.tsx`. It shows
Findings review bundles above accepted memories. The memory list includes entries for the routed
project and private entries, which apply everywhere. The page filters the fetched list by name or
description. The task Context pane shows the same canonical review beside the manual add-memory form.

The review shows preparing, failed, ready, and empty bundles. Ready suggestions stay in the project's
attention list after the source task is archived. Each candidate has an exact preview before approval.
The owner can edit the proposed name, type, description, body, and project or private reach; an edit
creates a new candidate revision. Dismissal, undo, snooze, source evidence, and review history remain
attached to the canonical candidate. An omitted observation can be restored, and a grouped source can
be split into its own candidate.

Approval uses `/v1/p/memory/memory/findings/:candidateId/approve` and requires a paired device. The
request names the exact candidate revision, payload hash, and idempotency key. Memory persists a
prepared receipt before the atomic Markdown write. The receipt binds the payload, scope, target,
accepted-memory version hash, and device identity. A retry reconciles an already-written file and
finishes Findings linkage without writing twice. A stale revision or changed update base conflicts.
Manual owner-authored memory remains available when Findings is disabled.

The optional ready-bundle notice opens the Memory review through a `findings-bundle` destination.
A candidate destination names its canonical candidate ID. The Memory page clears a one-time candidate
highlight when it unmounts.

## Context integration

Notes and memory each register a context section. Core assembles sections with GitHub, task, Linear,
and Rollbar contributions under a deterministic byte/token budget. Section failure or stale data is
reported independently. The context pane previews the exact snapshot and can send it to a selected
managed agent session.

Memory also draws in the pane. Its canonical review and add-memory form are a component registered
against the `context:section` extension point with `matches: ['memory']`, which the context plugin
opens and the host mints. For more information, see the cooperative extension points in
[the plugins doc](./plugins.md). Context draws its own rows for the section and memory's review joins
them, because the point stacks. Neither plugin imports the other, and disabling memory leaves the
section drawing its rows.

A fresh agent session can receive that snapshot two ways. The _push_ queues the assembled block for
the session's first idle edge. It is delivered `'after-ready'`, so if the CLI is still busy when the
user types, the block lands after the first ask, as reference material for work already underway. A
Memory contribution supplies the bounded launch text through `terminal:launch-context`; Terminal
orders the contributors and sends their text. The separate `terminal.sendToAgent` action remains for
explicit sends. A
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

Memory contributes a search and two actions (`plugins/memory/src/client/commands.ts`). **Search
memory** goes through the existing full-text path, so the ordering is that index's own rank and the
device does not re-rank it, and a row reveals by the memory's name rather than its id, because the
name is what the context section keys its rows by. It is task-scoped even though the query is about
the project: the query carries the captured project, but the surface a hit opens in belongs to a task,
and a row that cannot be opened is not worth offering. **Review memory suggestions** goes to the Memory
page instead, and so is offered with no task in hand.
**Review learnings** is task-scoped and explicitly prepares findings from that task, then routes to
the owning project's Memory page. The Node resolves the same saved backend and model used by archive
review; without one it asks the owner to configure review instead of creating unfiltered candidates.
Findings validates generated payloads against Memory's target-owned contract before publication. If
the model returns an invalid payload, Findings sends the validation error through one bounded
correction pass; a second invalid response leaves the bundle failed and retryable.
The Findings plugin also contributes **Findings: inspect task evidence**, the command-only route to
raw observations and provenance.

What stays out is deliberate. Deleting a note and changing whether an agent sees one stay in the note
list, where the scope and the current value are both on screen. Accepting or rejecting a proposal
needs the proposal's body and its verification flags in front of the reader. Adding a memory needs a
name, a type, a scope, and a body, which is four fields rather than one line.

## Lifecycle hooks

Managed-agent completion records Findings checkpoints when Findings is active. Ordinary turns do
not create review cards or notices. Terminal exit and top-level workflow completion contribute
evidence through their own completion events and bounded read capabilities. Task archive freezes the
task's evidence through an awaited pre-teardown hook and queues one project-scoped review when a backend
and target are configured. Workflow handoff notes remain notes and are read only as bounded input for
the workflow boundary. If Findings is disabled, task completion and manual Memory editing continue;
proposals require Findings and return unavailable when it is disabled.
