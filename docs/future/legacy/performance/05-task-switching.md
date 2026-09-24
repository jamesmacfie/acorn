# Task switching

Date: 2026-09-24. Status: proposal. Read from source, not timed. [Back to the plan](./README.md).

Take the baseline in [M4](./01-measurement.md#m4-time-a-task-switch-in-the-real-window) before
changing anything here, and put the table at the top of this file.

## What a task switch does

`apps/desktop/src/client/App.tsx` draws the task view inside `<Show keyed when={activeTaskId()}>`. A
switch disposes the whole `TaskView` and builds a new one: every pane component, the pane switcher,
the footer, and every command and keybinding the view registered. That is deliberate, and
[panes.md](../../../panes.md) says why. A pane's shared state lives in a pane model, and "across tasks
the query cache is the keep-alive". The `keepAlive` field was deleted rather than implemented,
because a hidden element tree per task is a memory shape the codebase declined.

The design is sound. The problem is that several things it relies on do not hold:

- Pane models keep one task per pane, so the previous task's models are gone when you come back.
- Several panes do not read through the query cache at all. They use `createResource` or a plugin
  store that refetches on mount.
- The terminal drawer survives the switch, but every terminal surface of the old task is destroyed
  and the new task's are built from nothing.

So the switch you make most, back to the task you just left, pays for a first visit.

## T1: Keep pane models for the last few tasks

**What was found.** `packages/client-core/src/host/registries/panes/paneModels.ts` holds one entry per
pane id, and `paneModel()` disposes the held entry as soon as a different task asks:

```ts
const entry = held.get(paneId)
if (entry && entry.taskId === taskId) return entry.model as M
entry?.dispose()
```

The comment gives the reason: "disposing it eagerly is what flushes a pending save". The agents,
changes, context, notes, and workflows panes all build models (`model:` on their contributions, or
`paneModel()` in `NotesTaskPane.tsx`). Going from A to B and back to A rebuilds all of A's models.
For the changes pane that is a `git status` and two `git diff --numstat` spawns before the list draws.
For the agent pane it is a session-list read, and then the snapshot refetch in
[T2](#t2-stop-refetching-an-agent-snapshot-the-store-already-holds).

**Change.** Hold models for the three most recent tasks per pane, and dispose the oldest when a
fourth arrives. Keep the save behaviour by separating it from disposal: give the model an optional
`leave()` hook that the host calls when the task stops being the active one. A model with a pending
save flushes it there. The notes and changes models are the ones to check first, because they hold
drafts.

Task eviction (`onScopeEvicted` for `task`) and a node switch still dispose everything, as today.

**Why at this layer.** The host owns model lifetime, and every pane that declares a model gains the
behaviour with no change of its own except the `leave()` hook where it has a save.

**Costs.** Memory for two more tasks' models per pane, which [08](./08-memory.md) has to weigh. Also
background work: a held model's effects keep running. The changes model refetches on every
`taskStatusRevision` tick, so three held changes models would run three sets of git reads every ten
seconds. Pause refresh effects while a model is not the active one, and refetch once on return.

**Done when.** A switch from B back to A issues no model-building requests for A within the window,
and the M4 numbers for "back to a task you just left" drop.

## T2: Stop refetching an agent snapshot the store already holds

**What was found.** `plugins/agents/src/client/sessions/AgentConversation.tsx` calls
`managedAgentStore.loadSnapshot(id)` every time it mounts, which is every switch to a task whose agent
pane is open. `loadSnapshot` in `managedStore.ts` fetches the snapshot, pages to the end of the event
ledger, merges it into the store, and re-indexes the events. The largest first page on record is
2,158,126 B ([phase 7](../../../performance/2026-09-03--phase-5.md#2026-09-03--phase-7)).

The store already holds that snapshot, and it is current. `activateManagedAgentNotifications()` keeps
an app-lifetime socket subscription, and `appendEvent`, `upsertTurn`, and `upsertRequest` apply every
frame to the held snapshot whether or not a pane is showing it. The refetch downloads, parses, and
merges data the client already has. The merge also produces a new snapshot object, so the transcript
re-projects a second time right after it first drew.

**Change.** On mount, draw from the held snapshot. Only fetch when one of these is true:

- The store holds no snapshot for the session.
- The socket has reconnected since the snapshot was loaded. `wsOnReconnect` in
  `packages/client-core/src/infra/node/wsClient.ts` is the signal. Record a reconnect counter beside
  each snapshot.
- The session row's `lastEventSeq` is ahead of the last event in the held snapshot. In that case fetch
  only the missing events with `managedAgentApi.events(sessionId, cursor)`, the same call `pageToEnd`
  already uses.

Keep the unconditional refetch after a mutation (`onSent`, `onRequestResolved`), where the comment in
`managedStore.ts` explains why a time window would be wrong.

**Done when.** Switching back to an agent task with a held snapshot issues no snapshot request, and
`agents.snapshot.load` telemetry shows the hit.

## T3: Keep terminal switches across tasks cheap

**What was found.** The drawer (`plugins/terminal/src/client/TerminalPanel.tsx`) stays mounted across
a task switch, but it draws one `TerminalSurface` per session of the active task. When the task
changes, every old surface is disposed and every new one is built. Building one
(`TerminalSurface.tsx`) creates an xterm and a WebGL context, then makes two requests in a row: a
`resize` and, only after it answers, an `attach`. The attach makes the node rebuild the screen from
its 256 KB ring and send it (about 20 ms on the node, [phase 6](../../../performance/2026-09-03--phase-5.md#2026-09-03--phase-6)).

Inside one task, a tab switch is a repaint, because hidden surfaces stay alive. Across tasks it is a
full rebuild.

**Change.** Two steps, the first unconditional:

1. **One round trip instead of two.** Send the size with the attach, and have the node resize before
   it serialises the screen. That needs a small change to the attach message in the terminal plugin's
   wire contract.
2. **Keep the previous task's surfaces.** Draw surfaces for the sessions of the active task and of the
   previously active task, and hide the latter. Returning to the previous task is then a repaint, like
   a tab switch. Bound it by count: WebKit limits live WebGL contexts per page, and the oldest context
   is lost when the limit is passed. `TerminalSurface.tsx` already falls back to the DOM renderer on
   context loss, but a fallback is not the goal. Find the limit in WKWebView and keep the total well
   under it.

**Done when.** Step 1: an attach is one request. Step 2: switching back to the previous task shows its
terminals with no attach request.

## T4: Cache run targets instead of refetching per mount

**What was found.** `apps/desktop/src/client/TaskView.tsx` reads run targets with `createResource`, so
every mount waits for `runApi.targets(taskId)` before the run buttons appear. They appear late, and
the pane switcher shifts when they do.

**Change.** Make it a query keyed by task with a short stale time, invalidated where
`toggleTarget` and the run-target events already refresh it. Add it to the rail's hover prefetch.

## T5: Cache the terminal profile list

**What was found.** `TerminalPanel.tsx` calls `api.profiles()` in `onMount`, so every time the drawer
opens it lists profiles again. The list changes when a harness is installed, which is rare.

**Change.** A query with a long stale time, invalidated by the event that already reports a harness
change, if there is one. If there is not, a stale time of a few minutes is enough.

## T6: Warm the agent transcript on hover

**What was found.** The rail's hover prefetch (`schedulePanePrefetch` in
`packages/client-core/src/host/registries/panes/panes.ts`) asks each pane's `prefetch`. The agent pane
warms the task's session list. It does not warm the snapshot, which is the large read.

**Change.** After T2, have the agent pane's `prefetch` call `loadSnapshot` for the session the pane
would open, only when the store does not already hold it. The first visit to an agent task then
overlaps its largest read with the 150 ms the pointer rests on the row.

## T7: Check the command and keybinding churn

**What was found, not confirmed.** Each `TaskView` mount registers about five palette commands per
pane contribution, one restore command per pane, and a keybinding per pane chord. `TaskView`'s own
cleanup unregisters them all on the way out. `KeybindingDispatcher` in
`packages/client-core/src/host/registries/commands/keybindings.ts` resolves every binding in a memo
over the whole registry and hands the result to `@opentui/keymap`. If each register or dispose
notifies separately, one task switch rebuilds the keymap dozens of times.

**Change, if the measurement shows it.** Register the task-scoped commands once at the shell, reading
the active task through a signal, rather than per `TaskView` mount. Their `when` and `run` already
close over `props.task`; they can read `activeTaskId()` instead. Alternatively wrap the register and
dispose passes in `batch`.

**Verify first.** Count `resolveKeybindings` calls during one switch. If it runs once or twice,
skip this item.

## T8: Keep the previous task's view alive, only if T1 to T6 are not enough

This is the one-way door in this file, so it goes last.

After T1 to T6, a switch back still remounts every pane and rebuilds its DOM from warm data. For most
panes that is fast. For a long agent transcript it might not be, and
[06](./06-panes-and-transcripts.md) covers that separately. If the M4 measurement still shows a
switch back to the previous task over about 100 ms at the median after those items, prototype this:
keep the previous task's `TaskView` mounted and hidden, one task deep, and dispose it when a third
task is opened.

[panes.md](../../../panes.md) records why `keepAlive` was deleted, and [refused.md](./refused.md)
holds the condition for revisiting it. Measure memory in [08](./08-memory.md) first. If this ships,
write the numbers into panes.md, because it reverses a documented decision.

## Verify before building

- Confirm `paneModels.ts` still holds one task per pane, and list every model that has a pending
  write it relies on disposal to flush.
- Confirm the app-lifetime agent subscription stays active while no agent pane is mounted. If
  [R3](./03-renderer-startup.md#r3-activate-client-plugins-once-when-nothing-changed) changes how
  `activate` runs, re-check this first.
- Confirm the terminal wire contract's attach message and whether the node can take a size with it.
- Confirm the WebGL context limit in WKWebView on the oldest macOS the app supports, which
  `src-tauri/tauri.conf.json` gives as 12.0.
