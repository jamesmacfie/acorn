# Phase 10: response size

Status: planned, October 13, 2026.

Read the [programme page](./README.md) first. This phase needs nothing else. It shrinks the query
cache that phase 09 looks at, so finish it first if you can.

## Deliverable

The settings and session-list responses carry only what their screens draw. The persisted query
cache shrinks to match.

## The problem

The [Sentry baseline](../../testing/sentry-baseline-2026-10-13.md) shows two responses far larger
than what they show on screen:

- `/v1/core/prefs` averaged 573 KB, every time. The route in
  `packages/node-core/src/server/routes/prefs.ts` returns every `prefs` row for the user. A row holds
  one key and one text value, so one or two keys hold almost all of it. The `core.dashboards` slice,
  workspace views, and session order are the suspects to check first.
- `/v1/p/agents/sessions` averaged 474 KB and peaked at 2.2 MB. `listSessions` in
  `plugins/agents/src/server/sessions/store.ts` returns up to 100 sessions, so each row carries about
  9 KB. A row in a session list needs a title, a state, and a time, not 9 KB.

Each response costs twice. The renderer parses it, and the query cache keeps it and writes it to disk.
The cache held 1.9 million characters per save and saved 1,830 times in the day. Settings alone
are about a quarter of it.

## Change

1. Measure which keys and fields hold the bytes. For prefs, sum `length(value)` by `key`. For
   sessions, measure the JSON size of each field over one real response.
2. Move each large pref into its own query, read by the screen that uses it, or into a table if it's
   really a list of records.
3. Drop the large session fields from the list response, and have the detail route return them.
   Check every reader of the list first, because a field the sidebar reads has to stay.
4. Keep large responses out of the persisted cache when a fresh fetch at launch is cheap. A query
   sets `meta: { persist: false }` to do that, as `shouldPersistQuery` in
   `packages/client-core/src/infra/persistence/queryPersistence.ts` reads it.

## Implementation steps

1. Run the two measurements and write the top keys and fields here.
2. Make the prefs change. Persisted prefs are a public contract, so keep reading the old key until a
   migration moves it. Run `pnpm db:check` if it adds a table.
3. Make the session-list change and update the tests that read the list.
4. Record a day of use and compare `api.response.bytes` and `cache.characters` with the baseline.

## Acceptance

- `/v1/core/prefs` averages under 50 KB.
- `/v1/p/agents/sessions` averages under 100 KB for a 50-session page.
- `cache.characters.max` averages under 1 million.
