# Phase 10: response size

Status: built October 13, 2026. A working day in Sentry still has to confirm it.

## Completion note

October 13, 2026. Both responses shrink, and so does the persisted query cache. The proof is tests and
measurements of James's own data, read without writing. No working day has been recorded yet.

### What the bytes were

The doc's suspects were wrong for prefs. In James's Node, the database plugin's saved workspaces held
382,694 of the 429,263 characters in the `prefs` table: five `plugin:database:workspace:v1:*` keys,
the largest 160,745 characters. Each one is a database pane's last result set. The `core.dashboards`
slice was 546 characters. The rest is mostly `debug:restore-trace:*` keys, about 35,000 characters
over 13 keys.

For sessions, `config` was 47,877 of each row's roughly 48,000 characters. Averaged over the 100
newest live sessions, it splits into slash commands (27,508), standing context (11,072), skills
(5,042), and config options (2,315). Every other column together is under 600 characters.

### What landed

- `GET /v1/core/prefs` leaves out plugin state, the `plugin:<id>:*` keys. `?key=` answers one key,
  plugin state included. A frame's `state.get` reads its key from the Node each time (`readPref`).
  `state.set` still goes through `savePref` for per-key ordering, but leaves the cached prefs map
  alone. No key moved, so there's no migration and nothing to keep reading.
- `/v1/p/agents/sessions` and `/sessions/search` answer `sessionListRow` rows. A row drops slash
  commands, skills, and standing context, keeps each config option with only its chosen value, and
  carries `listRow: true`. `GET /sessions/:id` and the `agent:session` socket frames still carry
  full rows. In the client, `newestManagedSession` keeps the detail a full row brought when a newer
  list row wins, so a list refresh can't empty an open session's composer.
- Settings (session defaults and custom agents) and the inline diff card read each provider's model
  and effort choices from the providers answer instead of a session list. `ProviderCatalogue`
  already filled it the same way, from the newest of the 50 most recent live sessions.

### Measured

| What | Before | After |
| --- | --- | --- |
| `/v1/core/prefs` body, James's real `prefs` rows | 601,818 B | 78,254 B |
| The same, without the `debug:restore-trace:*` keys | | 39,510 B |
| 50-session page, James's 50 newest live sessions | 2,354,012 B | 77,790 B |
| 50-session page, seeded in `managedBridge.test.ts` | 2,497,699 B | 63,799 B |
| Persisted cache file on disk, characters | 855,640 | 342,343 |

The real-data rows ran the route's filter and `sessionListRow`'s rules over rows copied out of SQLite.
The cache row removed the `plugin:` keys from the `prefs` entry of James's cache file. That entry fell
from 541,151 to 27,854 characters. The test asserts the seeded page is over 2 MB whole and under
100 KB as list rows.

### Decisions and deviations

- No `meta: { persist: false }` was added. Plugin state is no longer a query at all, and the prefs map
  is small enough to keep, which startup restore needs at launch.
- A single-key read keeps the `/v1/core/prefs` path, so it needs no new route, scope entry, or golden
  list change. Telemetry still records it under route `/v1/core/prefs`, with the plugin's id as
  owner. Filter on owner `core` when you compare prefs sizes in Sentry.
- `/sessions/search` gets the same rows as the list, because the client merges both the same way.
- An older client talking to a newer Node gets list rows without commands. Its composer loses slash
  commands until the next socket frame or snapshot for that session. Nothing breaks.

### Left open

- The `debug:restore-trace:*` keys keep prefs over the 50 KB target. `startupRestore.ts` marks them
  "TEMP" and writes a new key on every launch, so the map grows without a limit. They belong to the
  dashboards-wipe investigation, so this phase left them alone. Removing the trace and deleting its
  keys brings prefs to about 40 KB.
- That investigation suspects a `savePref` that ran before prefs loaded and stamped a partial map. A
  database pane's `state.set` was such a write, and it no longer touches the map.
- After prefs, the largest cache entry is a GitHub pull request, `["pull", "runn-fast", ...]`, at
  242,622 characters. Phase 09 owns that.
- The `agent:session` socket frame still sends the whole row, about 48 KB, on every change.

### Compare in Sentry after a working day

- `api.response.bytes.max` for route `/v1/core/prefs`, owner `core`. Baseline 573 KB, target under
  50 KB. Expect about 80 KB while the restore trace remains.
- `api.response.bytes.max` for route `/v1/p/agents/sessions`. Baseline 474 KB average and 2.2 MB
  peak, target under 100 KB.
- `cache.characters.max`. Baseline 1.9 million, target under 1 million. Check `cache.entries` beside it.
- How often a database pane's `state.get` shows under `/v1/core/prefs` with owner `database`, and its
  size. That's the cost moved out of every launch.

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
