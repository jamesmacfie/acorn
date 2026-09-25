# Archive: search, preview, and restore

Status: shipped on `james/unarchive`, 2026-09-24. Manual smoke in the app is owed. This file now
records what shipped, where it is written up, and what was left out. The owning docs win.

## Where it lives now

- What archive keeps and removes, the archive page, the read-only preview, and restore:
  [workspaces-and-tasks.md § Restoring a task](../workspaces-and-tasks.md).
- `readsArchived` on a pane contribution: [panes.md § Contributions](../panes.md).
- The search seam, `ctx.search`: [plugins.md § Search providers](../plugins.md), and its row in
  [contribution-kinds.md](../contribution-kinds.md).
- The agent index fix and its numbers, and Agent Center's restore button:
  [managed-agents.md § Transcript search and § Client surfaces](../managed-agents.md).

## What the verification found

- `ensureWorktree` does make a fresh branch from the project checkout when a local task's branch is
  gone. Restore checks first and asks. A pull request task fetches its head again, so it cannot lose
  its branch this way.
- Nothing else reads `archivedAt` in a way a cleared value confuses. The PATCH route still accepts
  `status: 'active'`, with no branch check. The UI uses the restore route instead.
- The rail and the task view both read the active task list, so an archived task could not be
  activated without appearing in the rail. The preview selects it inside the archive page and draws it
  in the ordinary pane host instead, and panes read `task.status`.
- A second database showed the same fragments: 287 assistant rows averaging 21 characters, which
  became 5 messages.
- No harness writes a final full-text assistant event. Codex's `item/completed` carries one for an
  agent message, but the normaliser drops it and Claude has nothing like it, so the repository indexes
  the stream itself.

## Left out

- **More providers.** Only core's tasks and the agents plugin answer today. HTTP drafts, findings,
  browser captures, workflow runs, database saved queries and notes are the likely next ones, each a
  `ctx.search.register` in its own plugin.
- **Loaded search providers.** `ctx.search` is compiled only. Its twin is a manifest route the host
  calls, shaped like task checks, and it waits for a loaded plugin that wants to be searchable. Loaded
  task panes can opt into the archived preview with `readsArchived: true` on their `frames` entry.
- **Search across active tasks.** The route takes `archived=0` already. No surface asks, because the
  ranking questions a global search raises were not needed for the archive page.
- **External-content FTS.** It would save about 300 MB on the measured database, but it needs stable
  rowids and `agent_events` has a text key, so a VACUUM could renumber them.
- **Individually archived sessions in the preview.** Search finds a session someone archived on its
  own, but the Agent pane loads only unarchived sessions, so opening that hit in the preview selects
  nothing. Restore the session from Agent Center, or load archived sessions in the pane when its task
  is archived.
- **Restoring what archive stopped.** Containers, terminal sessions and scrollback stay gone.
- **Tasks from a removed project.** Their core rows are deleted.

## Smoke owed

In the real window (`pnpm dev:agent`): archive a task with a committed change, find it on the Archive
page by a word from its agent transcript, open the matching session in the preview, check that its
right rail contains only Agent and Notes, restore it, and check that the worktree comes back with the
commit. Then delete the branch of another archived local task and check that restore asks before
cutting a new one.
