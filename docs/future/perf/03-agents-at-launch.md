# Phase 3: keep the agents cleanup out of the window's way

## Completion note

The code landed on October 19, 2026. Phase 1's per-step numbers from the owner's data root don't
exist yet, so the steps were timed by running their reads against the owner's `agents.sqlite`, opened
read-only with `node:sqlite`, while the app ran. "Cold" below means the first read in a run, when the
pages weren't in memory. All four [acceptance](#acceptance) items stay open, because they need phase
1's baseline and launches on the owner's data root.

What changed:

- Two loops in `ManagedAgentRuntime.reconcile` record with `settle: false`: the one that stops
  unsettled sessions and the one that idles stranded children. Before, each recorded stop and each
  idled child ran `settleCommands({ sessionId })`, which reads the session's whole history. That
  read took 230 ms with the pages in memory and 1,827 ms cold on the owner's largest session (31,157
  events). It took 92 ms and 633 ms on the second largest. The settle scoped to the last start,
  which runs next, now covers those sessions. The last start settled everything older.
- The scoped `unfinishedCommands` read runs once. `settleCommands` returns the commands it left
  pending or running, and the background pass reads those. With the pages in memory, the read took
  27 ms when the last start was 3.6 hours earlier (8,047 events), 55 ms over a day (15,341), 245 ms
  over three days (53,086), and about 800 ms over a week (176,547). Cold, it took 139 ms and
  1,883 ms at the ends of that range. It grows with how long the last Node ran, and the second read
  repeated it.
- `reconcile` gives the event loop a turn with `setImmediate` from `node:timers/promises` after each
  step, and after every 50 items in its three loops (`givingWay`).
- The managed agents router makes every request other than `GET` and `HEAD` wait for
  `bridge.reconciled()`. That's the root's `reconciled`, the promise workflow admission and the
  delegation tools wait on. Reads don't wait.
- Tests: `routes/managedStartup.test.ts` shows a read answering while `reconcile` is held inside a
  step and a write waiting until it resolves, and that the loop gets a turn after each step. A new
  case in `commandLifecycle.test.ts` shows one scoped read settling a stopped session, an idled
  child, and a background command. All three fail on the old code. The step tests didn't change.
- Docs: [sessions](../../managed-agents/sessions.md#session-model) and
  [background commands](../../managed-agents/background-commands.md#when-the-exit-never-comes).
  The Node's route golden gained one `ALL /v1/p/agents/*` line for the new middleware.

Steps left alone, because their timings don't justify a change:

- `sessionsWithActiveSubagents` took 2.8 to 5.5 ms for 33 full rows, and 0.9 to 1.4 ms with only the
  id and the roster.
- Collecting attachments looked at 390 rows, all still referenced, in 1.1 to 1.7 ms. The owner's root
  has no `agent-skills` folder, so the skill sweep does nothing. Neither moved to the background.
- `requeueSteeringTurns` scans `agent_turns`, 12 MB. It took 162 ms cold and 1.3 to 1.9 ms after. One
  cold sample doesn't justify a migration. Phase 1's numbers decide whether it needs an index.
- The other reads took under 2 ms each, and the delegation's reporting-turns read took 30 ms cold
  and 4 ms after.

Opening the pane from cached data:

- The provider list is the persisted query `['agents', 'providers']`, with no `persist: false`.
- The session list isn't a query. `managedAgentStore.loadTask` keeps it in memory only, so a cold
  launch always waits for `/v1/p/agents/sessions`. That read took 18 to 31 ms for the task with the
  most live sessions, 205. Caching it wouldn't make the pane usable sooner when a session is selected,
  because the pane then waits for the transcript. Nothing changed.
- The transcript of the largest session is 16 pages of 2,000 events, 44.8 MB of event JSON. Reading
  and parsing every page took 145 ms in memory, at most 12 ms a page, and 2,447 ms cold, at most
  319 ms a page. A page is quick once the Node answers, but the size is real work for the Node, the
  socket, and the client's merge. That's its own change, not made here.

For later phases:

- `record` still settles a session's whole history on every `turn_completed`, `error`, stop, and
  idle child outside startup, so a long session holds the loop for hundreds of milliseconds each time
  a turn ends. [The performance spans plan](../performance-spans.md) covers slow work after launch.
- A single SQLite statement can't yield. The scoped settle grows with how long the last Node ran.
- Usage settings and the MCP server routes don't wait for the cleanup. Raising the concurrency limit
  during it drains the queue, which can start a queued turn before the cleanup ends. That was true
  before this change.
- `pnpm --filter @acorn/node build` fails its service budget, as it did on the base commit. This
  change adds 518 B, from 1,887,993 B to 1,888,511 B against a 1,884,400 B ceiling. The ceiling
  wasn't raised.

Date: October 19, 2026. Status: code landed, acceptance not measured.

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
