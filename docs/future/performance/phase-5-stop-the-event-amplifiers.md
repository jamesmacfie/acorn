# Phase 5: stop the event amplifiers

Status: not started. Waits on phase 0 for the request log that shows the amplification.

## Goal

One content-free ping no longer makes every connected client re-ask the node most of what it knows,
the helper stops forwarding frames the renderer will drop, transient congestion stops escalating into
a reconnect, and the node answers repeated status and auth questions from a short-lived cache instead
of a fresh process or a fresh `SELECT`. This is [decisions.md](./decisions.md) decision 4 plus the
event work from [architecture.md](./architecture.md) §§ 2 and 4.

## Why this phase, and why now

The node's `/v2/events` socket broadcasts everything to every client
(`packages/node-core/src/server/transport/wsHub.ts`), and one frame in particular is expensive to
hear. `term:status` is a content-free ping on every terminal idle-to-busy edge, and also on task
creates and worktree changes. Six subscribers answer it:
`packages/client-core/src/host/chrome/chromeData.ts` calls `bumpChrome()` with no plugin id, which
refetches every plugin's rail rows, badges, and collections;
`packages/client-core/src/features/tasks/taskStatus.ts` runs a `git status` sweep over every active
worktree; `packages/client-core/src/features/tasks/agentSessions.ts` refetches the session list;
`plugins/github/src/client/pullDetail/prTabs.ts` invalidates two pull-request keys;
`plugins/agents/src/client/sessions/AgentTaskSidebar.tsx` refetches its runs; and
`plugins/terminal/src/client/terminalClient.ts` re-exports it. One busy terminal, every client, every
edge.

`bumpChrome` already takes a plugin id and keeps a per-plugin revision behind it; the `wsOnStatus`
call is the one caller that passes nothing. That fix is one argument. The rest of the ping's fan-out
needs the event split into what actually changed.

On the node, the git sweep is the sharpest cost in the whole trace. One local-changes read in
`plugins/changes/src/server/localDiff.ts` is `git status --porcelain=v2` and then two `git diff
--numstat` calls, three processes per worktree, and
`packages/node-core/src/server/worktrees/worktrees.ts` runs its own `git status` twice more for the
same worktree from a different caller. `packages/node-core/src/server/core/git.ts` is a 64-line
wrapper with no cache and no in-flight dedup, there is no filesystem watcher, and every client asks
independently. Two clients and four worktrees is twelve processes per ping.

Two smaller amplifiers sit beside it. Every authenticated request runs a synchronous SQLite `SELECT`
and a sha256 in `packages/node-core/src/server/auth/deviceTokens.ts`. And the backpressure guard in
`wsHub.ts` drops a frame when a socket buffers past 4 MB but increments `seq` anyway; the broker in
`packages/custody/src/broker/nodeBroker.ts` reads the gap as loss and closes the socket, and
reconnect re-attaches every terminal, forcing a framebuffer serialise per session on the node while
the client refetches its active queries. A build spewing output is answered with more load.

## Scope

In:

- `wsOnStatus(() => bumpChrome())` passes the plugin id, or the event carries one. Then `term:status`
  splits: `terminal:sessions-changed` for the session list, `worktree:status-changed { taskId }` for
  the git sweep, and the plugin channels for the two plugin sidebars, each fired from the place that
  changed the thing. Task creates and worktree changes already have `tasks:changed`.
- The helper filters frames for non-active nodes. `packages/client-core/src/infra/node/wsClient.ts`
  drops `nodeId !== activeNodeId()` after two process boundaries and a parse; the helper knows the
  active node because the renderer tells it which node it is addressing, so the filter moves there.
- PTY pause over the buffer mark, and honest `seq`: a shed frame is marked shed or does not consume a
  sequence number, so the broker distinguishes shed load from lost data and does not reset.
- The task-list N+1 in `packages/node-core/src/server/routes/projects/tasks.ts`: one `inArray` over
  distinct project ids.
- A per-worktree status cache on the node: in-flight dedup keyed by worktree path plus a two-second
  time-to-live, invalidated by the node's own worktree writes and by agent `file_change` events,
  shared by `localDiff.ts` and `worktrees.ts`, and built on the dedup shape
  `packages/node-core/src/server/sync/engine.ts` already has for provider mirrors. The cache serves
  reads only. `worktrees.ts` guards worktree removal on `worktreeDirty(path)`, and a stale "clean"
  would let a destructive removal past it, so the guard and every refusal path take `fresh: true`.
- A device-token cache in front of `deviceTokens.ts`: a `Map` keyed by token hash with a short
  time-to-live, cleared on revoke and rotate. The `lastSeenAt` write stays throttled as it is.
- The idempotency middleware (`packages/node-core/src/server/middleware/idempotency.ts`) stops
  reading bodies for methods it ignores, if it does; confirm.
- The tree host's byte-cap check in `packages/client-core/src/host/tree/workerHost.ts` stops
  re-stringifying every batch on the main thread; the worker side measures before it posts.

Out: a general topic or subscription model on `/v2/events` (refused.md). A filesystem watcher
(refused.md, with the exit condition). Row patching instead of `<noun>:changed` (refused.md).

## Design

**Events say what changed.** Each new event is a `<noun>:changed` frame in the shape
`packages/protocol/src/nodeEvents.ts` already holds, with a one-sentence entry there. Consumers
subscribe to the one that names their data. `term:status` stays for the terminal client's own use and
nothing else hears it.

**The active node is a fact the helper holds.** The renderer's requests already name a node id per
call. The helper records the id of the last request as active and forwards only that node's frames,
plus every node's `node-status`. A node switch changes the fact with the first request to the new
node; the one frame that might be dropped in between is a `:changed` ping, and the switch's own
refetch covers it.

**Backpressure pauses the producer.** `node-pty` exposes `pause()` and `resume()`. The hub pauses
the PTY behind a socket over its mark and resumes when `bufferedAmount` drains; a frame is never
dropped for a paused session. Where a drop still happens (a non-PTY frame, a socket that never
drains), the hub sends a `shed` marker so the broker's gap detection treats it as shed rather than
lost.

**The status cache is a function with a memory.** `worktreeStatus(path, { fresh })` returns the
in-flight promise if one exists, the cached value if it is younger than the TTL, or runs git. The
node invalidates a path when it writes under it (worktree create, checkout, apply) and when an agent
`file_change` event names it. `fresh: true` bypasses everything and is what `worktreeDirty` calls.
The three-process local-changes read shares the status half.

**Auth answers from memory on a warm token.** `authenticate(token)` hashes, looks the hash up in the
cache, and falls through to SQLite on a miss. Revoke and rotate paths delete the entry. The TTL is
short enough (60 seconds) that a revoked token no longer in the cache cannot outlive a person's
expectation, and the revoke path clears it anyway.

## Code touched

- `packages/client-core/src/host/chrome/chromeData.ts`, `taskStatus.ts`, `agentSessions.ts`,
  `prTabs.ts`, `AgentTaskSidebar.tsx`: subscribe to the narrower events.
- `packages/protocol/src/nodeEvents.ts`, `packages/node-core/src/server/notify.ts`, and the
  terminal and worktree emitters.
- `packages/custody/src/broker/nodeBroker.ts`, `apps/desktop/src/helper/helperServer.ts`: the
  active-node filter. `packages/client-core/src/infra/node/wsClient.ts`: the renderer-side filter
  stays as a belt.
- `packages/node-core/src/server/transport/wsHub.ts`, `plugins/terminal/src/server/terminal.ts`:
  pause and the shed marker.
- `packages/node-core/src/server/routes/projects/tasks.ts`.
- `packages/node-core/src/server/worktrees/worktreeStatus.ts` (new), `worktrees.ts`,
  `plugins/changes/src/server/localDiff.ts`.
- `packages/node-core/src/server/auth/deviceTokens.ts`, `middleware/auth.ts`.
- `packages/client-core/src/host/tree/workerHost.ts`.

## Tests

- `chromeData.test.ts`: a `terminal:sessions-changed` frame bumps no plugin's chrome revision.
- `wsHub.test.ts`: a socket over its mark pauses the PTY and resumes on drain; `seq` is contiguous
  across a shed frame or the shed marker is present; `nodeBroker.test.ts`: a shed marker does not
  reset the socket.
- `worktreeStatus.test.ts` (new): two concurrent calls run git once; a call inside the TTL runs git
  zero times; a write under the path invalidates; **a file written 100 ms ago still blocks
  `removeWorktree` without `force`**, which is the test that protects the guard.
- `deviceTokens.test.ts`: a second `authenticate` with the same token performs no SQLite read; a
  revoke makes the next call miss.
- `tasks.test.ts`: the list route issues one project query for any number of tasks.
- The helper's `helperServer.test.ts`: a frame from a non-active node is not forwarded; a
  `node-status` from any node is.

## Docs owed

`docs/future/events.md`: the catalogue grows; `docs/plugins.md` § Hearing a core event: the new
names. `docs/terminal.md`: pause semantics and what a shed frame means. `docs/shell.md` § Connection
broker: the helper forwards the active node. `docs/security.md` § Transport and auth: the token cache
and its clear-on-revoke rule. `docs/workspaces-and-tasks.md`: the status cache and the fresh-read
guard.

## Done when

- A terminal producing output at full rate moves no query traffic on an idle client, per the phase 0
  request log.
- One status ping spawns at most one `git status` per worktree per TTL window, however many clients
  are connected.
- A deliberately saturated socket recovers without a reconnect.
- `ACORN_PERF` shows zero SQLite reads in auth on a warm token.
- A worktree with a fresh uncommitted change is still refused removal.

## Verify before building

- Re-derive the `term:status` consumer list with a grep for `wsOnStatus` and `onStatus`; it was six at
  `17a9acdf`.
- Confirm `bumpChrome(pluginId?)` still has the per-plugin map and the `wsOnStatus` caller still
  passes nothing.
- Confirm `worktreeDirty` still guards removal in `worktrees.ts` before writing the cache.
- Confirm `node-pty`'s `pause`/`resume` at the pinned version.
- Confirm `wsHub.ts` still increments `seq` on a dropped frame and `nodeBroker.ts` still closes on a
  gap.
