# Agent search after a restart

Date: October 9, 2026. Status: proposed; implementation not started.

[Transcript search](../managed-agents/transcript-search.md) owns the index and its maintenance. This
plan removes the full-ledger work the agents plugin does after every Node start.

## Summary

The first agent search after a Node restart took about 80 seconds on a 2.5 GB agents database. Later
searches took 18 ms. The wait is the search index checking itself, not the search. Two startup steps
in `AgentSearchProjection` (`plugins/agents/src/server/sessions/searchProjection.ts`) scan every stored
event on every boot. This plan runs those scans only when there is a reason to.

## Evidence

Measured on a copy of a development database: 541,222 events, 680 sessions, 176,138 search rows, and
802 MB of event JSON. The timings come from a throwaway Vitest file that opened the copy with
`openPluginDb` and called the projection and `searchTaskSessions` directly.

| Step | Time |
| --- | --- |
| `new AgentSearchProjection(db)`, which runs `recover()` | 50.9 s |
| First archive search, which catches up every session | 28.1 s |
| Second archive search | 18 ms |

In the SQLite shell on the same copy, the parts of `recover()` cost:

| Statement | Time |
| --- | --- |
| FTS5 `integrity-check` | 19.0 s |
| Compare every search row with its event, using `json_extract` | 5.2 s |
| Find events with search text and no search row | 0.8 s |

The ranked query that backs the archive search took 85 ms for the term `Contract` across 230 archived
tasks.

## What happens on every start

`recover()` runs on the first `recordEvent` or search after the Node starts:

1. It recreates the dirty-marker table and the triggers. These statements use `IF NOT EXISTS` and
   cost nothing.
2. It marks every session dirty from sequence 0.
3. It runs the FTS5 integrity check, then compares every search row with its event.
4. It sets the stored rank. This is cheap.
5. If a check fails, it rebuilds the whole index.

Step 2 means the next unscoped `catchUp(tx)` re-reads and re-parses every event in the ledger. Archive
search and session search are unscoped, so the first one after boot pays for it. Step 3 runs inside
the first agent event write, so the first event after a restart waits for it.

The agents plugin is compiled, so this SQLite work runs on the Node's event loop. While it runs, no
other route answers. The 1.5-second provider deadline in `server/pluginHost/search.ts` can't fire
either, which is why the page shows **Searching…** for the whole time.

The plan that added this, `plans/performance/implementation-12-agent-search.md` in commit
`7bfb6f64e`, accepted it as "an explicit recovery cost" and recorded no large-corpus measurement.

## Why the scans aren't needed on every boot

**Dirty markers can't be lost.** Triggers on `agent_events` write the marker in the same transaction
as the event change. `catchUp` deletes the marker in the same transaction as the search-row write. A
crash rolls back both or neither. Re-marking every session protects against a state that SQLite's
atomic commit already rules out.

**Rowid drift needs a `VACUUM`.** The index keys rows by the event's rowid, and a `VACUUM` can
renumber a table with a text key. Acorn runs `VACUUM` in one place, `scrubCore` in
`packages/node-core/src/server/storage/backup.ts`, on a scrubbed copy of the core database. It never
runs one on the agents database. Each write already repairs a renumbered row, because inserts replace
on rowid and deletes also check `event_id` ([tool rows](../managed-agents/transcript-search.md#tool-rows)).

**Corruption from outside Acorn is rare and visible.** A file damaged by a disk fault or an outside
tool makes FTS5 statements fail. That failure is a better trigger for a rebuild than a scan on every
start.

## Proposal

1. **Stop marking every session dirty at startup.** Delete the `INSERT INTO agent_search_dirty SELECT
   DISTINCT session_id, 0 …` statement from `recover()`. Migration 0012 already marks populated
   databases once, when the dirty table first appears.
2. **Run the full check only when the index format changes.** Store a format number in a one-row
   table beside the dirty markers. On start, compare it with a constant in `searchProjection.ts`.
   When they differ, run the integrity check and the comparison, mark every session dirty, rebuild
   if needed, then store the new number. Raise the constant whenever the index's text or columns
   change. A missing dirty table or a missing search table also counts as a change, because the
   markers it held are gone.
3. **Rebuild when FTS5 reports damage.** When a projection write or a search fails with
   `SQLITE_CORRUPT_VTAB`, clear the stored format number and log the failure. The next start then
   runs the full check and rebuild from step 2.
4. **Keep the cheap repairs on every start.** Recreating the dirty table, the triggers, and the rank
   setting stays as it is.

Step 1 removes the 28 seconds. Step 2 removes the 51 seconds. Steps 3 and 4 keep the repair paths
that still have a cause.

## Risks

A damaged index that doesn't make a statement fail goes unnoticed until the next format change. It
returns wrong or missing hits rather than wrong data, because the index is derived from
`agent_events`. A rebuild fixes it. If that proves to matter, add a **Rebuild search index** action to
Settings later. This plan doesn't add one.

## Out of scope

- Making the index use `agent_events` as external content. The index keeps its own copy of the text
  on purpose ([why the index keeps its own copy](../managed-agents/transcript-search.md#why-the-index-keeps-its-own-copy)).
- Shrinking the database file. Freed pages stay on SQLite's free list
  ([retention](../data-layer/backup-and-retention.md#retention)).
- Moving SQLite work off the Node's event loop.

## Acceptance

- `plugins/agents/src/server/sessions/searchProjection.test.ts`: change "recovers lost dirty progress
  and corrupt or missing indexes from canonical content after reopening". A reopen with an unchanged
  format number leaves the dirty table alone. A raised format number marks every session and repairs.
- Add a test that a corrupt index sets the format number so the next open rebuilds.
- `plugins/agents/src/server/ftsSchema.test.ts` keeps passing. Repaired objects match migrated ones.
- On a copy of a database of at least 1 GB: constructing the projection takes under 100 ms, and the
  first search after reopening takes under 200 ms. Record both numbers in the pull request.
- Update [transcript search](../managed-agents/transcript-search.md#tool-rows) to describe when the
  full check runs.
