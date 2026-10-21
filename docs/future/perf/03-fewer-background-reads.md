# Phase 3: scale background reads with the screen

## Completion note

Landed October 21, 2026, on branch `phase-3-fewer-background-reads`. The code, tests, and docs are
done. The before and after counts, the real-window check, and the acceptance's day of Sentry aren't
taken, and need the owner's machine.

What landed:

- `GET /v1/core/task-scripts?ids=` answers many tasks' scripts in one map, keyed by task ID and
  filtered for a task token. The rail reads every row through `createTaskScriptsBatch`, which asks for
  at most 100 tasks a request and writes each answer under the task's own key, so `cachedTaskScripts`
  still works. The batch isn't persisted. The terminal client's pane strip keeps its one per-task query.
- Task status no longer refreshes on `agent-session:changed`. `/v1/core/task-statuses` takes `?ids=`.
  The desktop asks about the rail's rows and the open task, and asks again when that set changes.
  Client schedules take `unfocusedIntervalMs`, and the status poll runs every 10 seconds, or every 30
  without focus. The focus answer moved from the notice gate to the platform seam, as `hostFocused`
  and `setHostFocused` in `infra/platform`.
- The Docker service answers the task summary from its last `docker ps` list, reads it again behind
  the answer at most every 10 seconds, and remembers a failure for 30. Each summary entry carries
  `observedAt`. The Docker pane says "Docker last answered 3m ago." once the list is over a minute old.
- `refetchOnWindowFocus` defaults to false. Kept pane models gate their queries on `pane.shown()`.
  `ws:shed` waits 500 ms, and a second shed in that time joins the first.
- The caching, worktrees, schedules, Docker, pane models, core routes, transport and auth, platform
  seam, and backpressure pages describe the new reads, and so does the site's Docker page.

Decisions and deviations:

1. The batched route, not the pushed frame, as the coordinator chose. It needs no protocol change. The
   15-second interval stays. A `task-scripts:changed` frame with a 60-second backstop is left for later.
2. Any `tasks:changed` frame invalidates every script query, because the rail's one query is what moves
   a row's markers. A frame that names one task re-reads all the rail's rows in one request, where it
   used to re-read one task. A frame that names none used to send one request per task.
3. A Node without the batched route answers 404, and the client reads task by task. Docker's
   `observedAt` is optional for the same reason. Both are mixed-version paths until 2027-01-19.
4. `?ids=` takes 1 to 100 IDs, through `taskIdsQuery` and `taskIdsQuerySchema` in
   `@acorn/protocol/task.ts`. Past 100 rows, the scripts read splits into requests of 100, and the
   status read asks for every active task, because naming them saves little.
5. The status read names the open task as well as the rail's rows, because the task footer and the
   Changes pane read it. The terminal client names no tasks and sweeps every active worktree as
   before. A task off every rail isn't swept, so its `head:changed` waits until a client asks again.
6. The unfocused clock lives in the schedule runner and counts ticks, so events still refresh at once.
   Unknown focus counts as focused.
7. Solid Query 5.101 has no `subscribed` option. Kept models pass `enabled: … && pane.shown()`
   instead, as Git's History and Worktrees queries already did: the agent pane's harness and custom
   agent lists, the Changes tab's projects and preferences, and Notes' workspaces. A disabled observer
   keeps its data, doesn't suspend, and isn't active. Pane regions unmount when hidden, so only model
   queries needed it.
8. `ws:shed` still runs every reconnect subscriber after the 500 ms wait. The query half matches the
   doc: the desktop's handler refetches only active queries, and kept models' queries aren't active.
   Plugin stores such as terminal sessions, workflow runs, and Docker keep their refresh, because a
   shed means they missed a frame, and nothing else would correct them until their next event.
9. Only the task summary uses Docker's remembered list. The pane's chips, agent context, which says
   `live`, the archive check, and teardown read Docker fresh. After a docker event the next summary
   read waits for a fresh list, so a container that starts still shows at once. The pane's age line
   reads the summary's `observedAt` from its own signal, so the rail badges don't redraw every poll.
10. No query was set back to refetch on focus. The editor reloads on window focus through its own
    listener, and the pull request pane hears GitHub's `pr-synced` frames.
11. `taskStatus.test.ts` became `taskStatus.test.tsx`, because Solid effects only run in the jsdom
    project.

Not done:

- The before and after counts. A `pnpm dev:agent` window is hidden, so neither the rail's poll nor a
  client schedule runs there. By the code alone, 117 rail rows go from about eight script reads a
  second to one read every 15 seconds for each window.
- The real-app check. With the bundle over its ceiling, `dev:agent` staging fails, and the
  `--prepared` route needs a cargo build. The Docker age line is checked in a jsdom test only.
- The acceptance's day of Sentry: `git.status.count`, `/v1/core/tasks/:id/scripts` calls, and
  `/v1/p/docker/task-summary` slow calls.
- `pnpm --filter @acorn/site stale --touching` lists 15 pages. The Docker page is updated and marked.
  The other 14 describe nothing this phase changed.
- The programme README still lists this phase. Trim it when the programme closes.

For later phases:

- The Node service bundle is 1,932,148 bytes. The base measured 1,930,648, so this phase adds 1,500
  bytes, from the two routes and Docker's remembered list. The coordinator raised the ceiling to
  1,934,100 in a separate commit.
- Phase 4: Docker summaries now run `docker ps` at most once every 10 seconds for each Node, and a
  failing daemon once every 30.
- Phase 9: the agent pane's harness list is enabled once the pane is drawn. The host marks it drawn
  before its regions render, so the first open shouldn't wait longer, but measure it.
- The rail's setup and archiving markers still hide while the scripts read is in flight, as each row's
  did before.

Date: October 21, 2026. Status: proposed. Build after phase 2.

Several polls run once per task, or wake on every agent frame. They spawn Git and Docker on the Node,
fill the helper's sockets, and refetch in bursts right when you come back to the window. This phase
makes them follow what's on screen. Read [the programme](./README.md) first.

## Starting point

- `CoreTaskList` in `packages/client-core/src/features/tabs/TabRail.tsx` calls `createTaskScripts`
  for each visible task. `packages/client-core/src/features/tasks/taskScripts.ts` polls
  `/v1/core/tasks/:id/scripts` every 15 s. With about 117 tasks, that's about eight reads a second.
- `taskStatusScheduleContribution` in `packages/client-core/src/features/tasks/taskStatus.ts` refreshes
  `/v1/core/task-statuses` every 10 s, and on every `agent-session:changed` and
  `worktree:status-changed` frame. The route runs `git status --porcelain=v2 --untracked-files=all`
  in each active worktree, with a 2 s cache
  (`packages/node-core/src/server/worktrees/worktreeStatus.ts`). Core `git.status.count` was 39,689
  in the 24 hours to October 21, against 11,656 on October 13.
- `/v1/p/docker/task-summary` ran 14,928 times in a week, at 355 ms at the median. It waits up to
  20 s on `docker ps` and never caches a failure, so a stalled Docker daemon makes every poll wait.
- `fleet.ts` sets `refetchOnWindowFocus: true` with a 30 s `staleTime`. Coming back to the window
  refetches every active query, and kept tasks keep their queries active.
- `wsClient.ts` answers `ws:shed` by invalidating every active query and calling every plugin's
  reconnect refresh. The Node sheds only when the socket is behind, so this adds load while the app is
  congested.

## Changes

### One read for the rail's scripts

Replace the per-task scripts query with one query for the visible task ids, through a new
`GET /v1/core/task-scripts?ids=` route that returns a map. Keep `cachedTaskScripts` working by writing
each task's entry into the cache from that one response. Better still, have the Node push a
`task-scripts:changed` frame when a script starts or stops, and drop the interval to 60 s as a backstop.
Check which one the route's owner prefers. The push needs a protocol change.

### Status only where something changed

1. Stop refreshing on `agent-session:changed`. An agent that writes files raises
   `worktree:status-changed` already, so the session frame adds nothing but another `git status` in
   every worktree.
2. Give `/v1/core/task-statuses` an `ids` filter, and ask only for tasks the rail shows.
3. Raise the backstop interval to 30 s while the window has no focus.

Keep the explicit `fresh: true` reads that guard removal. They decide whether work is lost.

### Serve Docker's last answer

Return the last `docker ps` list at once and refresh it in the background, at most once every 10 s.
Cache a failure for 30 s. Show the list's age in the pane when it's older than a minute.

### Refetch on focus only what's on screen

Set `refetchOnWindowFocus: false` as the default. The socket keeps data fresh while connected, and the
pane queries that need focus refresh can set it back. Give kept-task queries `subscribed: pane.shown()`
so they stop counting as active. On `ws:shed`, wait 500 ms, then refetch only queries with an
observer on screen.

## Tests

- The rail renders 100 tasks and sends one scripts read.
- An `agent-session:changed` frame doesn't refresh task statuses.
- The Docker summary answers from cache while `docker ps` hangs, and a failure is served for 30 s.
- A focus event refetches no query whose pane is hidden.

## Acceptance

- Core `git.status.count` under 12,000 a day, against 39,689.
- `/v1/core/tasks/:id/scripts` gone from the slow-call list, or under 1,000 calls a day.
- `/v1/p/docker/task-summary` slow calls down by at least half, against 3,525 a week.
- [Renderer query cache](../../caching.md#renderer-query-cache) and
  [task script snapshots](../../caching.md#task-script-snapshots) describe the new reads.
