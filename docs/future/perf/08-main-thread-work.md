# Phase 8: take long tasks off the main thread

## Completion note

Landed October 22, 2026, on branch `phase-8-main-thread-work`. All six parts are built, with tests and
docs. The acceptance numbers aren't taken. They need a working week of Sentry and the owner's visible
window, so they're the owner's to read.

What landed:

- **Fences in the worker.** The highlight worker answers a second request type, `output: 'html'`, with a
  fence's dual-theme HTML. `highlightToHtml`, its flights, and its 200-entry cache moved from `shiki.ts`
  to `worker.ts`, and `fenceHtml.ts` holds the one Shiki call both highlighters share. The main thread
  renders a fence only when the worker can't start or answer, through `renderFenceOnMainThread`, and
  records `highlight.fallback` and `highlight.main_thread`. `highlight.html.render` is now the
  main-thread fallback only.
- **Persist by allowlist.** `PERSISTED_KEY_PREFIXES` in `queryPersistence.ts` names preferences,
  workspaces, projects, tasks, task scripts, run targets, integrations, and model backends. A plugin
  query opts in with `meta: { persist: true }`, which the agent harness list does. The archived task
  list opts out. A query marks the partition dirty only on a result, a state write, or a removal, and
  only for a kept key. `restoreClient` drops entries an old snapshot holds that the list no longer keeps.
  `docs/caching/persisted-query-cache.md` is the new owning page.
- **Composer.** The worktree file list becomes a `Set` once per array. The `#` memo split in two, so a
  key that adds no list leaves `composerContexts` as it was. `typeText` writes the draft 300 ms after
  typing stops, and `flushText` writes it on blur. Every other text change still writes at once.
- **Rail.** `railProps` is a `createMemo`, `sources` is a memo, each source's markers have their own
  memo, and the core rail finds a button's source through a map. A marker change on a rail of 10
  sources reads markers 10 times where it read 140.
- **Dashboards and OpenUI.** `fresh` uses `unwrap` where it cloned through JSON. `RunPanel` reconciles
  display rows by ID into one store. The runtime evaluates once per animation frame with a 50 ms timer
  fallback, and runs a query 250 ms after the last state change.
- **Hidden terminals.** A terminal hidden or unmounted for 10 seconds (`HIDDEN_DETACH_MS`) detaches, and
  `show()` attaches again. The Node's attach already sends a reset and a snapshot.

Decisions and deviations:

1. The doc names a `keyup` pass to drop. I narrowed it to the caret keys (arrows, Home, End, Page) and
   kept it for them. Typing already updates the mention list through `onInput`, but moving the caret
   fires no input.
2. A `removed` query event still marks the cache dirty, where the doc says only a result or a state
   write. Without it, a removed entry would stay in the snapshot until the next unrelated write.
3. Mutation events still mark the cache dirty, because the snapshot keeps paused mutations and a test
   pins that.
4. The allowlist can't name `['agents', 'providers']`, because the architecture test says core never
   names a plugin. The `meta: { persist: true }` opt-in is the way around that, and a plugin can use
   it for its own first-frame query.
5. `runTargetsKey` moved to the protocol package beside `runTargetsRoute`. Importing it from
   `infra/queries.ts` made an import cycle through the fleet. `queries.ts` still re-exports it.
6. Reconciling rows wasn't enough. `RunPanel` spread a prop object that depended on the run
   (`{...(plan().group?.[0] ? {...} : {})}`), and Solid then tracks every prop read in a view against the
   run, so every view redrew whenever a run changed. It is now `groupBy={plan().group?.[0]?.column}`.
   Group sections, as in a grouped table or list, still redraw with a new run, because each run builds
   new group objects.
7. A query bound to an input waits 250 ms for any state change, not only typing, except that a button's
   `Set` and `Reset` run queries at once, and `Run` runs them first. A select or toggle wired to a
   query argument is delayed by 250 ms.
8. Tests that waited for the program to draw now wait for a frame (`AppView.test.tsx`, `Renderer.test.tsx`).
   The OpenUI conformance runner waits 300 ms after a typed step. That differs from the reference runner.
9. The page's thread doesn't highlight fences, but a plugin frame or a browser where the highlight
   worker fails still falls back to the main thread, as diffs do.
10. The `cache.characters.max` and `cache.serialize.max` targets aren't measured, so the doc's check for
    switching to TanStack's per-query persister isn't done.

What later phases need to know:

- Phase 9 should keep a first-frame query on the allowlist, or opt it in with `meta: { persist: true }`.
  A query that isn't saved draws nothing on a cold launch.
- A terminal that was hidden for over 10 seconds attaches again on show. A pane that depends on the
  terminal's output being current while hidden must read it from the Node.
- Phase 10 compares `highlight.main_thread` counts to see how often the fallback runs.

Not taken, for the owner:

- No `highlight.html.render` over 100 ms in a working week, `cache.characters.max` under 1 million,
  `cache.serialize.max` p95 under 15 ms, and `ui.event_loop.delay.max` p99 under 60 ms all need Sentry.
- The Node service budget measures 1,932,991 B against a 1,934,100 B ceiling.

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
