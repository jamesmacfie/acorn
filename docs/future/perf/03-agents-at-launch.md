# Phase 3: keep the agents cleanup out of the window's way

Date: October 19, 2026. Status: proposed. Needs phase 1's per-step timing.

Right after the Node starts listening, the agents plugin repairs what the last run left behind. On
the owner's data root that took 1,451 ms on October 18, 2026, against 9 to 12 ms on a scratch root.
The Agents pane is the slowest pane to become usable on a first opening. This phase shortens the
cleanup, keeps the Node answering while it runs, and makes the pane open from cached data. Read
[the programme](./README.md) first.

## Starting point

- `ManagedAgentRuntime.reconcile` in `plugins/agents/src/server/sessions/runtime.ts` runs these steps
  in order: interrupt each unsettled session's turn, idle every stranded subagent, requeue steering
  turns, settle unfinished commands, mark background commands unknown, cancel workflow follow-ups,
  collect unused attachments, sweep skill folders, reconcile webhooks, and recover goals. Then it
  starts queued turns without waiting.
- The store runs on `node:sqlite`'s `DatabaseSync` (`packages/node-core/src/server/storage/sqlite.ts`),
  so every statement is synchronous. An `await` on an already-finished query lets other promises run,
  but not the HTTP server's socket callbacks. A chain of synchronous statements joined by `await`s
  holds every incoming request until it reaches real input or output. That's a likely reason the
  window's first reads were slow. Phase 1 confirms or rules it out.
- Command settling is already scoped. `unfinishedCommands` in
  `plugins/agents/src/server/sessions/commandLifecycle.ts` reads only events written since the
  cursor in `agent_command_settle`, through `agent_events_created_idx`. The same query runs twice,
  though: once inside `settleCommands` and again for background commands.
- `sessionsWithActiveSubagents` in `plugins/agents/src/server/sessions/store.ts` reads full rows for
  every unarchived session with a non-empty subagent list, then filters them in memory.
  `agent_sessions` is 49 MB on the owner's root.
- The owner's `agents.sqlite` holds 833,024 events in 1,216 sessions.
- The pane reports usable in `plugins/agents/src/client/sessions/AgentPane.tsx` once the session
  list has answered and either the selected session's transcript has loaded, or no session is
  selected and the provider list isn't pending. The session and provider queries persist across
  launches by default (`shouldPersistQuery` in `packages/client-core/src/infra/persistence/queryPersistence.ts`).
  The transcript comes from a store that doesn't persist.
- Over 14 days, the first opening of the Agents pane took 1,193 ms at the median and 11,231 ms at the
  95th percentile, and four openings timed out. The slowest single answers were 26,923 ms for
  `/v1/p/agents/sessions` and 4,730 ms for one session. Most answers took under 100 ms.
- The workflows plugin already makes its writes wait for boot cleanup. `runs/admission.ts` and
  `runs/control.ts` under `plugins/workflows/src/server/` await `reconciled`.

## Changes

### Shorten the slow steps

Take every `reconcile.agents.<step>` over 50 ms in phase 1's numbers for the owner's root. For each
one, run `EXPLAIN QUERY PLAN` on its statements against the owner's file, opened with
`sqlite3 -readonly`, which is safe while the app runs. Then pick the change that fits:

- A full scan becomes an indexed, scoped read, the way command settling reads only events since its
  cursor. A new index needs a migration through `pnpm db:generate`.
- A step that reads whole rows to test one column selects only the columns it tests.
  `sessionsWithActiveSubagents` needs the id and the subagent list.
- The duplicated `unfinishedCommands` read runs once, and both passes use its rows.
- File work, like collecting attachments and sweeping skill folders, moves to a background task after
  the cleanup. Nothing a reader sees depends on it.

Don't change what the cleanup decides. Each step's tests in the agents plugin keep passing unchanged.

### Let requests in while the cleanup runs

1. Yield to the event loop between steps, and every 50 sessions inside a per-session loop, with
   `await setImmediate()` from `node:timers/promises`. No stretch of synchronous work during the
   cleanup should last more than 50 ms.
2. Make the agents plugin's write routes wait for the cleanup, as workflow admission does. A prompt
   sent in the first second would otherwise reach a session the cleanup is about to interrupt. Read
   routes don't wait. A session the cleanup hasn't reached yet can read as working until the engine
   sends the row it changed, which the pane already handles.
3. Leave `pump()` where it is, after the cleanup. Starting queued turns before sessions are settled
   would change behavior.

### Open the pane from cached data

Use phase 1's list of requests from a cold launch to see what the pane waited on:

- **The session list or the provider list.** Both should come from the persisted cache. If either
  query sets `meta: { persist: false }`, or its key starts with something `shouldPersistQueryKey`
  drops, find out why before you change it. The answer might be a reason, not an oversight.
- **The selected session's transcript.** Time `GET /v1/p/agents/sessions/:sessionId` on the owner's
  largest session with the Node idle. If it's fast once the Node answers, the yielding above fixes the
  launch. If it's slow on its own, the read path is the work, and that becomes its own change with
  its own measurement.

Don't persist transcripts in the query cache. One transcript can be several megabytes, and the cache
is saved often.

## Tests

- A runtime test with a seeded store: an authenticated read on the agents router answers while
  `reconcile` is between steps, and a write waits until `reconcile` resolves.
- For each step you changed, a store test with enough rows to show the scoped read returns the same
  rows as the old one.
- If you add an index, the migration check passes: `pnpm db:check`.

## Acceptance

Against phase 1's baseline on the owner's data root:

- No single `reconcile.agents.<step>` holds the event loop for more than 50 ms. Read it from
  `runtime.event_loop.max` if phase 1 fixed that reading, or from a request timed during the cleanup
  if not.
- On launches with `node.waited`, the window's first `api.request` after the Node listens answers
  within 200 ms at the median.
- The Agents pane's first opening on a cold launch drops at the median and the 95th percentile. Record
  both.
- No Agents pane timeout in the first minute after a cold launch over a working week.
