# Archived agent history

An archived task can give up its agent history when you choose. Nothing else deletes a session's
events, and they're most of `plugins/agents.sqlite`. This page covers the setting, what the pass
removes, and how it runs. The pass is `removeExpiredHistory` in
`plugins/agents/src/server/sessions/historyRetention.ts`.

## The setting

**Keep agent history for archived tasks**, under Settings > Agents > Harnesses and defaults, is
forever unless you pick 30 days, 90 days, or 1 year. The `agents:archived-history-prune` schedule runs
daily at 03:50 and does nothing while it's forever ([schedules](../schedules.md#what-is-registered)).
Otherwise it asks core for tasks archived longer than the limit, through
`ctx.core.tasks.archivedBefore`, and removes the history of each of their sessions. A restore clears a
task's archive date, so a restored or active task is never in the list.

## What it removes

History is everything the session owns except its row: events and their search rows, turns, requests,
attachment references, and artifacts. Attachment and artifact files that nothing else references are
deleted from disk. The row stays, with one note in place of the transcript, such as "Acorn removed
this session's history because its task had been archived for more than 90 days." It's marked with
`history_removed_at`, so a second run does nothing.

The row stays, unlike **Delete**, for these reasons:

- The archive page previews an archived task through its Agent pane, and a restored task opens the
  same pane. Without the row, the task would look as if it never had an agent.
- Core's task pull relations, the delegation ledger, workflow steps, terminal handoffs, and memory
  proposals name the session by ID.
- The provider's own conversation is untouched, because deleting it means starting each CLI. A
  restored task can still prompt the session, and the agent remembers what the transcript dropped.
- The row is small.

## How it runs

The pass skips a session with a live provider process or a turn dispatching or running, and leaves it
for a later run. The database is synchronous, so the pass works in steps of one transaction, each
deleting 200 of a session's oldest events, and yields between them. On 20,000 synthetic tool rows of
about 2 KB, a step took a median of 7 ms. A last transaction removes the turns, requests, attachment
references, and artifacts, writes the note, and marks the row.

Core is asked for the task list before every step, with no yield between that answer and the write,
so a task restored partway keeps what it has. The run stops after four minutes (`RUN_BUDGET_MS`),
inside the scheduler's 300-second ceiling, and the next day carries on. When it deleted anything, it
merges the search index. The file keeps its size
([backup and retention](../data-layer/backup-and-retention.md)).

A window with a pruned session open keeps the events it drew until it reloads, because a reader
resumes after its mark. The note arrives as an ordinary event, and a reload shows only the note.
