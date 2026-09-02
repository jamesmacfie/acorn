# Phase 8: switching and hydration

Status: not started. Waits on phase 0 for the request log, and reads better after phase 7 because
the two share the agents pane.

## Goal

Switching back to a task left a moment ago issues no request. The editor shows text after one round
trip, not three. The diff viewer's per-file bookkeeping touches one row per file event, not every
file. `keepAlive` on the pane contract either does what it says or does not exist. This is the
remainder of the first read's phase 4 (analysis.md §§ 16 and 17, architecture.md § 5).

## Why this phase, and why now

A task switch disposes the whole task scope: `apps/desktop/src/client/App.tsx` keys the task surface
by id so the old scope is gone before the new one mounts. That is defensible. It matches the
codebase's stance of persisting state as data rather than DOM
(`packages/client-core/src/features/editor/viewState.ts` is the pattern), and it keeps pane contributions
simple. But it obliges the data layer to make a remount cheap, and it does not. Nothing prefetches on
rail hover; the only prefetcher in the app is the GitHub pull list's, and it runs on list load.
`plugins/editor/src/client/EditorPane.tsx` makes three serial round trips before text appears (root,
mount, read) and clears its per-file `EditorState` pool in the pane's own cleanup, undo history
included. `packages/client-core/src/host/registries/panes/panes.ts` declares `keepAlive?: 'dom' |
'none'`, exactly one pane sets it (`plugins/preview/src/client/PreviewTaskPane.tsx`), and nothing
reads it. A field that promises keep-alive and delivers nothing is worse than either choice.

The diff viewer is the most carefully tuned surface in the app and still has two costs quadratic in
file count. `packages/client-core/src/kit/diff/hydration.ts` keeps per-file statuses in a `Map` and
publishes one version counter, so `packages/client-core/src/features/diff/DiffPane.tsx`, which reads
`hydrator.status(file.path)` inside a memo over all files, rebuilds an array of every file two or
three times per file as they hydrate. On a 200-file pull request that is tens of thousands of
iterations and several hundred list re-renders during load. `setParsedByPath((prev) => new
Map(prev).set(...))` copies the whole map once per parsed file, and two more full copies sit at other
writes in the same file.

A node switch remounts the whole shell: `apps/desktop/src/client/index.tsx` keys the persist provider
on the cache id. That is rarer than a task switch and left as an examination, not a change.

## Scope

In:

- `keepAlive` decided. Either `'dom'` is implemented in `packages/client-core/src/features/tasks/TaskPaneHost.tsx`
  for the terminal and editor panes, keeping their elements hidden across a task switch for the
  panes that hurt, or the field is deleted from the contract and the preview pane's setter with it.
  The recommendation is to delete it and carry the cost on the data path, because `paneModels.ts`
  already keeps a per-pane model across region unmounts, and a hidden DOM tree per task is the memory
  shape the codebase declined once already for the transcript.
- The editor's waterfall: `root` and `read` in parallel, or one route that returns both, so text
  appears after one round trip. The `EditorState` pool moves to the pane model in
  `packages/client-core/src/host/registries/panes/paneModels.ts`, which survives a region unmount and
  is disposed with the task, so undo history survives a pane toggle.
- Rail hover prefetch: on pointer enter over a task row, `queryClient.prefetchQuery` for that task's
  panes' first queries (tasks are already cached; this is the pane data), following the shape
  `plugins/github/src/client/PullList.tsx` uses for `prefetchOpenPulls`.
- Diff hydration per path: `hydration.ts` keeps a Solid store keyed by path, `status(path)` reads one
  key, and `DiffPane.tsx` reads statuses per row rather than in the all-files memo.
- `parsedByPath` becomes a keyed store write. The two other full-map copies in `DiffPane.tsx` go the
  same way.
- The node-switch remount examined: measure it with the phase 0 marks and write the number down; act
  only if it is over a second.

Out: a virtualizer for the transcript. `Rows` virtual by default on the desktop (refused.md; row
heights vary). Any change to the pane layout reducer.

## Design

**Delete `keepAlive`.** The pane contract loses the field; `PreviewTaskPane.tsx` loses the setter;
the pane doc loses the paragraph. What replaces it is the model layer already there: `paneModels.ts`
holds one `createRoot`-owned model per pane per task, and the editor's state pool becomes part of the
editor's model, so a pane that unmounts and remounts inside the same task pays nothing. Across tasks
the query cache is the keep-alive, and the prefetch below is what makes the cache warm.

**One round trip to text.** `EditorPane.tsx` awaits `Promise.all([api.root(taskId), api.read(taskId,
path)])` when it already knows the path (the view state remembers the last file), and mounts the
editor with both. When it does not know a path, `root` alone is the first request, as today.

**Hover prefetch is a rail concern.** The task rail row gets `onPointerEnter` that calls a
`prefetchTask(taskId)` on the pane registry, which asks each registered pane for its `prefetch?(task)`
and runs them. Panes that have nothing to prefetch declare nothing. The editor prefetches `root`; the
agents pane prefetches the session list; the terminal pane the session list. A hover that lasts under
150 ms is ignored, so scrolling the rail does not fetch.

**Statuses are a store.** `createStore<Record<string, DiffHydrationStatus>>({})` replaces the `Map`
and the counter. `publish(path, status)` writes one key. `DiffPane`'s row reads `statuses[file.path]`
and re-renders alone.

## Code touched

- `packages/client-core/src/host/registries/panes/panes.ts`, `paneModels.ts`, `TaskPaneHost.tsx`,
  `plugins/preview/src/client/PreviewTaskPane.tsx`.
- `plugins/editor/src/client/EditorPane.tsx`, the editor routes in `plugins/editor/src/server/`.
- `packages/client-core/src/features/tabs/TabRail.tsx`: hover prefetch.
- `packages/client-core/src/kit/diff/hydration.ts`, `packages/client-core/src/features/diff/DiffPane.tsx`.

## Tests

- `hydration.test.ts`: publishing one path notifies one subscriber; a memo over another path does
  not re-run.
- `DiffPane.test.tsx` (jsdom): hydrating 200 files re-renders the file list once, not 400 times
  (count list renders with a spy component).
- `EditorPane.test.tsx`: with a remembered path, text appears after one awaited request batch;
  toggling the pane off and on within a task keeps undo history.
- `TabRail.test.tsx`: hovering a task row for 200 ms calls each pane's `prefetch`; hovering for 50 ms
  does not.
- The type-level test that no contribution declares `keepAlive`, if the field is deleted.

## Docs owed

`docs/panes.md`: `keepAlive` gone, the model layer as the keep-alive, `prefetch` on the pane contract.
`docs/editor.md`: one round trip to text, state pool in the model. `docs/diff-rendering.md`: per-path
statuses.

## Done when

- Switching back to a task left two seconds ago issues no request, per the phase 0 request log.
- The editor's first text lands after one round trip on a remembered file.
- A 200-file pull request's hydration re-renders the list once.
- `keepAlive` works or does not exist.

## Verify before building

- Confirm `keepAlive` still has one setter and no reader (grep outside `docs/future/performance/`).
  Read at `17a9acdf`.
- Confirm `hydration.ts` still uses one counter and `DiffPane.tsx` still copies the map on write.
- Confirm `paneModels.ts` still disposes models on task switch, which is what makes the model layer
  the right home for the editor pool within a task.
- Read `docs/managed-agents.md` on the transcript virtualizer before proposing any DOM keep-alive;
  the memory shape was declined there once.
