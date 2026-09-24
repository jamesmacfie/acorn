# Archive: search, preview, and restore

Status: proposal, 2026-09-24. Nothing here has started.

Archiving a task deletes far less than it looks like it does. The task row, its agent transcripts,
and every plugin's rows keep their data. What goes is the worktree folder, anything running, and
state the client held in memory. That makes a page to search, preview, and restore archived work
mostly a read-and-UI job, not a recovery job. This file records what archive does today, what each
of the three features would take, and the numbers behind the search cost.

Owning docs win where this disagrees with them.
[workspaces-and-tasks.md](../workspaces-and-tasks.md) holds the archive order and the confirmation
dialog, and [managed-agents.md](../managed-agents.md) holds how a session retires with its task.

## What archive removes

`archiveTask` in `packages/node-core/src/server/storage/archive.ts` runs these steps in order:

1. Runs the project's teardown script, while the worktree still exists.
2. Kills the task's running terminal sessions.
3. Runs the plugin cleanups the owner ticked in the dialog. Docker is the only plugin that offers
   one, to stop the task's containers. Terminal and Changes only warn.
4. Removes the worktree folder with `git worktree remove`. A forced archive discards uncommitted
   files. The branch is not deleted, so committed work survives.
5. Drops the task's terminal sessions from memory. The terminal plugin also deletes its saved tmux
   session rows (`dropTaskSessions` in `plugins/terminal/src/server/terminal.ts`). Scrollback lived
   only in memory, so it is gone.
6. Sets the task's status to `archived`, stamps `archivedAt`, and clears `worktreePath`.

In the client, `runtime:task-archived` fans out through
`packages/client-core/src/host/registries/shell/scopeEviction.ts` to about 25 listeners. Each drops
state it keyed by the task: open editor tabs, diff view state, notices, the transcript reading place,
and so on. None of that is stored data, and none of it needs restoring. A restored task opens the way
a task opens on a fresh start.

## What archive keeps

Everything else. The core task row stays, and so do its `task_links` and `task_pulls` rows.

Agent sessions are not touched at all. A session whose task is no longer active counts as retired
when the list is read, and moves from the live list to Agent Center's archived list. Its turns,
events, requests, and artifacts all stay. Only the explicit delete route removes them, and the UI no
longer offers that route.

Every plugin stores `task_id` as a plain id with no foreign key, and none of them deletes anything
on archive. That covers browser captures, Changes, Database, Findings, HTTP drafts, Terminal, and
Workflows. Task notes are markdown files under the data root and stay as well.

The one real delete is removing a project. It removes the core task, link, and pull request rows
(`packages/node-core/src/server/projects.ts`) and leaves plugin rows behind with nothing to point
at. An archive page cannot show those, and this proposal does not try to.

## Restore

### Tasks

The task update route already accepts `status: 'active'` and clears `archivedAt`
(`packages/node-core/src/server/routes/projects/tasks.ts`). Nothing in the UI calls it.

Setting a task back to active is enough to bring its worktree back. `taskRoot` in
`packages/node-core/src/server/worktrees/taskWorktree.ts` returns nothing for an archived task, but
for an active task with no `worktreePath` it creates a worktree on the task's branch. It copies the
configured files and runs the `core:worktree-created` hook, which runs the setup script. So restore
is a status write plus a button, and the first pane that asks for the task's folder rebuilds it.

Two things can go wrong, and the restore should report both and not hide them:

- The branch is checked out in another worktree. Creation refuses with `worktree-unavailable`, which
  is the right answer, and the owner has to free the branch.
- The branch no longer exists, for example because a merged pull request deleted it. Creation looks
  like it makes a fresh branch in that case, which would restore the task onto an empty branch
  without saying so. Check this before building (see below).

A restored task does not get its containers, terminal sessions, or scrollback back. Docker can start
containers again from the pane. That is acceptable for a restore and worth one line in the UI.

### Sessions

The agents plugin supports `archived: false` on a session update and announces a `restored` change.
[managed-agents.md](../managed-agents.md) says unarchive belongs in Agent Center, but
`plugins/agents/src/client/center/AgentCenter.tsx` only has an archived filter, with no restore
action.

A session also stays retired while its task is archived, so restoring a session under an archived
task changes nothing the owner can see. Restoring a task should bring its sessions back to the live
list, which it already does, because retirement is worked out when the list is read. The only thing
to build for sessions is a restore action for a session someone archived on its own, and it belongs
in Agent Center beside the archived filter.

## Preview

Treat preview as opening the archived task read-only. The panes read by task id and the data is
still there, so most of them can draw their history without a new contract. The exceptions are the
panes that need the worktree: editor, Changes, and anything that starts a process. Those should say
the task is archived and offer restore, not try to run.

Agent transcripts already work for this. A session read that names a task id is exempt from
retirement, because the task pane is looking at that task.

This needs a small amount of core work: an archived task has to be selectable without appearing in
the rail, and the pane host needs to know it is read-only. Settle how that flag reaches a pane before
building. The obvious answer is the task's status on the task the pane already receives.

## Search

### What it costs

Measured on 2026-09-24 against a copy of a real development database: 1.4 GB, 430 sessions, about
495,000 agent events, 259 MB of searchable text, and 145 tasks, 136 of them archived. The queries
were the shapes `searchSessions` in `plugins/agents/src/server/sessions/sessionRepository.ts` runs.

| Query | Time |
| --- | --- |
| Task title or branch, substring match | under 1 ms |
| Session title, substring match | under 1 ms |
| Agent text, an ordinary word | 20 to 70 ms |
| Agent text, a prefix such as `teard*` | 20 ms |
| Highlighted snippets for 50 hits | 19 ms |
| Agent text, a very common word such as "the" | 580 ms |
| Agent text, substring scan with no index | 775 ms |

Titles and branches need nothing: a few hundred rows scan in well under a millisecond. Agent text
already has a SQLite full-text index, `agent_events_fts`, defined in
`plugins/agents/migrations/0000_cold_william_stryker.sql`. The slow common-word case comes from
ranking every hit, and a minimum query length of three characters plus a debounce on the input covers
it. The unindexed scan shows where the line is: fine for a plugin with a few thousand rows, wrong for
anything the size of a transcript.

### Fix the agent index first

Three problems in the index make search worse today, not just on an archive page.

**Assistant replies are indexed as streaming fragments.** A reply arrives as many `append` events
(`plugins/agents/src/server/sessions/durableEventBuffer.ts`), and each one is stored and indexed as
its own row. In the measured database, 148,000 assistant rows average 21 characters. A search for
two words only matches when both land in the same fragment, so most multi-word searches miss
assistant text entirely. Index each finished message once, not each fragment. That changes what
`agentEventSearchText` in `packages/protocol/src/managedAgents.ts` is called on, and it needs a
migration to rebuild the index. `plugins/agents/src/server/ftsSchema.test.ts` keeps the index shape
and the schema in step and will need updating with it.

**Session search skips archived sessions.** `searchSessions` filters on `archivedAt IS NULL`. The
archive page needs a way to ask for archived ones, including sessions retired by their task.

**Tool output dominates.** Tool events are 255,000 of the 420,000 indexed rows, at about 1 KB each.
Unless they rank lower or are left out, file dumps and command output bury the conversation. Try
ranking them lower first, because searching for a command someone ran is a real use.

Separately, the index stores its own full copy of the text: 324 MB beside the 259 MB in
`agent_events`. Pointing the index at the events table as external content would save about 300 MB
on this database. It is not needed for search, but the migration above is the cheap moment to do it.

### How plugins opt in

No search seam exists. Copy the shape of task checks
(`packages/node-core/src/server/pluginHost/taskChecks.ts`): a plugin registers a search provider on
its node context, and core sends a query to every provider at once. Each plugin searches its own
database however suits its data, full-text for agents and substring matching for small tables. Core
searches task titles and branches itself, as one more provider.

Results come back grouped by provider, the way Spotlight groups them. Relevance scores from different
indexes cannot be compared, so merging them into one ranked list would be a guess dressed as an
order.

A provider decides which of its rows are searchable and what a hit shows. Raw rows are mostly machine
state, such as event JSON and metadata blobs, and matching on them returns noise. So a plugin does
not expose tables. It answers a query with a short list of hits, each carrying:

- The task id the hit belongs to, or none for a workspace-level hit.
- A title and a short preview, as plain text.
- A target to open, using the same target shapes notices and rail rows already use.

The query carries the text, a result cap, and the scope: which tasks, and whether archived ones
count. Likely first providers, beyond agents:

- HTTP request drafts.
- Findings.
- Browser captures.
- Workflow runs.
- Database saved queries.
- Notes, which search markdown files on disk, not rows.

Plugins run in a worker, and cancelling a request does not reach them. A query keeps running after
the owner types the next letter. So the client debounces, and core gives each provider a result cap
and a timeout. One slow plugin then cannot hold up the page, and one noisy plugin cannot flood it.
A provider that times out shows as a group that could not answer, not as an empty group.

## The page

One page, reached from the rail. It lists archived tasks newest first, with a search box over the
providers above. Selecting a task opens its preview. Restore sits on the task row and in the preview
header.

The page should be one more place the search seam is used, not its owner. The same providers can
back a search across active tasks later, and nothing in the contract should assume archive.

## Not doing

- **One central index that plugins push documents into.** It gives one ranking, but every plugin
  keeps two copies of its data in step, and deletes and uninstalls have to clean both. That is the
  dual-write problem the projects migration already carries. Revisit only if grouped results turn out
  to be unusable.
- **Searching every row a plugin owns.** Plugins choose what is searchable.
- **Restoring what archive stopped.** Containers, terminal sessions, and scrollback stay gone.
- **Bringing back tasks from a removed project.** Their core rows are deleted.

## Verify before building

- What `ensureWorktree` in `packages/node-core/src/server/worktrees/worktrees.ts` does when the
  task's branch no longer exists. If it creates a fresh branch, restore has to check first and ask.
- That the task update route's status change is enough on its own, and nothing else reads
  `archivedAt` in a way that a cleared value would confuse.
- How much of the rail and pane host assumes a selected task is active, before designing read-only
  preview.
- The fragment count and average length on another database, to confirm the indexing problem is not
  one database's accident.
- Whether the harness drivers ever write a final full-text assistant event alongside the fragments.
  If one does, indexing only that event is the whole fix.

## Left open

Whether search results should also cover active tasks from day one. The seam does not care, and a
global search is probably the more used feature, but it pulls in ranking questions the archive page
can avoid. Decide after the agent index fix, when multi-word search actually works.
