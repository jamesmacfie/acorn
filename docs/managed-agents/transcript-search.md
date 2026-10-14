# Transcript search

Agent Center's search and the archive page's search provider read one SQLite full-text index over a
Node's agent events. This page covers what the index holds, how it stays current, and why it's shaped
this way. The projection is in `plugins/agents/src/server/sessions/searchProjection.ts`.

## Transcript search

`agent_events_fts` indexes `agent_events.search_text`. Migration-owned triggers project standalone
rows and search-text changes, and `AgentSearchProjection` builds streamed message heads before reads
that need them. Both search entrypoints read it, including the archive page's
[search provider](../plugins/search-providers.md#search-providers). When the retention
pass removes a session's history, the delete trigger removes its rows, so archive search finds only
the title and the note.

**The search text stays on the Node.** No client reads `searchText`, and on a tool row it repeated
the title, input, and output, a third of the socket's bytes. The snapshot route, `/events` pages, and
`agent:event` frames leave it out (`clientEventRecord` in `rowMapping.ts`).

## Messages

A streamed message is indexed once, on its first event. A reply arrives as many `append` events, and
indexing each alone meant two words matched only when they landed in one fragment. A fragment that
continues the previous event's stream, by the same rule `durableEventBuffer.ts` coalesces on, adds its
text to the stream's first event. Migration `0005_agent_events_fts_messages.sql` applied this to old
rows: 148,570 fragments became 7,410 messages in 11 seconds on a 1.4 GB database.

A continuation commits without reindexing the head. Migration `0012_agent_search_progress.sql` records
the earliest dirty sequence per session in the same transaction. The projector starts at the head
before it, reads 128 rows at a time, joins each complete message, and writes only changed heads. A
query after every fragment still pays the growing message's indexing cost.

Both search entrypoints catch up every dirty session before ranking, including sessions outside the
task filter, because they affect ranking statistics. Catch-up, ranking, snippets, and session reads
share one transaction. Agent Center sorts tied ranks by session update time, and the archive provider
keeps index order. Raw `snapshot`, `eventPage`, `eventsForTurn`, and `exportSnapshot` reads catch up
their session, so waits, workflows, delegation, forks, and export see whole messages. Client snapshots
skip this, because they carry no search text.

Before the first projection read or event write, the Node reinstalls missing derived objects and sets
the stored rank. It trusts the dirty markers, because a crash rolls back a marker and its ledger change
together. The full check runs only when the format in `agent_search_format` differs from
`SEARCH_INDEX_FORMAT` in `searchProjection.ts`, or when the dirty table or the index is missing. It
marks every session for reconciliation, runs the FTS5 integrity check, compares every search row with
its event, and rebuilds from canonical message JSON when either check fails. Raise the constant when
the index's text or columns change.

When a search or a flush fails because FTS5 reports damage (`SQLITE_CORRUPT_VTAB`), the projection logs
it and clears the stored format, so the next start runs the full check and rebuilds. Damage that never
makes a statement fail stays until the next format change. It costs missing or wrong hits, never
ledger data.

The full check reads every event. On a 2.5 GB database it took about 80 seconds of event-loop time,
which is why a normal start skips it.

## Search from a managed session

`session_history_search` and `session_history_read` let a managed agent recover text from its own
ledger after harness compaction. Both tools require a signed task and session claim. The agents plugin
checks that the claimed session belongs to the task and accepts no session ID in either input. The
read tier admits the tools by default, including in delegated and workflow sessions unless a session's
tool ceiling narrows access. Both tools catch up only the claimed session's search projection before
reading it.

Search uses quoted FTS5 words and returns eight ranked events by default, with a maximum of 20. Its
optional `user`, `assistant`, or `tool` role filter runs before the limit. Each result has an event
sequence, role, timestamp, and an excerpt capped at 600 characters. `session_history_read` accepts that
sequence and a character offset, then returns up to 4,000 characters and `nextOffset` when more remain.
The read uses the materialized head of a streamed message, so a page can reach text from later deltas.
An offset beyond the end returns an empty page.

These tools expose user messages, assistant messages, and tool text. They omit artifact and attachment
payloads. Returned text uses the pasted-content wrapper: an old message is evidence of what appeared
in the session, not a fresh instruction or proof that an action succeeded. Search is lexical, so a
paraphrase can miss.

## Cross-session search

`agent_session_search` reads this index across every session in the caller's project, and
`agent_session_read` folds a session's events the way the projection does
([cross-session reads](./cross-session-reads.md)). Search catches up every dirty session before
ranking, as Agent Center does. A read catches up only the session it reads, then finds message starts
by their search text: a streamed continuation has none once projected, and neither does a tool call's
superseded opener. The scope filter passes task IDs as one JSON array, so a large project can't reach
SQLite's bound-parameter limit.

## Tool rows

A tool call is indexed once, on its latest row, and the opener gives up its search text. A file change
does the same. Tool text ranks below the conversation: it goes in a `tool` column that the stored rank
weighs at 0.3 of `content`, because file dumps and command output buried the conversation.

Search rows are keyed by the event's rowid. Inserts replace on rowid and deletes also check
`event_id`, so a table a VACUUM renumbered repairs itself on the next write. Acorn never runs VACUUM on
the agents database. The full check also detects rowid drift and rebuilds, but it runs only on a
format change.

## Why the index keeps its own copy

The index stores its own text: 203 MB on the measured database. Pointing it at `agent_events` as
external content would save that, but external content is keyed by rowid, and a VACUUM can renumber
the rowids of a table with a text key, as this one has. This table survives that because every delete
checks `event_id`. An external-content table can't, and a delete naming values it doesn't hold
corrupts it. Making the rowid stable means rebuilding `agent_events` with an integer key and
reindexing every row in a migration, which blocks boot.
