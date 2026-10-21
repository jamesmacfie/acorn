# Phase 8: take long tasks off the main thread

Date: October 21, 2026. Status: proposed. Can run beside phases 5 and 6.

Typing and scrolling share the main thread with code highlighting, cache saves, and work that
repeats on each keystroke. Under load, each of these runs longer. This phase moves the largest ones
to a worker, runs them less often, or stops them while hidden. Each part ships on its own. Read
[the programme](./README.md) first.

## Starting point

Measured from October 14 to 21 unless marked as an estimate:

- **Highlighting.** `highlight.html.render` reached 1,051 ms, with a p95 of 1,021 ms over 35 samples.
  Trace `b4d8db58496867dc1df07e7bdf82f476` holds an 898 ms one inside a 1,471 ms navigation. Code
  fences in Markdown (`packages/client-core/src/kit/components/content/Markdown.tsx`) call
  `highlightToHtml` in `packages/client-core/src/infra/highlight/shiki.ts` on the main thread. Diffs
  already use `packages/client-core/src/infra/highlight/worker.ts`.
- **The query cache.** `cache.characters.max` was 9 million at the median, against 1.9 million on
  October 13, saved 2,861 times a day. `cache.serialize.max` p95 was 72 ms on the main thread.
  `queryCacheLifecycle.ts` marks the cache dirty on any `updated` event, including a fetch starting.
  Persistence is opt-out (`shouldPersistQuery` in `queryPersistence.ts`). Panel cards in a transcript
  persist their whole run, and their key holds the whole plan.
- **Typing in the composer.** An estimate of 1 to 5 ms per key when idle. `fileMentions.ts` builds a
  `Set` of the worktree's files on each key, and the file tree no longer hides ignored folders. The
  `#` reference memo in `AgentComposer.tsx` returns a new object on each key.
  `composerDraftStorage.ts` writes `localStorage` on each key.
- **The rail.** `railProps` in `TabRail.tsx` is a getter, and each button in
  `packages/client-core/src/host/plugins/ExclusiveSlotHost.tsx` calls it. Every marker change rebuilds
  every source once per button.
- **Dashboards and apps.** `PublishedDashboardPanel.tsx` clones each refetch with `JSON.parse` and
  `JSON.stringify`, so every row remounts. `packages/openui-solid/src/runtime.ts` evaluates the whole
  program on each store write, and a query argument bound to an input sends one run per key.
- **Hidden terminals.** `plugins/terminal/src/client/heldTerminals.ts` keeps every terminal ever
  opened attached, and each one parses all its output while hidden.

## Changes

1. **Highlight fences in the worker.** Send fences through the highlight worker the diff path uses.
   Fall back to the main thread only when the worker is unavailable, and record `highlight.main_thread`
   when it does.
2. **Persist by allowlist.** Persist only what the first frame needs: prefs, workspaces, projects,
   tasks, the session roster, and provider lists. Mark the cache dirty only on a `success` result or a
   `setState`. Measure `cache.characters.max` after, and switch to TanStack's per-query persister only
   if a whole-cache save is still over 20 ms.
3. **Do less per key in the composer.** Memoize the file `Set` and the `#` categories. Write the draft
   300 ms after typing stops and on blur. Drop the `keyup` pass in `MentionTextarea.tsx`.
4. **Memoize the rail.** Make `railProps` a `createMemo`, look buttons up in a map by id, and memoize
   markers per source.
5. **Keep dashboard rows.** Use `unwrap` instead of the clone, and reconcile rows by their id. In the
   OpenUI runtime, evaluate once per animation frame, and wait 250 ms after typing before running a
   query whose arguments changed.
6. **Detach hidden terminals.** Detach a terminal hidden for 10 s. Attaching again already fetches a
   snapshot from the Node.

## Tests

- A Markdown block with three fences highlights through the worker, and the page's thread runs no
  Shiki call.
- A fetch that starts and fails doesn't schedule a cache save. A transcript panel run isn't
  persisted.
- Typing 20 keys builds the file `Set` once.
- A rail with 10 sources rebuilds once on a marker change.
- A dashboard refetch with unchanged rows remounts none.
- A terminal hidden for 10 s detaches and draws its snapshot when shown.

## Acceptance

- No `highlight.html.render` over 100 ms on the main thread in a working week.
- `cache.characters.max` under 1 million, and `cache.serialize.max` p95 under 15 ms.
- `ui.event_loop.delay.max` p99 under 60 ms, against 104 ms.
- [Markdown renders block by block](../../ui-design/kit-internals.md#markdown-renders-block-by-block)
  and [renderer query cache](../../caching.md#renderer-query-cache) document the changes.
