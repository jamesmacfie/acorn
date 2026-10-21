# Phase 3: scale background reads with the screen

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
